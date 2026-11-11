import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createWorkspace} from '../scripts/workspace.mjs';
import {createJobs} from '../scripts/jobs.mjs';
import {compareTables,csvTable} from '../public/tabular.js';
import {fresh} from '../public/store.js';
import {eventStream} from '../public/event-stream.js';
import {chat,searchWeb} from '../worker/api.js';

function database(){
 const db=new DatabaseSync(':memory:');
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('alice'),('bob');");
 return db;
}
function request(path,body,headers={}){
 const url=new URL(path,'https://focus.test');
 const req=new Request(url,body===undefined?{}:{
  method:'POST',headers:{origin:url.origin,'content-type':'application/json',...headers},body:JSON.stringify(body)
 });
 return [req,url];
}
const alice={id:'alice'},bob={id:'bob'};
const snapshot=()=>({...fresh(),blobs:{}});

test('workspace snapshots are account scoped and reject stale or cross-origin writes',async()=>{
 const db=database();
 const handle=createWorkspace(db);
 try{
  const save=(user,revision,headers)=>handle(...request('/api/workspace',{revision,snapshot:snapshot()},headers),user,Date.now());
  assert.equal((await save(alice,0,{origin:'https://untrusted.test'})).status,403);
  assert.equal((await save(alice,0)).status,200);
  assert.equal((await save(alice,0)).status,409);
  const stored=await (await handle(...request('/api/workspace'),alice,Date.now())).json();
  assert.equal(stored.revision,1);
  assert.deepEqual(await (await handle(...request('/api/workspace'),bob,Date.now())).json(),{revision:0,snapshot:null});
  assert.equal((await handle(...request('/api/workspace'),null,Date.now())).status,401);
  assert.equal((await save(alice,1)).status,200);
 }finally{db.close();}
});

test('a published snapshot is immutable, sandboxed and removable only by its owner',async()=>{
 const db=database();
 const handle=createWorkspace(db);
 try{
  const body={action:'create',chatId:'demo',version:'version1',title:'Landing',html:'<!doctype html><html><body>Version 1</body></html>'};
  const save=payload=>handle(...request('/api/publications',payload),alice,Date.now());
  const page=await (await save(body)).json();
  assert.equal((await (await save({...body,html:body.html.replace('Version 1','Version 2')})).json()).path,page.path);
  const published=await handle(...request(page.path),null,Date.now());
  assert.equal(published.status,200);
  assert.match(published.headers.get('content-security-policy'),/sandbox allow-scripts; default-src 'none'/u);
  assert.match(await published.text(),/Version 1/u);
  const remove={action:'remove',id:page.id};
  assert.equal((await handle(...request('/api/publications',remove),bob,Date.now())).status,404);
  assert.equal((await save(remove)).status,200);
  assert.equal((await handle(...request(page.path),null,Date.now())).status,404);
 }finally{db.close();}
});

test('background jobs persist independently of requests and support account isolation and cancellation',async()=>{
 const db=database();
 const jobs=createJobs(db);
 let finish;
 try{
  const input={messages:[{role:'user',content:'Исследование'}]};
  const create=(id,run)=>jobs.handle(...request('/api/jobs',{action:'start',id,input}),alice,Date.now(),run);
  const get=(id,user=alice)=>jobs.handle(...request('/api/jobs?id='+id),user,Date.now());
  assert.equal((await create('one',()=>new Promise(resolve=>{finish=resolve;}))).status,202);
  assert.equal((await get('one',bob)).status,404);
  finish(Response.json({text:'Результат'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await (await get('one')).json()).result.text,'Результат');
  let abort;
  await create('two',(_input,_research,signal)=>new Promise((_,reject)=>{
   abort=signal;
   signal.addEventListener('abort',reject,{once:true});
  }));
  await jobs.handle(...request('/api/jobs',{action:'cancel',id:'two'}),alice,Date.now());
  assert.ok(abort.aborted);
  assert.equal((await (await get('two')).json()).state,'cancelled');
 }finally{jobs.close();db.close();}
});

test('compare tabular values by key, regardless of column or row order',()=>{
 const before=csvTable('id;price;name\n001;10;A\n002;20;B','',true);
 const after=csvTable('name;price;id\nC;30;003\nA;11;001','',true);
 const result=compareTables(before,after,'id');
 assert.deepEqual([result.added,result.removed,result.modified,result.matched],[1,1,1,0]);
 assert.deepEqual(result.sheets[2].rows[1],['001',1,2,'price','10','11']);
});

test('multi-query research deduplicates shared sources and preserves partial failures',async()=>{
 const queries=[];
 const [req]=request('/api/search',{query:'topic',queries:['primary sources','contradictions']},{'cf-connecting-ip':'multi-query'});
 const response=await searchWeb(req,{TAVILY_API_KEY:'fixture'},async(_url,options)=>{
  const {query}=JSON.parse(options.body);
  queries.push(query);
  if(query==='contradictions')return Response.json({}, {status:503});
  return Response.json({results:[{url:'https://source.example/shared',content:'shared'},
   {url:'https://source.example/'+encodeURIComponent(query),content:query}]});
 });
 const report=await response.json();
 assert.equal(response.status,200);
 assert.deepEqual(queries,['topic','primary sources','contradictions']);
 assert.equal(report.sources.length,3);
 assert.deepEqual(report.failedQueries,['contradictions']);
});

test('stream forwards visible chunks and delivers a final result without reasoning text',async()=>{
 const [req]=request('/api/chat',{messages:[{role:'user',content:'Объясни мне основы вероятности'}]},{
  accept:'text/event-stream','cf-connecting-ip':'stream-fixture'
 });
 const response=await chat(req,{OPENROUTER_API_KEY:'fixture'},async(_url,options)=>{
  assert.equal(JSON.parse(options.body).stream,true);
  return new Response([
   {choices:[{delta:{reasoning:'private',content:'Первый '}}]},
   {choices:[{delta:{content:'текст'},finish_reason:'stop'}]}
  ].map(value=>'data: '+JSON.stringify(value)+'\r\n\r\n').join('')+'data: [DONE]\n\n',{
   headers:{'content-type':'text/event-stream'}
  });
 });
 const records=[];
 for await(const event of eventStream(response.body))records.push(JSON.parse(event));
 assert.deepEqual(records.map(item=>item.delta).filter(Boolean),['Первый ','текст']);
 assert.equal(records.at(-1).result.text,'Первый текст');
 assert.ok(!JSON.stringify(records).includes('private'));
});
