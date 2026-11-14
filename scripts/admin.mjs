import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {DAY, MOSCOW_OFFSET, dayKey, digest, nonce, transaction} from './accounts.mjs';
import {json,error,readJson,secureTransport,trustedOrigin} from './auth-http.mjs';

const derive = promisify(scrypt);
const scryptOptions = {N:32768,r:8,p:3,maxmem:64*1024*1024};
const loginPattern = /^[A-Za-z0-9_.-]{3,64}$/u;
const hashPattern = /^([a-f0-9]{32}):([a-f0-9]{64})$/u;
const maxPassword = 200;
const sessionDuration = 8 * 3_600_000;
const attemptWindow = 15 * 60_000;
const pageSize = 25;
const isPassword = value=>typeof value==='string'&&value.length>=14&&Buffer.byteLength(value)<=maxPassword;

export function validAdminLogin(login){return typeof login==='string'&&loginPattern.test(login);}
export async function hashAdminPassword(password){
 if(!isPassword(password))throw new Error('Password must be at least 14 characters and at most 200 UTF-8 bytes.');
 const salt=randomBytes(16);
 const hash=await derive(password,salt,32,scryptOptions);
 return salt.toString('hex')+':'+hash.toString('hex');
}

function pageNumber(value){
 const number=Number(value);
 return Number.isSafeInteger(number)&&number>=1?Math.min(number,100000):1;
}

export function createAdmin(db,env,accounts,emailEnabled){
 const login=env.FOCUS_ADMIN_LOGIN;
 const stored=hashPattern.exec(env.FOCUS_ADMIN_PASSWORD_HASH||'');
 const passwordEnabled=validAdminLogin(login)&&!!stored;
 if(!passwordEnabled&&!emailEnabled)return (request,url)=>url.pathname==='/api/admin/session'&&request.method==='GET'
  ?json({enabled:false,authenticated:false}):error('Админка ещё не настроена.',503);

 const salt=passwordEnabled?Buffer.from(stored[1],'hex'):null;
 const passwordHash=passwordEnabled?Buffer.from(stored[2],'hex'):null;
 const binding=digest(login+'\0'+env.FOCUS_ADMIN_PASSWORD_HASH);
 db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,binding TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_attempts(ip TEXT NOT NULL,created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS admin_attempts_created ON admin_attempts(created);
  CREATE TABLE IF NOT EXISTS admin_login_audit(
   id INTEGER PRIMARY KEY, ip TEXT NOT NULL, created INTEGER NOT NULL,
   result TEXT NOT NULL, session TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS admin_login_audit_created ON admin_login_audit(created);
 `);
 db.function('focus_fold',{deterministic:true},value=>String(value??'').toLocaleLowerCase('ru'));
 const sql=query=>db.prepare(query);
 const insertAdminSession=sql('INSERT INTO admin_sessions VALUES(?,?,?)');
 const findAdminSession=sql('SELECT 1 FROM admin_sessions WHERE token=? AND binding=? AND expires>?');
 const deleteAdminSession=sql('DELETE FROM admin_sessions WHERE token=?');
 const cleanupAdminSessions=sql('DELETE FROM admin_sessions WHERE binding<>? OR expires<=?');
 const recordAttempt=sql('INSERT INTO admin_attempts VALUES(?,?)');
 const cleanupAttempts=sql('DELETE FROM admin_attempts WHERE created<=?');
 const resetAttempts=sql('DELETE FROM admin_attempts WHERE ip=?');
 const audit=sql('INSERT OR IGNORE INTO admin_login_audit(ip,created,result,session) VALUES(?,?,?,?)');
 const cleanupAudit=sql('DELETE FROM admin_login_audit WHERE created<=?');
 const attempts=sql('SELECT count(*) AS total,coalesce(sum(ip=?),0) AS client FROM admin_attempts');
 const accountById=sql('SELECT id,email,name,subscription_until FROM users WHERE id=?');
 const blockAccount=sql('UPDATE users SET blocked=? WHERE id=?');
 const endUserSessions=sql('UPDATE sessions SET ended=? WHERE user_id=? AND ended IS NULL AND expires>?');
 const endSession=sql('UPDATE sessions SET ended=? WHERE id=? AND ended IS NULL AND expires>?');
 const setSubscription=sql('UPDATE users SET subscription_until=? WHERE id=?');
 const revokeClaims=sql('UPDATE image_claims SET revoked=1 WHERE user_id=?');
 let checkingPassword=false;

 function cookie(value,secure,age=sessionDuration/1000){
  return (secure?'__Host-focus_admin':'focus_admin')+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(secure?'; Secure':'');
 }
 function token(request,secure){
  const key=(secure?'__Host-focus_admin':'focus_admin')+'=';
  const value=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(key))?.slice(key.length);
  return value&&/^[A-Za-z0-9_-]{43}$/u.test(value)?digest(value):null;
 }

 async function signIn(body,ip,secure,now){
  if(checkingPassword)return error('Проверка уже выполняется. Повторите попытку.',429,{'retry-after':'1'});
  const allowed=transaction(db,()=>{
   cleanupAttempts.run(now-attemptWindow);
   const {total,client}=attempts.get(ip);
   if(total>=60||client>=5)return false;
   recordAttempt.run(ip,now);
   return true;
  });
  if(!allowed){
   return error('Слишком много попыток. Повторите через 15 минут.',429,{'retry-after':'900'});
  }
  checkingPassword=true;
  try{
   const hash=isPassword(body.password)?await derive(body.password,salt,32,scryptOptions):null;
   if(!hash||!timingSafeEqual(hash,passwordHash)||body.login!==login){
    audit.run(ip,now,'password_rejected',null);
    return error('Неверный логин или пароль.',401);
   }
   const value=nonce();
   transaction(db,()=>{
    resetAttempts.run(ip);
    cleanupAdminSessions.run(binding,now);
    insertAdminSession.run(digest(value),binding,now+sessionDuration);
    audit.run(ip,now,'password_accepted',null);
   });
   return json({authenticated:true,login},200,{'set-cookie':cookie(value,secure)});
  }finally{checkingPassword=false;}
 }

 function overview(days,now){
  const today=dayKey(now), first=today-days+1;
  const group='CAST((%FIELD% + '+MOSCOW_OFFSET+') / '+DAY+' AS INTEGER)';
  const readEvents=(table,field)=>{
   const timestamp=group.replace('%FIELD%',field);
   return sql('SELECT '+timestamp+' AS day,count(*) AS total FROM '+table+' WHERE '+field+'>=? GROUP BY day')
    .all(first*DAY-MOSCOW_OFFSET);
  };
  const series=Array.from({length:days},(_,i)=>({day:first+i,registrations:0,logins:0,chat:0,site:0,image:0,search:0,errors:0}));
  for(const {day,total} of readEvents('users','created'))if(series[day-first])series[day-first].registrations=total;
  for(const {day,total} of readEvents('sessions','started'))if(series[day-first])series[day-first].logins=total;
  for(const {day,kind,successes,errors} of sql('SELECT day,kind,sum(successes) AS successes,sum(errors) AS errors FROM account_activity WHERE day>=? GROUP BY day,kind').all(first)){
   const point=series[day-first];
   if(point){point[kind]=successes;point.errors+=errors;}
  }
  const entitlements=accounts.activeClaimDates(now);
  const users=sql('SELECT id,subscription_until,blocked FROM users').all();
  const activeSessions=sql('SELECT count(*) AS total FROM sessions WHERE ended IS NULL AND expires>?').get(now).total;
  const activeToday=sql('SELECT count(DISTINCT user_id) AS total FROM sessions WHERE last_seen>=?').get(today*DAY-MOSCOW_OFFSET).total;
  const totals={
   users:users.length,activeSessions,activeToday,
   subscribed:users.filter(user=>!user.blocked&&Math.max(user.subscription_until,entitlements.get(user.id)||0)>now).length,
   blocked:users.filter(user=>user.blocked).length,
  };
  return json({totals,series,trackingSince:accounts.trackingSince});
 }

 function listAccounts(url,now){
  const page=pageNumber(url.searchParams.get('page'));
  const query=(url.searchParams.get('q')||'').trim().slice(0,120).toLocaleLowerCase('ru');
  const where="WHERE instr(focus_fold(u.name),?)>0 OR instr(u.email,?)>0";
  const total=sql('SELECT count(*) AS total FROM users u '+where).get(query,query).total;
  const rows=sql(`SELECT u.id,u.email,u.name,u.created,u.blocked,u.subscription_until,
    (SELECT count(*) FROM sessions s WHERE s.user_id=u.id AND s.ended IS NULL AND s.expires>?) AS activeSessions,
    (SELECT max(last_seen) FROM sessions s WHERE s.user_id=u.id) AS lastSeen
   FROM users u ${where} ORDER BY u.created DESC,u.id LIMIT ? OFFSET ?`).all(now,query,query,pageSize,(page-1)*pageSize);
  const items=rows.map(({created,blocked,activeSessions,lastSeen,...row})=>({
   ...accounts.profile(row,now),created,blocked:!!blocked,activeSessions,lastSeen,
  }));
  return json({items,total,page,pageSize});
 }

 function listSessions(url,now){
  const page=pageNumber(url.searchParams.get('page'));
  const userId=url.searchParams.get('userId')||'';
  const where="WHERE (?='' OR s.user_id=?)";
  const total=sql('SELECT count(*) AS total FROM sessions s '+where).get(userId,userId).total;
  const items=sql(`SELECT s.id,s.user_id AS userId,u.email,u.name,s.device,s.started,s.last_seen AS lastSeen,s.expires,
   COALESCE(s.ended,CASE WHEN s.expires<=? THEN s.expires END) AS ended
   FROM sessions s JOIN users u ON u.id=s.user_id ${where}
   ORDER BY (s.ended IS NOT NULL OR s.expires<=?),s.expires DESC,s.id LIMIT ? OFFSET ?`).all(now,userId,userId,now,pageSize,(page-1)*pageSize);
  return json({items,total,page,pageSize});
 }

 function manage(body,now){
  const {action,id}=body;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/u.test(id))return error('Некорректный идентификатор.',400);
  if(action==='end-session')return endSession.run(now,id,now).changes?json({ok:true}):error('Сессия уже завершена или не найдена.',404);
  const account=accountById.get(id);
  if(!account)return error('Аккаунт не найден.',404);
  switch(action){
   case 'end-user-sessions':endUserSessions.run(now,id,now);break;
   case 'block':
    transaction(db,()=>{blockAccount.run(1,id);endUserSessions.run(now,id,now);});
    break;
   case 'unblock':blockAccount.run(0,id);break;
   case 'grant':
    if(!Number.isInteger(body.days)||body.days<1||body.days>365)return error('Введите число дней от 1 до 365.',400);
    transaction(db,()=>{
     const profile=accounts.profile(accountById.get(id),now);
     setSubscription.run(Math.max(now,profile.subscriptionUntil||0)+body.days*DAY,id);
    });
    break;
   case 'revoke':
    transaction(db,()=>{setSubscription.run(0,id);revokeClaims.run(id);});
    break;
   default:return error('Неизвестное действие.',400);
  }
  return json({ok:true});
 }

 return async function handleAdmin(request,url,ip,now,sessionEmail,sessionHash){
  if(!secureTransport(url))return error('Для входа требуется HTTPS.',403);
  const {pathname}=url, secure=url.protocol==='https:';
  const current=token(request,secure);
  cleanupAudit.run(now-90*DAY);
  if(sessionEmail&&sessionHash)audit.run(ip,now,'verified_email_access',sessionHash);
  const authenticated=!!sessionEmail||(passwordEnabled&&!!current&&!!findAdminSession.get(current,binding,now));
  if(request.method==='GET'&&pathname==='/api/admin/session'){
   return json({enabled:true,authenticated,passwordEnabled,...(authenticated?{login:sessionEmail||login}:{}),...(sessionEmail?{viaFocus:true}:{})});
  }
  if(request.method==='POST'&&!trustedOrigin(request,url))return error('Запрос отклонён.',403);
  if(request.method==='POST'&&pathname==='/api/admin/login'){
   if(!passwordEnabled)return error('Войди в Focus под аккаунтом администратора.',401);
   const body=await readJson(request);
   return body?signIn(body,ip,secure,now):error('Не удалось прочитать запрос.',400);
  }
  if(!authenticated)return error('Войдите в админку.',401);
  if(request.method==='POST'&&pathname==='/api/admin/logout'){
   if(current)deleteAdminSession.run(current);
   return json({ok:true},200,{'set-cookie':cookie('',secure,0)});
  }
  if(request.method==='POST'&&pathname==='/api/admin/manage'){
   const body=await readJson(request);
   return body?manage(body,now):error('Не удалось прочитать запрос.',400);
  }
  if(request.method!=='GET')return error('Метод не поддерживается.',405);
  if(pathname==='/api/admin/overview'){
   const days=Number(url.searchParams.get('days'));
   return overview([7,30,90].includes(days)?days:30,now);
  }
  if(pathname==='/api/admin/users')return listAccounts(url,now);
  if(pathname==='/api/admin/sessions')return listSessions(url,now);
  return error('Страница не найдена.',404);
 };
}
