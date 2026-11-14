import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from '../scripts/server.mjs';
import {digest,DAY} from '../scripts/accounts.mjs';
import {hashAdminPassword} from '../scripts/admin.mjs';
import {chat} from '../worker/api.js';

const origin='https://focus.example';
const password='example-admin-password-for-tests';
const code='c'.repeat(64);
const env={
 PUBLIC_ORIGIN:origin,FOCUS_AUTH_ENABLED:'1',FOCUS_AUTH_DB:':memory:',
 FOCUS_AUTH_SECRET:'focus-auth-fixture-secret-for-tests',FOCUS_SMTP_USER:'auth@example.com',FOCUS_SMTP_PASSWORD:'fixture',
 FOCUS_ADMIN_ALLOWED_IPS:'127.0.0.1',FOCUS_ADMIN_LOGIN:'focus-admin',FOCUS_ADMIN_PASSWORD_HASH:await hashAdminPassword(password),
 FOCUS_IMAGE_SUBSCRIPTIONS:digest(code)+':2099-01-01',FOCUS_OPENAI_IMAGE_API_KEY:'fixture-paid',
 CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'fixture-basic',
};
async function start(override={}){
 const sent=[];
 const app={
  fetch(request,config,context){
   if(new URL(request.url).pathname==='/api/chat')return chat(request,config,async(url)=>{
    assert.match(url,/api.openai.com|api.cloudflare.com/);
    return Response.json({result:{image:'iVBORw0KGgo='},data:[{b64_json:'iVBORw0KGgo='}]});
   },context);
   return Response.json({ok:true});
  },
 };
 const now=Date.parse('2026-11-07T08:00:00Z');
 let clock=now;
 const server=createServer({...env,...override},app,{clock:()=>clock,mailer:async message=>sent.push(message)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(path,{body,cookie,headers={}}={})=>fetch(base+path,{
  redirect:'manual',method:body===undefined?'GET':'POST',
  headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),...(cookie?{cookie}:{}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 return {
  call,now,sent,advance:milliseconds=>{clock+=milliseconds;},close:()=>new Promise(resolve=>server.close(resolve)),
  async signIn(email,intent='register'){
   const response=await call('/api/auth/request',{body:{email,intent}});
   assert.equal(response.status,200);
   const {challenge}=await response.json();
   const headers={'user-agent':'Mozilla/5.0 (Linux; Android 16) Chrome/140'};
   const verified=await call('/api/auth/verify',{body:{challenge,code:sent.at(-1).code},headers});
   assert.equal(verified.status,200);
   const session=intent==='login'?verified:await call('/api/auth/register',{headers,body:{
    registrationToken:(await verified.json()).registrationToken,
    firstName:'Тест',lastName:'Focus',ageGroup:'25-34',role:'other',goals:['work'],
   }});
   assert.equal(session.status,200);
   return {cookie:session.headers.get('set-cookie').split(';')[0],...(await session.json())};
  },
 };
}

test('admin credentials are separate and control user sessions, subscriptions and aggregate counts',async()=>{
 const server=await start();
 const {call,now,sent}=server;
 try{
  const first=await server.signIn('alice@example.net');
  const second=await server.signIn('bob@example.net');
  assert.equal((await call('/api/admin/users',{cookie:first.cookie})).status,401);
  const credentials={login:'focus-admin',password};
  assert.equal((await call('/api/admin/login',{body:credentials,headers:{origin:'https://other.example'}})).status,403);
  assert.equal((await call('/api/admin/login',{body:{...credentials,password:'wrong password used here'}})).status,401);
  const login=await call('/api/admin/login',{body:credentials});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie,/^__Host-focus_admin=/);
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Secure/);
  assert.equal((await call('/api/chat',{cookie})).status,401);
  assert.equal((await call('/api/auth/profile',{body:{name:'Алёна'},cookie:first.cookie})).status,200);
  const get=path=>call('/api/admin/'+path,{cookie});
  const manage=(action,id,options)=>call('/api/admin/manage',{cookie,body:{action,id,...options}});
  const filtered=await (await get('users?q='+encodeURIComponent('АЛЁНА'))).json();
  assert.equal(filtered.total,1);
  assert.equal(filtered.items[0].name,'Алёна');
  assert.equal(filtered.items[0].email,'alice@example.net');
  assert.equal(filtered.items[0].subscriptionUntil,null);

  const payload={imageMode:'paid',messages:[{role:'user',content:'/image PRIVATE_PROMPT'}]};
  assert.equal((await call('/api/chat',{cookie:first.cookie,body:payload,headers:{'x-focus-paid':'1'}})).status,403);
  assert.equal((await call('/api/auth/subscription',{body:{code},cookie:first.cookie})).status,200);
  assert.equal((await call('/api/auth/subscription',{body:{code},cookie:second.cookie})).status,400);
  assert.equal((await call('/api/chat',{cookie:first.cookie,body:payload})).status,200);
  assert.equal((await manage('revoke',first.user.id)).status,200);
  assert.equal((await call('/api/chat',{cookie:first.cookie,body:payload,headers:{'x-focus-image-pass':code}})).status,403);
  assert.equal((await manage('grant',first.user.id,{days:30})).status,200);
  assert.equal((await manage('grant',first.user.id,{days:7})).status,200);
  const named=await (await get('users?q=alice')).json();
  assert.equal(named.items[0].subscriptionUntil,now+37*DAY);
  assert.equal((await call('/api/chat',{cookie:first.cookie,body:payload})).status,200);
  const overview=await (await get('overview?days=7')).text();
  assert.ok(!overview.includes('PRIVATE_PROMPT'));
  const metrics=JSON.parse(overview);
  assert.equal(metrics.totals.activeSessions,2);
  assert.equal(metrics.totals.subscribed,1);
  assert.deepEqual(metrics.series.at(-1),{day:metrics.series.at(-1).day,registrations:2,logins:2,chat:0,site:0,image:2,search:0,errors:2});

  const sessions=await (await get('sessions?userId='+first.user.id)).json();
  assert.equal(sessions.total,1);
  assert.equal(sessions.items[0].device,'Chrome · Android');
  assert.ok(!Object.hasOwn(sessions.items[0],'token'));
  assert.equal((await manage('end-session',sessions.items[0].id)).status,200);
  assert.equal((await call('/api/auth/session',{cookie:first.cookie}).then(r=>r.json())).user,null);
  assert.equal((await manage('block',second.user.id)).status,200);
  assert.equal((await call('/api/auth/session',{cookie:second.cookie}).then(r=>r.json())).user,null);
  const prior=sent.length;
  server.advance(61_000);
  assert.equal((await call('/api/auth/request',{body:{email:'bob@example.net'}})).status,200);
  assert.equal(sent.length,prior);
  assert.equal((await manage('unblock',second.user.id)).status,200);
  assert.equal((await call('/api/admin/logout',{cookie,body:{}})).status,200);
  assert.equal((await get('users')).status,401);
 }finally{await server.close();}
});

test('only a verified session for the configured email grants Focus admin access',async()=>{
 const server=await start({FOCUS_ADMIN_EMAIL:' Owner@Example.net ',FOCUS_ADMIN_LOGIN:'',FOCUS_ADMIN_PASSWORD_HASH:''});
 const {call}=server;
 try{
  const ordinary=await server.signIn('ordinary@example.net');
  const owner=await server.signIn('owner@example.net');
  assert.equal(ordinary.user.isAdmin,undefined);
  assert.equal(owner.user.isAdmin,true);
  assert.equal((await call('/api/admin/users')).status,401);
  assert.equal((await call('/api/admin/users',{cookie:ordinary.cookie,headers:{'x-focus-admin-email':'owner@example.net'}})).status,401);
  assert.equal((await call('/api/admin/users',{cookie:owner.cookie})).status,200);
  assert.deepEqual(await (await call('/api/admin/session',{cookie:owner.cookie})).json(),{
   enabled:true,authenticated:true,passwordEnabled:false,login:'owner@example.net',viaFocus:true,
  });
  assert.equal((await call('/api/auth/logout',{cookie:owner.cookie,body:{}})).status,200);
  assert.equal((await call('/api/admin/users',{cookie:owner.cookie})).status,401);
  server.advance(61_000);
  assert.equal((await server.signIn('owner@example.net','login')).user.isAdmin,true);
 }finally{await server.close();}
});

test('a legacy database keeps existing accounts and sessions after migration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'focus-admin-migrate-'));
 const path=join(dir,'accounts.sqlite');
 const token='z'.repeat(43);
 const now=Date.parse('2026-11-07T08:00:00Z');
 const db=new DatabaseSync(path);
 db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,created INTEGER NOT NULL); CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);');
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('legacy','legacy@example.net',now-DAY);
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),'legacy',now+DAY);
 db.close();
 const server=await start({FOCUS_AUTH_DB:path});
 try{
  const session=await (await server.call('/api/auth/session',{cookie:'__Host-focus_session='+token})).json();
  assert.deepEqual(session.user,{id:'legacy',email:'legacy@example.net',name:'',subscriptionUntil:null});
  const old=new DatabaseSync(path);
  try{
   const row=old.prepare('SELECT id,started,last_seen FROM sessions').get();
   assert.match(row.id,/^[a-f0-9]{32}$/);
   assert.equal(row.started,null);
   assert.equal(row.last_seen,now);
  }finally{old.close();}
 }finally{await server.close();await rm(dir,{recursive:true,force:true});}
});

test('subscription attempts are bounded per account, including the legacy header',async()=>{
 const server=await start();
 try{
  const {cookie}=await server.signIn('claim-limit@example.net');
  for(let i=0;i<5;i++){
   assert.equal((await server.call('/api/auth/subscription',{cookie,body:{code:'0'.repeat(64)}})).status,400);
  }
  assert.equal((await server.call('/api/auth/subscription',{cookie,body:{code}})).status,429);
  assert.equal((await server.call('/api/chat',{cookie,body:{messages:[]},headers:{'x-focus-image-pass':code}})).status,429);
  server.advance(15*60_000);
  assert.equal((await server.call('/api/auth/subscription',{cookie,body:{code}})).status,200);
 }finally{await server.close();}
});


test('admin access requires an allowed IP and locks after five consecutive failures',async()=>{
 const excluded=await start({FOCUS_ADMIN_ALLOWED_IPS:'192.0.2.1'});
 try{
  const r=await excluded.call('/api/admin/session',{headers:{'x-real-ip':'192.0.2.1'}});
  assert.equal(r.status,403);
 }finally{await excluded.close();}
 const server=await start();
 try{
  const path='/api/admin/login';
  const body={login:'focus-admin',password};
  for(let i=0;i<5;i++){
   assert.equal((await server.call(path,{body:{...body,password:'incorrect'}})).status,401);
  }
  assert.equal((await server.call(path,{body})).status,429);
  server.advance(15*60_000);
  assert.equal((await server.call(path,{body})).status,200);
 }finally{await server.close();}
});
