import {createHash, createHmac, randomBytes, randomInt, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {sendLoginCode} from './mail.mjs';

const MINUTE = 60_000;
const CODE_TTL = 10 * MINUTE;
const SESSION_TTL = 30 * 24 * 60 * MINUTE;
const digest = value => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const headers = {'cache-control':'no-store', 'x-content-type-options':'nosniff'};
const json = (body, status=200, extra={}) => Response.json(body,{status,headers:{...headers,...extra}});
const error = (message,status,extra) => json({error:message},status,extra);
const redirect = location => new Response(null,{status:302,headers:{...headers,location}});

export function normalizeEmail(value) {
 const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
 if(email.length>254)return null;
 const [local,domain,...rest] = email.split('@');
 if(rest.length||!local||local.length>64||!domain)return null;
 if(!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u.test(local))return null;
 return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/u.test(domain)?email:null;
}

async function readJson(request) {
 if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type')||''))return null;
 const reader = request.body?.getReader();
 if(!reader)return null;
 const chunks = [];
 let size = 0;
 try{
  while(true){
   const {done,value} = await reader.read();
   if(done)break;
   size += value.byteLength;
   if(size>2048){void reader.cancel().catch(()=>{});return null;}
   chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return data && typeof data==='object' && !Array.isArray(data) ? data : null;
 }catch{return null;}
}

export function createAuth(env,{mailer=sendLoginCode,clock=Date.now}={}) {
 const enabled = env.FOCUS_AUTH_ENABLED==='1';
 if(!enabled)return {
  handle(request){return new URL(request.url).pathname==='/api/auth/session'?json({enabled:false,user:null}):null;},
  close(){},
 };
 const secret = env.FOCUS_AUTH_SECRET;
 const from = normalizeEmail(env.FOCUS_SMTP_USER);
 if(!secret||Buffer.byteLength(secret)<32||!from||!env.FOCUS_SMTP_PASSWORD||!env.FOCUS_AUTH_DB){
  throw new Error('Focus auth requires a secret, database path and SMTP credentials.');
 }
 const db = new DatabaseSync(env.FOCUS_AUTH_DB);
 db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=2500;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS challenges(
    id TEXT PRIMARY KEY, email TEXT NOT NULL, hash TEXT NOT NULL,
    expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS challenges_email ON challenges(email);
  CREATE TABLE IF NOT EXISTS auth_events(kind TEXT NOT NULL, identity TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS auth_events_recent ON auth_events(kind,identity,created);
 `);
 const sql = query => db.prepare(query);
 const count = sql('SELECT count(*) AS n FROM auth_events WHERE kind=? AND identity=? AND created>?');
 const record = sql('INSERT INTO auth_events VALUES(?,?,?)');
 const cleanupEvents = sql('DELETE FROM auth_events WHERE created<=?');
 const cleanupChallenges = sql('DELETE FROM challenges WHERE expires<=?');
 const cleanupSessions = sql('DELETE FROM sessions WHERE expires<=?');
 const insertChallenge = sql('INSERT INTO challenges(id,email,hash,expires) VALUES(?,?,?,?)');
 const markSent = sql('UPDATE challenges SET sent=1 WHERE id=?');
 const deleteChallenge = sql('DELETE FROM challenges WHERE id=?');
 const supersedeCodes = sql('DELETE FROM challenges WHERE email=? AND id<>?');
 const challengeById = sql('SELECT * FROM challenges WHERE id=? AND sent=1');
 const failAttempt = sql('UPDATE challenges SET attempts=attempts+1 WHERE id=?');
 const upsertUser = sql('INSERT INTO users VALUES(?,?,?) ON CONFLICT(email) DO NOTHING');
 const userByEmail = sql('SELECT id,email FROM users WHERE email=?');
 const insertSession = sql('INSERT INTO sessions VALUES(?,?,?)');
 const deleteSession = sql('DELETE FROM sessions WHERE token=?');
 const userBySession = sql('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?');
 const codeHash = (id,code) => createHmac('sha256',secret).update(id+':'+code).digest();
 const transaction = fn => {
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}
  catch(err){db.exec('ROLLBACK');throw err;}
 };
 let nextCleanup = 0;

 function tidy(now){
  if(now<nextCleanup)return;
  cleanupEvents.run(now-24*60*MINUTE);
  cleanupChallenges.run(now);
  cleanupSessions.run(now);
  nextCleanup=now+10*MINUTE;
 }
 function cookieName(secure){return secure?'__Host-focus_session':'focus_session';}
 function sessionToken(request,secure){
  const name = cookieName(secure)+'=';
  const token = request.headers.get('cookie')?.split(';').map(value=>value.trim())
   .find(value=>value.startsWith(name))?.slice(name.length);
  return token&&/^[A-Za-z0-9_-]{43}$/u.test(token)?digest(token):null;
 }
 function cookie(token,secure,seconds=SESSION_TTL/1000){
  return cookieName(secure)+'='+token+'; Path=/; Max-Age='+seconds+'; HttpOnly; SameSite=Lax'+(secure?'; Secure':'');
 }
 function checkLimits(limits,now){
  const blocked = limits.find(([kind,identity,period,max])=>count.get(kind,identity,now-period).n>=max);
  if(blocked){
   const seconds=Math.ceil(blocked[2]/1000);
   return error('Слишком много попыток. Попробуй позже.',429,{'retry-after':String(seconds)});
  }
  for(const [kind,identity] of limits)record.run(kind,identity,now);
  return null;
 }

 async function requestCode(body,ip,now){
  const email = normalizeEmail(body.email);
  if(!email)return error('Укажи корректный адрес электронной почты.',400);
  const emailKey = digest(email);
  const id = nonce();
  const code = String(randomInt(0,1_000_000)).padStart(6,'0');
  const limited = transaction(()=>{
   const limit = checkLimits([
    ['email-cooldown',emailKey,MINUTE,1],
    ['email-hour',emailKey,60*MINUTE,5],
    ['send-ip',ip,60*MINUTE,12],
    ['send-global','*',24*60*MINUTE,500],
   ],now);
   if(!limit)insertChallenge.run(id,email,codeHash(id,code).toString('hex'),now+CODE_TTL);
   return limit;
  });
  if(limited)return limited;
  try{
   await mailer({from,to:email,code,password:env.FOCUS_SMTP_PASSWORD,port:env.FOCUS_SMTP_PORT});
  }catch{
   deleteChallenge.run(id);
   console.error('Focus auth: SMTP delivery request failed.');
   return error('Не удалось отправить письмо. Попробуй через минуту.',503);
  }
  transaction(()=>{markSent.run(id);supersedeCodes.run(email,id);});
  return json({challenge:id,resendAfter:60});
 }

 function verifyCode(body,ip,secure,now){
  const {challenge:id,code} = body;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(id)||typeof code!=='string'||!/^\d{6}$/u.test(code)){
   return error('Введи шестизначный код из письма.',400);
  }
  return transaction(()=>{
   const limit = checkLimits([['verify-ip',ip,15*MINUTE,50]],now);
   if(limit)return limit;
   const entry = challengeById.get(id);
   if(!entry||entry.expires<=now||entry.attempts>=5)return error('Этот код больше не действует. Запроси новый.',400);
   if(!timingSafeEqual(Buffer.from(entry.hash,'hex'),codeHash(id,code))){
    failAttempt.run(id);
    return error(entry.attempts===4?'Попытки закончились. Запроси новый код.':'Код не совпал. Проверь письмо.',400);
   }
   deleteChallenge.run(id);
   upsertUser.run(nonce(),entry.email,now);
   const user = userByEmail.get(entry.email);
   const token = nonce();
   insertSession.run(digest(token),user.id,now+SESSION_TTL);
   return json({user},200,{'set-cookie':cookie(token,secure)});
  });
 }

 return {
  async handle(request,pathname,ip){
   const url = new URL(request.url);
   const path = pathname || url.pathname;
   const secure = url.protocol==='https:';
   const now = clock();
   tidy(now);
   const token = sessionToken(request,secure);
   const user = token ? userBySession.get(token,now)||null : null;
   if(path==='/login'&&user&&['GET','HEAD'].includes(request.method))return redirect('/');
   if(path==='/api/auth/session'){
    return request.method==='GET'?json({enabled:true,user}):error('Метод не поддерживается.',405);
   }
   if(!path.startsWith('/api/auth/')){
    if(user)return null;
    if((path==='/'||path==='/index.html')&&['GET','HEAD'].includes(request.method))return redirect('/login');
    return path.startsWith('/api/')?error('Войди в Focus, чтобы продолжить.',401):null;
   }
   if(!['/api/auth/request','/api/auth/verify','/api/auth/logout'].includes(path))return error('Страница не найдена.',404);
   if(request.method!=='POST')return error('Метод не поддерживается.',405);
   if(request.headers.get('origin')!==url.origin)return error('Запрос отклонён.',403);
   if(!secure&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return error('Для входа требуется HTTPS.',403);
   if(path==='/api/auth/logout'){
    if(token)deleteSession.run(token);
    return json({ok:true},200,{'set-cookie':cookie('',secure,0)});
   }
   const body = await readJson(request);
   if(!body)return error('Не удалось прочитать данные запроса.',400);
   const client = digest(ip||'local');
   return path==='/api/auth/request'?requestCode(body,client,now):verifyCode(body,client,secure,now);
  },
  close(){db.close();},
 };
}
