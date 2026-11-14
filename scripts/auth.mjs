import {createHmac, randomInt, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {sendLoginCode,sendLoginCodeViaPostbox,MailDeliveryError} from './mail.mjs';
import {createAccountStore,digest,nonce,transaction,sessionDevice,DAY} from './accounts.mjs';
import {createAdmin} from './admin.mjs';
import {createWorkspace} from './workspace.mjs';
import {createJobs} from './jobs.mjs';
import {json,error,readJson} from './auth-http.mjs';
import {ages,goals,roles} from '../public/onboarding.js';

const MINUTE = 60_000;
const CODE_TTL = 10 * MINUTE;
const REGISTRATION_TTL = 20 * MINUTE;
const SESSION_TTL = 30 * DAY;
const redirect = location => new Response(null,{status:302,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',location}});

export function normalizeEmail(value) {
 const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
 if(email.length>254)return null;
 const [local,domain,...rest] = email.split('@');
 if(rest.length||!local||local.length>64||!domain)return null;
 if(!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u.test(local))return null;
 return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/u.test(domain)?email:null;
}

function registrationProfile(body){
 const name = value => typeof value==='string' ? value.trim().normalize('NFC') : '';
 const firstName=name(body.firstName),lastName=name(body.lastName);
 const validName = value => value.length<=39&&/\p{L}/u.test(value)&&!/[\p{Cc}\p{Cf}]/u.test(value);
 if(!validName(firstName)||!validName(lastName))return 'Укажи имя и фамилию (до 39 символов в каждом поле).';
 const {ageGroup,role,goals:selected}=body;
 if(typeof ageGroup!=='string'||!Object.hasOwn(ages,ageGroup))return 'Выбери свою возрастную группу.';
 if(typeof role!=='string'||!Object.hasOwn(roles,role))return 'Выбери, чем ты занимаешься.';
 if(!Array.isArray(selected)||!selected.length||selected.length>Object.keys(goals).length||
  selected.some(value=>typeof value!=='string'||!Object.hasOwn(goals,value)))return 'Выбери, для чего тебе нужен Focus.';
 return {firstName,lastName,ageGroup,role,goals:[...new Set(selected)]};
}


export function createAuth(env,{mailer,clock=Date.now}={}) {
 const enabled = env.FOCUS_AUTH_ENABLED==='1';
 if(!enabled)return {
  handle(request){
   const path=new URL(request.url).pathname;
   if(path==='/api/auth/session')return json({enabled:false,user:null});
   if(path==='/api/admin/session')return json({enabled:false,authenticated:false});
   return path.startsWith('/api/admin/')?error('Админка ещё не настроена.',503):null;
  },
  close(){},
 };
 const secret = env.FOCUS_AUTH_SECRET;
 const {FOCUS_POSTBOX_KEY_ID:keyId,FOCUS_POSTBOX_KEY_SECRET:keySecret}=env;
 const usePostbox=!!(keyId||keySecret);
 const from=normalizeEmail(usePostbox?env.FOCUS_MAIL_FROM:env.FOCUS_SMTP_USER);
 const deliver=mailer??(usePostbox?sendLoginCodeViaPostbox:sendLoginCode);
 const credentials=usePostbox?{keyId,keySecret}:{password:env.FOCUS_SMTP_PASSWORD,port:env.FOCUS_SMTP_PORT};
 const adminEmail = normalizeEmail(env.FOCUS_ADMIN_EMAIL);
 if(!secret||Buffer.byteLength(secret)<32||!from||!(usePostbox?keyId&&keySecret:env.FOCUS_SMTP_PASSWORD)||!env.FOCUS_AUTH_DB){
  throw new Error('Focus auth requires a secret, database path and configured mail transport.');
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
  CREATE TABLE IF NOT EXISTS registration_tokens(
    token TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_events(kind TEXT NOT NULL, identity TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS auth_events_recent ON auth_events(kind,identity,created);
 `);
 transaction(db,()=>{
  if(!db.prepare('PRAGMA table_info(challenges)').all().some(column=>column.name==='intent')){
   db.exec("ALTER TABLE challenges ADD COLUMN intent TEXT NOT NULL DEFAULT 'login'");
  }
 });
 const accounts=createAccountStore(db,env,clock());
 const admin=createAdmin(db,env,accounts,!!adminEmail);
 const workspaceRequest=createWorkspace(db);
 const jobs=createJobs(db);
 const sql = query => db.prepare(query);
 const limitEvent = sql(`SELECT created FROM auth_events
  WHERE kind=? AND identity=? AND created>? ORDER BY created DESC LIMIT 1 OFFSET ?`);
 const record = sql('INSERT INTO auth_events VALUES(?,?,?)');
 const releaseEmailSend = sql("DELETE FROM auth_events WHERE rowid=? AND kind='email-hour' AND identity=? AND created=?");
 const cleanupEvents = sql('DELETE FROM auth_events WHERE created<=?');
 const cleanupChallenges = sql('DELETE FROM challenges WHERE expires<=?');
 const cleanupRegistrations = sql('DELETE FROM registration_tokens WHERE expires<=?');
 const insertChallenge = sql('INSERT INTO challenges(id,email,hash,expires,intent) VALUES(?,?,?,?,?)');
 const markSent = sql('UPDATE challenges SET sent=1 WHERE id=?');
 const deleteChallenge = sql('DELETE FROM challenges WHERE id=?');
 const supersedeCodes = sql('DELETE FROM challenges WHERE email=? AND rowid<(SELECT rowid FROM challenges WHERE id=?)');
 const challengeById = sql('SELECT * FROM challenges WHERE id=? AND sent=1');
 const failAttempt = sql('UPDATE challenges SET attempts=attempts+1 WHERE id=?');
 const insertRegistration = sql(`INSERT INTO registration_tokens(token,email,expires) VALUES(?,?,?)
  ON CONFLICT(email) DO UPDATE SET token=excluded.token,expires=excluded.expires`);
 const registrationByToken = sql('SELECT email FROM registration_tokens WHERE token=? AND expires>?');
 const deleteRegistration = sql('DELETE FROM registration_tokens WHERE token=?');
 const insertUser = sql('INSERT INTO users(id,email,name,created) VALUES(?,?,?,?)');
 const userByEmail = sql('SELECT id,email,name,blocked,subscription_until FROM users WHERE email=?');
 const insertSession = sql('INSERT INTO sessions(token,user_id,expires,id,started,last_seen,device) VALUES(?,?,?,?,?,?,?)');
 const endSession = sql('UPDATE sessions SET ended=? WHERE token=? AND ended IS NULL');
 const touchSession = sql('UPDATE sessions SET last_seen=? WHERE token=? AND (last_seen IS NULL OR last_seen<?)');
 const userBySession = sql(`SELECT users.id,users.email,users.name,users.subscription_until
  FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND ended IS NULL AND users.blocked=0`);
 const setName = sql('UPDATE users SET name=? WHERE id=?');
 const codeHash = (id,code) => createHmac('sha256',secret).update(id+':'+code).digest();
 const isAdmin = user => !!adminEmail&&user?.email===adminEmail;
 const sessionProfile = (user,now) => ({...accounts.profile(user,now),...(isAdmin(user)?{isAdmin:true}:{})});
 let nextCleanup = 0;

 function tidy(now){
  if(now<nextCleanup)return;
  cleanupEvents.run(now-24*60*MINUTE);
  cleanupChallenges.run(now);
  cleanupRegistrations.run(now);
  accounts.tidy(now);
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
 function openSession(user,secure,now,agent){
  const token = nonce();
  insertSession.run(digest(token),user.id,now+SESSION_TTL,nonce(),now,now,sessionDevice(agent));
  return json({user:sessionProfile(user,now)},200,{'set-cookie':cookie(token,secure)});
 }
 function checkLimits(limits,now){
  let retryAt = now;
  for(const [kind,identity,period,max] of limits){
   const event = limitEvent.get(kind,identity,now-period,max-1);
   if(event)retryAt=Math.max(retryAt,event.created+period);
  }
  if(retryAt>now){
   const seconds=Math.ceil((retryAt-now)/1000);
   return error('Слишком много попыток. Попробуй позже.',429,{'retry-after':String(seconds)});
  }
  return null;
 }

 async function requestCode(body,ip,now){
  const email = normalizeEmail(body.email);
  if(!email)return error('Укажи корректный адрес электронной почты.',400);
  const intent=body.intent??'login';
  if(intent!=='login'&&intent!=='register')return error('Выбери вход или регистрацию.',400);
  const emailKey = digest(email);
  const id = nonce();
  const code = String(randomInt(0,1_000_000)).padStart(6,'0');
  const blocked = !!userByEmail.get(email)?.blocked;
  const {limited,emailSend} = transaction(db,()=>{
   const limits = [
    ['email-cooldown',emailKey,MINUTE,1],
    ['email-hour',emailKey,60*MINUTE,5],
    ['send-ip',ip,60*MINUTE,12],
    ['send-global','*',24*60*MINUTE,500],
   ];
   const limited=checkLimits(limits,now);
   if(limited)return {limited};
   let emailSend;
   for(const [kind,identity] of limits){
    const event=record.run(kind,identity,now);
    if(kind==='email-hour')emailSend=event.lastInsertRowid;
   }
   if(!blocked)insertChallenge.run(id,email,codeHash(id,code).toString('hex'),now+CODE_TTL,intent);
   return {emailSend};
  });
  if(limited)return limited;
  if(blocked)return json({challenge:id,resendAfter:60});
  try{
   await deliver({from,to:email,code,...credentials});
  }catch(failure){
   transaction(db,()=>{
    deleteChallenge.run(id);
    if(failure instanceof MailDeliveryError&&!failure.deliveryUncertain)releaseEmailSend.run(emailSend,emailKey,now);
   });
   const diagnostic=failure instanceof MailDeliveryError?failure.message:'Unknown mailer error.';
   console.error('Focus auth: mail delivery request failed. '+diagnostic.replaceAll('\n',' '));
   return json({error:'Не удалось отправить письмо. Попробуй через минуту.',code:'mail_delivery_failed'},503);
  }
  transaction(db,()=>{markSent.run(id);supersedeCodes.run(email,id);});
  return json({challenge:id,resendAfter:60});
 }

 function verifyCode(body,ip,secure,now,agent){
  const {challenge:id,code} = body;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(id)||typeof code!=='string'||!/^\d{6}$/u.test(code)){
   return error('Введи шестизначный код из письма.',400);
  }
  return transaction(db,()=>{
   const limit = checkLimits([['verify-ip',ip,15*MINUTE,50]],now);
   if(limit)return limit;
   record.run('verify-ip',ip,now);
   const entry = challengeById.get(id);
   if(!entry||entry.expires<=now||entry.attempts>=5)return error('Этот код больше не действует. Запроси новый.',400);
   if(!timingSafeEqual(Buffer.from(entry.hash,'hex'),codeHash(id,code))){
    failAttempt.run(id);
    return error(entry.attempts===4?'Попытки закончились. Запроси новый код.':'Код не совпал. Проверь письмо.',400);
   }
   deleteChallenge.run(id);
   const user = userByEmail.get(entry.email);
   if(user?.blocked)return error('Доступ к аккаунту ограничен.',403);
   if(entry.intent==='login'){
    if(!user)return json({error:'У этой почты ещё нет аккаунта. Выбери регистрацию.',code:'registration_required'},404);
    return openSession(user,secure,now,agent);
   }
   if(user)return json({error:'У этой почты уже есть аккаунт. Выбери вход.',code:'account_exists'},409);
   const registrationToken=nonce();
   insertRegistration.run(digest(registrationToken),entry.email,now+REGISTRATION_TTL);
   return json({registrationToken});
  });
 }

 function register(body,secure,now,agent){
  const {registrationToken}=body;
  const expired=()=>json({error:'Подтверди почту новым кодом, чтобы завершить регистрацию.',code:'registration_expired'},400);
  if(typeof registrationToken!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(registrationToken))return expired();
  const profile=registrationProfile(body);
  if(typeof profile==='string')return error(profile,400);
  return transaction(db,()=>{
   const hash=digest(registrationToken);
   const entry=registrationByToken.get(hash,now);
   if(!entry)return expired();
   deleteRegistration.run(hash);
   if(userByEmail.get(entry.email))return json({error:'У этой почты уже есть аккаунт. Выбери вход.',code:'account_exists'},409);
   const id=nonce();
   insertUser.run(id,entry.email,profile.firstName+' '+profile.lastName,now);
   accounts.saveOnboarding(id,profile,now);
   return openSession(userByEmail.get(entry.email),secure,now,agent);
  });
 }

 return {
  async handle(request,pathname,ip,context={}){
   const url = new URL(request.url);
   const path = pathname || url.pathname;
   const secure = url.protocol==='https:';
   const now = clock();
   tidy(now);
   const client = digest(ip||'local');
   const token = sessionToken(request,secure);
   const user = token ? userBySession.get(token,now)||null : null;
   if(path.startsWith('/api/admin/'))return admin(request,url,client,now,isAdmin(user)?user.email:null);
   const workspace=await workspaceRequest(request,url,user,now);
   if(workspace)return workspace;
   const job=await jobs.handle(request,url,user,now,context.runBackground);
   if(job)return job;
   if(user&&(path==='/'||path.startsWith('/api/')))touchSession.run(now,token,now-MINUTE);
   if(path==='/login'&&user&&['GET','HEAD'].includes(request.method))return redirect('/');
   if(path==='/api/auth/session'){
    return request.method==='GET'?json({enabled:true,user:user?sessionProfile(user,now):null}):error('Метод не поддерживается.',405);
   }
   if(!path.startsWith('/api/auth/')){
    if(user){
     context.userId=user.id;
     if(path==='/api/chat'&&request.method==='POST'){
      const code=request.headers.get('x-focus-image-pass');
      if(code&&request.headers.get('origin')===url.origin)accounts.activate(user.id,code,now);
      context.accountPaid=!!accounts.profile(user,now).subscriptionUntil;
     }
     return null;
    }
    if((path==='/'||path==='/index.html')&&['GET','HEAD'].includes(request.method))return redirect('/login');
    return path.startsWith('/api/')?error('Войди в Focus, чтобы продолжить.',401):null;
   }
   if(!['/api/auth/request','/api/auth/verify','/api/auth/register','/api/auth/logout','/api/auth/profile','/api/auth/subscription'].includes(path))return error('Страница не найдена.',404);
   if(request.method!=='POST')return error('Метод не поддерживается.',405);
   if(request.headers.get('origin')!==url.origin)return error('Запрос отклонён.',403);
   if(!secure&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return error('Для входа требуется HTTPS.',403);
   if(path==='/api/auth/logout'){
    if(token)endSession.run(now,token);
    return json({ok:true},200,{'set-cookie':cookie('',secure,0)});
   }
   const body = await readJson(request);
   if(!body)return error('Не удалось прочитать данные запроса.',400);
   if(path==='/api/auth/request')return requestCode(body,client,now);
   if(path==='/api/auth/verify')return verifyCode(body,client,secure,now,request.headers.get('user-agent'));
   if(path==='/api/auth/register')return register(body,secure,now,request.headers.get('user-agent'));
   if(!user)return error('Войди в Focus, чтобы продолжить.',401);
   if(path==='/api/auth/profile'){
    if(typeof body.name!=='string'||body.name.trim().length>80||/[\p{Cc}\p{Cf}]/u.test(body.name))return error('Укажи имя длиной до 80 символов.',400);
    user.name=body.name.trim();
    setName.run(user.name,user.id);
   }else if(!accounts.activate(user.id,body.code,now)){
    return error('Код недействителен, истёк или уже связан с другим аккаунтом.',400);
   }
   return json({user:sessionProfile(user,now)});
  },
  record(id,kind,ok){accounts.record(id,kind,ok,clock());},
  close(){jobs.close();db.close();},
 };
}
