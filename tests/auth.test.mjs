import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../scripts/server.mjs';

const loginEnv={
 FOCUS_AUTH_ENABLED:'1',
 FOCUS_AUTH_SECRET:'fixture-secret-for-focus-auth-tests',
 FOCUS_AUTH_DB:':memory:',
 FOCUS_SMTP_USER:'auth@example.com',
 FOCUS_SMTP_PASSWORD:'fixture',
};
const app={fetch:request=>new Response(new URL(request.url).pathname)};
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
  assert.equal((await s.get('/api/chat')).status,401);
  assert.deepEqual(await (await s.get('/api/auth/session')).json(),{enabled:true,user:null});
  const send=await s.post('/api/auth/request',{email:' Me@Example.com '});
  assert.equal(send.status,200);
  const body=await send.json();
  assert.deepEqual(Object.keys(body).sort(),['challenge','resendAfter']);
  assert.equal(sent[0].to,'me@example.com');
  assert.equal(sent[0].from,'auth@example.com');
  assert.match(sent[0].code,/^\d{6}$/);
  const verify=await s.post('/api/auth/verify',{challenge:body.challenge,code:sent[0].code});
  assert.equal(verify.status,200);
  const cookie=verify.headers.get('set-cookie');
  assert.match(cookie,/^__Host-focus_session=/u);
  assert.match(cookie,/HttpOnly; SameSite=Lax; Secure/u);
  const session=cookie.split(';')[0];
  assert.equal((await s.get('/',session)).status,200);
  assert.equal((await s.get('/login',session)).headers.get('location'),'/');
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
  assert.equal((await s.post('/api/auth/request',{email})).status,429);
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

test('the account and session survive a restart and the same email signs into the same account',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'focus-auth-test-'));
 const env={...loginEnv,FOCUS_AUTH_DB:join(dir,'accounts.sqlite')};
 let code,now=Date.now(),s;
 const options={clock:()=>now,mailer:async message=>{code=message.code;}};
 const signIn=async()=>{
  const {challenge}=await (await s.post('/api/auth/request',{email:'account@example.com'})).json();
  return s.post('/api/auth/verify',{challenge,code});
 };
 try{
  s=await start(env,options);
  const first=await signIn();
  const cookie=first.headers.get('set-cookie').split(';')[0];
  const {user}=await first.json();
  await s.close();
  s=null;
  s=await start(env,options);
  assert.deepEqual((await (await s.get('/api/auth/session',cookie)).json()).user,user);
  now+=61_000;
  const again=await signIn();
  assert.deepEqual((await again.json()).user,user);
 }finally{if(s)await s.close();await rm(dir,{recursive:true,force:true});}
});
