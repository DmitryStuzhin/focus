import {createHash, randomBytes} from 'node:crypto';

export const DAY = 86_400_000;
export const MOSCOW_OFFSET = 3 * 3_600_000;
export const dayKey = now => Math.floor((now + MOSCOW_OFFSET) / DAY);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const nonce = () => randomBytes(32).toString('base64url');

export function transaction(db, operation) {
 db.exec('BEGIN IMMEDIATE');
 try {
  const result = operation();
  db.exec('COMMIT');
  return result;
 } catch(error) {
  db.exec('ROLLBACK');
  throw error;
 }
}

export function createAccountStore(db, env, now) {
 const statements = (table,columns) => {
  const existing = new Set(db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name));
  for(const [name,type] of Object.entries(columns)){
   if(!existing.has(name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
  }
 };
 transaction(db,()=>{
  statements('users',{name:"TEXT NOT NULL DEFAULT ''",blocked:'INTEGER NOT NULL DEFAULT 0',subscription_until:'INTEGER NOT NULL DEFAULT 0'});
  statements('sessions',{id:'TEXT',started:'INTEGER',last_seen:'INTEGER',ended:'INTEGER',device:'TEXT'});
  db.exec(`
   UPDATE sessions SET id=lower(hex(randomblob(16))) WHERE id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON sessions(id);
   CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id,ended,expires);
   CREATE INDEX IF NOT EXISTS sessions_by_start ON sessions(started);
   CREATE INDEX IF NOT EXISTS sessions_by_end ON sessions(ended,expires);
   CREATE INDEX IF NOT EXISTS users_by_creation ON users(created);
   CREATE TABLE IF NOT EXISTS account_onboarding(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, age_group TEXT NOT NULL,
    role TEXT NOT NULL, goals TEXT NOT NULL, completed INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS image_claims(
    code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), revoked INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS image_claims_user ON image_claims(user_id,revoked);
   CREATE TABLE IF NOT EXISTS account_activity(
    day INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
    successes INTEGER NOT NULL, errors INTEGER NOT NULL, PRIMARY KEY(day,user_id,kind)
   );
   CREATE TABLE IF NOT EXISTS account_meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO account_meta VALUES('tracking_since',?)").run(now);
 });
 const expiryByHash = new Map();
 for(const entry of (env.FOCUS_IMAGE_SUBSCRIPTIONS||'').split(',')){
  const [hash,date,extra] = entry.trim().split(':');
  if(extra===undefined&&/^[a-f0-9]{64}$/.test(hash)&&/^\d{4}-\d{2}-\d{2}$/.test(date||'')){
   const expiry=Date.parse(date);
   if(Number.isFinite(expiry))expiryByHash.set(hash,Math.max(expiry,expiryByHash.get(hash)||0));
  }
 }
 const sql = query => db.prepare(query);
 const saveOnboarding = sql(`INSERT INTO account_onboarding
  (user_id,first_name,last_name,age_group,role,goals,completed) VALUES(?,?,?,?,?,?,?)`);
 const claims = sql('SELECT code_hash FROM image_claims WHERE user_id=? AND revoked=0');
 const allClaims = sql('SELECT user_id,code_hash FROM image_claims WHERE revoked=0');
 const claim = sql('INSERT OR IGNORE INTO image_claims(code_hash,user_id) VALUES(?,?)');
 const owner = sql('SELECT user_id,revoked FROM image_claims WHERE code_hash=?');
 const activity = sql(`INSERT INTO account_activity(day,user_id,kind,successes,errors) VALUES(?,?,?,?,?)
  ON CONFLICT(day,user_id,kind) DO UPDATE SET successes=successes+excluded.successes,errors=errors+excluded.errors`);
 const deleteActivity = sql('DELETE FROM account_activity WHERE day<?');
 const deleteSessions = sql('DELETE FROM sessions WHERE COALESCE(ended,expires)<?');
 const expireSessions = sql('UPDATE sessions SET ended=expires WHERE ended IS NULL AND expires<=?');
 const trackingSince = sql("SELECT value FROM account_meta WHERE key='tracking_since'").get().value;
 const legacyUntil = (id,now) => {
  let until=0;
  for(const {code_hash} of claims.all(id)){
   const expiry=expiryByHash.get(code_hash)||0;
   if(expiry>now)until=Math.max(until,expiry);
  }
  return until;
 };
 return {
  trackingSince,
  saveOnboarding(id,profile,now){
   saveOnboarding.run(id,profile.firstName,profile.lastName,profile.ageGroup,profile.role,JSON.stringify(profile.goals),now);
  },
  profile(user,now){
   const until=Math.max(user.subscription_until,legacyUntil(user.id,now));
   return {id:user.id,email:user.email,name:user.name,subscriptionUntil:until>now?until:null};
  },
  activeClaimDates(now){
   const active=new Map();
   for(const {user_id,code_hash} of allClaims.all()){
    const expiry=expiryByHash.get(code_hash)||0;
    if(expiry>now)active.set(user_id,Math.max(expiry,active.get(user_id)||0));
   }
   return active;
  },
  activate(userId,code,now){
   if(typeof code!=='string'||!/^[a-f0-9]{64}$/u.test(code))return false;
   const hash=digest(code);
   if((expiryByHash.get(hash)||0)<=now)return false;
   claim.run(hash,userId);
   const entry=owner.get(hash);
   return entry.user_id===userId&&!entry.revoked;
  },
  record(id,kind,ok,now){
   activity.run(dayKey(now),id,kind,ok?1:0,ok?0:1);
  },
  tidy(now){
   expireSessions.run(now);
   deleteSessions.run(now-90*DAY);
   deleteActivity.run(dayKey(now)-89);
  },
 };
}

export function sessionDevice(agent) {
 if(!agent)return 'Не определено';
 const browser=/Edg/i.test(agent)?'Edge':/Firefox|FxiOS/i.test(agent)?'Firefox':/Chrome|CriOS/i.test(agent)?'Chrome':/Safari/i.test(agent)?'Safari':'Браузер';
 const platform=/iPhone|iPad/i.test(agent)?'iOS':/Android/i.test(agent)?'Android':/Windows/i.test(agent)?'Windows':/Macintosh/i.test(agent)?'macOS':/Linux/i.test(agent)?'Linux':'';
 return platform?browser+' · '+platform:browser;
}
