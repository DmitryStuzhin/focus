import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBudget} from '../scripts/budget.mjs';
import {createServer} from '../scripts/server.mjs';
import {dispatchAPI} from '../worker/api.js';

const limits=(overrides={})=>{
 const values={};
 for(const scope of ['USER','GLOBAL']){
  for(const period of ['DAY','MONTH']){
   values[`FOCUS_BUDGET_${scope}_${period}_TOKENS`]='1000000';
   values[`FOCUS_BUDGET_${scope}_${period}_USD_MICROS`]='1000000';
  }
 }
 return {...values,FOCUS_BUDGET_TAVILY_SEARCH_USD_MICROS:'5',
  FOCUS_BUDGET_GOOGLE_TEXT_USD_MICROS:'1000000',...overrides};
};
const search=(query='Focus')=>new Request('https://test.example/api/search',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query}),
});

test('an anonymous request cannot enter the Worker or unauthenticated Node API',async(t)=>{
 const server=createServer({}, {fetch(){assert.fail('API called anonymously')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/search`)).status,401);
 assert.equal((await dispatchAPI(search(),'/api/search',{},{})).status,401);
});

test('exhausted provider budget blocks dispatch and is shared across budget instances',async(t)=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 const env=limits({TAVILY_API_KEY:'test',FOCUS_BUDGET_GLOBAL_DAY_USD_MICROS:'5'});
 const clock=()=>Date.UTC(2026,10,14);
 let dispatched=0;
 const providerFetch=async()=>{dispatched++;return Response.json({results:[{url:'https://example.org/focus',title:'Focus',content:'Test result'}]});};
 const call=(userId,query)=>dispatchAPI(search(query),'/api/search',env,{
  userId,providerFetch,reserveProvider:createBudget(db,env,clock),
 });
 assert.equal((await call('first','first query')).status,200);
 const response=await call('second','second query');
 assert.equal(response.status,429);
 assert.equal((await response.json()).code,'provider_budget_exhausted');
 assert.equal(dispatched,1);
});

test('account, token and monthly limits apply independently and failed reservations are atomic',t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 let now=Date.UTC(2026,10,14);
 const reserve=createBudget(db,limits({
  FOCUS_BUDGET_USER_DAY_TOKENS:'3',FOCUS_BUDGET_GLOBAL_MONTH_USD_MICROS:'8',
 }),()=>now);
 const text=tokens=>({provider:'GOOGLE_TEXT',tokens});
 assert.equal(reserve('one',text(4)),'exhausted');
 assert.equal(reserve('one',text(3)),'reserved');
 assert.equal(reserve('one',text(1)),'exhausted');
 assert.equal(reserve('two',text(3)),'reserved');
 now+=86400000;
 assert.equal(reserve('one',text(3)),'exhausted');
 assert.equal(reserve('one',text(2)),'reserved');
 now=Date.UTC(2026,11,1);
 assert.equal(reserve('one',text(3)),'reserved');
});

test('the temporary default quota survives re-opening the budget and resets five hours after first dispatch',async t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 let now=Date.UTC(2026,10,14,21);
 const clock=()=>now;
 let reserve=createBudget(db,{},clock);
 assert.deepEqual(reserve.status('one'),{remainingPercent:100,resetAt:null,approximateTokenLimit:500000});
 assert.equal(reserve('one',{provider:'GOOGLE_TEXT',tokens:250000}),'reserved');
 const resetAt=now+5*3600_000;
 now+=4*3600_000;
 reserve=createBudget(db,{},clock);
 assert.deepEqual(reserve.status('one'),{remainingPercent:50,resetAt,approximateTokenLimit:500000});
 assert.equal(reserve('one',{provider:'GOOGLE_TEXT',tokens:250001}),'session_exhausted');
 assert.equal(reserve.status('other').remainingPercent,100);
 const response=await dispatchAPI(new Request('https://test.example/api/status'),'/api/status',{},{
  userId:'one',budgetStatus:reserve.status,
 });
 assert.equal((await response.json()).budget.resetAt,resetAt);
 now=resetAt;
 assert.equal(reserve.status('one').remainingPercent,100);
 assert.equal(reserve('one',{provider:'GOOGLE_TEXT',tokens:250001}),'reserved');
});

test('images and search consume the dollar side of the five-hour budget',async t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 const env={TAVILY_API_KEY:'fixture',FOCUS_BUDGET_USER_5H_USD_MICROS:'10000'};
 const reserve=createBudget(db,env,()=>Date.UTC(2026,10,14));
 assert.equal(reserve('one',{provider:'OPENAI_IMAGE',tokens:0}),'session_exhausted');
 assert.equal(reserve('one',{provider:'TAVILY_SEARCH',tokens:0}),'reserved');
 assert.equal(reserve.status('one').remainingPercent,0);
 const result=await dispatchAPI(search('second search'),'/api/search',env,{
  userId:'one',budgetStatus:reserve.status,reserveProvider:reserve,
  providerFetch:()=>assert.fail('Provider must not be called'),
 });
 assert.equal(result.status,429);
 assert.equal((await result.json()).code,'provider_budget_session_exhausted');
});
