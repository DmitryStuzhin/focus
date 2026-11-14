import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from '../scripts/server.mjs';
import {SmtpDeliveryError} from '../scripts/mail.mjs';

const loginEnv={
 FOCUS_AUTH_ENABLED:'1',
 FOCUS_AUTH_SECRET:'fixture-secret-for-focus-auth-tests',
 FOCUS_AUTH_DB:':memory:',
 FOCUS_SMTP_USER:'auth@example.com',
 FOCUS_SMTP_PASSWORD:'fixture',
};
const app={fetch:request=>new Response(new URL(request.url).pathname)};
const profile={firstName:'Анна',lastName:'Иванова',ageGroup:'18-24',role:'student',goals:['study','code']};
async function start(env,options){
 const server=createServer(env,app,options);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 return {
  base,
  close:()=>new Promise(resolve=>server.close(resolve)),
  get:(path,cookie)=>fetch(base+path,{redirect:'manual',headers:cookie?{cookie}:{}}),
  post:(path,body,headers={})=>fetch(base+path,{
   method:'POST',headers:{origin:env.PUBLIC_ORIGIN||base,'content-type':'application/json',...headers},
   body:JSON.stringify(body),
  }),
 };
}

test('a verified email opens a protected workspace and logout revokes the session',async()=>{
 const sent=[];
 const s=await start({...loginEnv,PUBLIC_ORIGIN:'https://focus.example'},{mailer:async message=>sent.push(message)});
 try{
  assert.equal((await s.get('/')).headers.get('location'),'/login');
  assert.equal((await s.get('/?example=tables')).headers.get('location'),'/login?example=tables');
  assert.equal((await s.get('/?example=https://other.example')).headers.get('location'),'/login');
  assert.equal((await s.get('/api/chat')).status,401);
  assert.deepEqual(await (await s.get('/api/auth/session')).json(),{enabled:true,user:null});
  const send=await s.post('/api/auth/request',{email:' Me@Example.com ',intent:'register'});
  assert.equal(send.status,200);
  const body=await send.json();
  assert.deepEqual(Object.keys(body).sort(),['challenge','resendAfter']);
  assert.equal(sent[0].to,'me@example.com');
  assert.equal(sent[0].from,'auth@example.com');
  assert.match(sent[0].code,/^\d{6}$/);
  const verify=await s.post('/api/auth/verify',{challenge:body.challenge,code:sent[0].code});
  assert.equal(verify.status,200);
  assert.equal(verify.headers.get('set-cookie'),null);
  const {registrationToken}=await verify.json();
  assert.equal((await s.get('/')).headers.get('location'),'/login');
  assert.equal((await s.post('/api/auth/register',{...profile,ageGroup:'invalid',registrationToken})).status,400);
  assert.equal((await s.post('/api/auth/register',{...profile,goals:['invalid'],registrationToken})).status,400);
  const created=await s.post('/api/auth/register',{...profile,registrationToken,email:'other@example.com',isAdmin:true});
  assert.equal(created.status,200);
  const {user}=await created.json();
  assert.equal(user.email,'me@example.com');
  assert.equal(user.name,'Анна Иванова');
  assert.equal(user.isAdmin,undefined);
  assert.equal((await s.post('/api/auth/register',{...profile,registrationToken})).status,400);
  const cookie=created.headers.get('set-cookie');
  assert.match(cookie,/^__Host-focus_session=/u);
  assert.match(cookie,/HttpOnly; SameSite=Lax; Secure/u);
  const session=cookie.split(';')[0];
  assert.equal((await s.get('/',session)).status,200);
  assert.equal((await s.get('/login',session)).headers.get('location'),'/');
  assert.equal((await s.get('/login?example=document',session)).headers.get('location'),'/?example=document');
  assert.equal((await s.get('/api/chat',session)).status,200);
  assert.equal((await s.post('/api/auth/verify',{challenge:body.challenge,code:sent[0].code})).status,400);
  assert.equal((await s.post('/api/auth/logout',{},{cookie:session,origin:'https://foreign.example'})).status,403);
  assert.equal((await s.post('/api/auth/logout',{},{cookie:session})).status,200);
  assert.equal((await s.get('/api/chat',session)).status,401);
 }finally{await s.close();}
});

test('OTP limits prevent immediate resends, guessing, and use of expired codes',async()=>{
 let now=Date.now();
 const sent=[];
 const s=await start(loginEnv,{clock:()=>now,mailer:async message=>sent.push(message)});
 try{
  const email='one@example.com';
  assert.equal((await s.post('/api/auth/request',{email},{origin:'https://foreign.example'})).status,403);
  assert.equal((await s.post('/api/auth/request',{email:'a@example.com\r\nBcc: b@example.com'})).status,400);
  const first=await (await s.post('/api/auth/request',{email})).json();
  now+=10_000;
  const limited=await s.post('/api/auth/request',{email});
  assert.equal(limited.status,429);
  assert.equal(limited.headers.get('retry-after'),'50');
  const wrong=sent[0].code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.equal((await s.post('/api/auth/verify',{challenge:first.challenge,code:wrong})).status,400);
  assert.equal((await s.post('/api/auth/verify',{challenge:first.challenge,code:sent[0].code})).status,400);
  now+=61_000;
  const second=await (await s.post('/api/auth/request',{email})).json();
  assert.equal((await s.post('/api/auth/verify',{challenge:first.challenge,code:sent[0].code})).status,400);
  now+=601_000;
  assert.equal((await s.post('/api/auth/verify',{challenge:second.challenge,code:sent[1].code})).status,400);
  assert.equal(sent.length,2);
 }finally{await s.close();}
});

test('OTP requests show the remaining wait for the longest active limit',async()=>{
 const started=Date.now();
 let now=started;
 const s=await start(loginEnv,{clock:()=>now,mailer:async()=>{}});
 try{
  const email='one@example.com';
  for(let i=0;i<5;i++){
   now=started+i*60_000;
   assert.equal((await s.post('/api/auth/request',{email})).status,200);
  }
  const limited=await s.post('/api/auth/request',{email});
  assert.equal(limited.status,429);
  assert.equal(limited.headers.get('retry-after'),'3360');
  now=started+3_600_000;
  assert.equal((await s.post('/api/auth/request',{email})).status,200);
 }finally{await s.close();}
});

test('failed SMTP connections preserve throttling without using the address delivery quota',async()=>{
 let now=Date.now(),attempts=0;
 const email='mail-failure@example.com';
 const s=await start(loginEnv,{clock:()=>now,mailer:async()=>{
  if(++attempts<=5)throw new SmtpDeliveryError(['SMTP connection failed before upload.'],false);
 }});
 try{
  for(let i=0;i<5;i++){
   const failed=await s.post('/api/auth/request',{email});
   assert.equal(failed.status,503);
   assert.equal((await failed.json()).code,'mail_delivery_failed');
   assert.equal((await s.post('/api/auth/request',{email})).status,429);
   now+=60_000;
  }
  assert.equal((await s.post('/api/auth/request',{email})).status,200);
  assert.equal(attempts,6);
 }finally{await s.close();}
});

test('verified registration expires without creating an account',async()=>{
 let now=Date.now(),code;
 const email='expired@example.com';
 const s=await start(loginEnv,{clock:()=>now,mailer:async message=>{code=message.code;}});
 try{
  const {challenge}=await (await s.post('/api/auth/request',{email,intent:'register'})).json();
  const {registrationToken}=await (await s.post('/api/auth/verify',{challenge,code})).json();
  now+=20*60_000;
  const expired=await s.post('/api/auth/register',{...profile,registrationToken});
  assert.equal(expired.status,400);
  assert.equal((await expired.json()).code,'registration_expired');
  const login=await (await s.post('/api/auth/request',{email,intent:'login'})).json();
  assert.equal((await s.post('/api/auth/verify',{challenge:login.challenge,code})).status,404);
 }finally{await s.close();}
});

test('the account and session survive a restart and the same email signs into the same account',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'focus-auth-test-'));
 const env={...loginEnv,FOCUS_AUTH_DB:join(dir,'accounts.sqlite')};
 let code,now=Date.now(),s;
 const options={clock:()=>now,mailer:async message=>{code=message.code;}};
 const signIn=async(intent='login')=>{
  const {challenge}=await (await s.post('/api/auth/request',{email:'account@example.com',intent})).json();
  return s.post('/api/auth/verify',{challenge,code});
 };
 try{
  s=await start(env,options);
  const unknown=await signIn();
  assert.equal(unknown.status,404);
  assert.equal((await unknown.json()).code,'registration_required');
  assert.equal(unknown.headers.get('set-cookie'),null);
  now+=61_000;
  const {registrationToken}=await (await signIn('register')).json();
  const first=await s.post('/api/auth/register',{...profile,registrationToken});
  const cookie=first.headers.get('set-cookie').split(';')[0];
  const {user}=await first.json();
  await s.close();
  s=null;
  s=await start(env,options);
  assert.deepEqual((await (await s.get('/api/auth/session',cookie)).json()).user,user);
  now+=61_000;
  const again=await signIn();
  assert.deepEqual((await again.json()).user,user);
  now+=61_000;
  const duplicate=await signIn('register');
  assert.equal(duplicate.status,409);
  assert.equal((await duplicate.json()).code,'account_exists');
  const db=new DatabaseSync(env.FOCUS_AUTH_DB,{readOnly:true});
  try{
   const record=db.prepare('SELECT * FROM account_onboarding WHERE user_id=?').get(user.id);
   assert.equal(record.first_name,profile.firstName);
   assert.equal(record.last_name,profile.lastName);
   assert.equal(record.age_group,profile.ageGroup);
   assert.equal(record.role,profile.role);
   assert.deepEqual(JSON.parse(record.goals),profile.goals);
  }finally{db.close();}
 }finally{if(s)await s.close();await rm(dir,{recursive:true,force:true});}
});

test('resends revoke previous codes and guessing is limited across challenges and IPs',async()=>{
 let now=Date.now();
 const sent=[];
 const s=await start({...loginEnv,TRUST_PROXY:'127.0.0.1'},{clock:()=>now,mailer:async msg=>sent.push(msg)});
 try{
  const email='limit@example.com', path='/api/auth/verify';
  const request=async()=>(await s.post('/api/auth/request',{email,intent:'register'})).json();
  let {challenge}=await request();
  const first=challenge;
  for(let round=0;round<2;round++){
   const actual=sent.at(-1).code;
   const wrong=actual==='000000'?'000001':'000000';
   for(let i=0;i<5;i++){
    const r=await s.post(path,{challenge,code:wrong},{'x-real-ip':`192.0.2.${1+round*5+i}`});
    assert.equal(r.status,400);
   }
   now+=61_000;
   ({challenge}=await request());
  }
  assert.equal((await s.post(path,{challenge:first,code:sent[0].code})).status,400);
  assert.equal((await s.post(path,{challenge,code:sent.at(-1).code},{'x-real-ip':'192.0.2.100'})).status,429);
  now+=15*60_000;
  const previous=(await request()).challenge;
  const previousCode=sent.at(-1).code;
  now+=61_000;
  ({challenge}=await request());
  assert.equal((await s.post(path,{challenge:previous,code:previousCode})).status,400);
  assert.equal((await s.post(path,{challenge,code:sent.at(-1).code})).status,200);
 }finally{await s.close();}
});

test('account deletion revokes sessions and removes cloud content',async()=>{
 const sent=[];
 const s=await start(loginEnv,{mailer:async mail=>sent.push(mail)});
 try{
  const email='delete@example.com';
  const {challenge}=await (await s.post('/api/auth/request',{email,intent:'register'})).json();
  const {registrationToken}=await (await s.post('/api/auth/verify',{challenge,code:sent[0].code})).json();
  const created=await s.post('/api/auth/register',{...profile,registrationToken});
  const cookie=created.headers.get('set-cookie').split(';')[0];
  const page=await s.post('/api/publications',{action:'create',chatId:'chat',version:'version',title:'Sample',html:'<html></html>'},{cookie});
  const {path}=await page.json();
  assert.equal((await s.get(path)).status,200);
  assert.equal((await s.post('/api/auth/delete',{email,confirm:false},{cookie})).status,400);
  const deleted=await s.post('/api/auth/delete',{email,confirm:true},{cookie});
  assert.equal(deleted.status,200);
  assert.match(deleted.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await s.get('/api/chat',cookie)).status,401);
  assert.equal((await s.get(path)).status,404);
 }finally{await s.close();}
});


test('registration accepts no profile fields and recommends a template when goals are supplied',async()=>{
 const sent=[];
 const s=await start(loginEnv,{mailer:async message=>sent.push(message)});
 try{
  for(const [email,fields,template] of [['optional@example.com',{},undefined],['work@example.com',{role:'business',goals:['work']},'tables']]){
   const {challenge}=await (await s.post('/api/auth/request',{email,intent:'register'})).json();
   const {registrationToken}=await (await s.post('/api/auth/verify',{challenge,code:sent.at(-1).code})).json();
   const created=await s.post('/api/auth/register',{registrationToken,...fields});
   assert.equal(created.status,200);
   const result=await created.json();
   assert.equal(result.user.email,email);
   assert.equal(result.user.name,'');
   assert.equal(result.starterTemplate,template);
  }
 }finally{await s.close();}
});
