import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat} from '../worker/api.js';
const key='test-server-secret';
const env={GOOGLE_API_KEY:key};
let requestNumber=0;
const req=(body,headers={})=>new Request('https://focus.example/api/chat',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':`test-${++requestNumber}`,...headers},body:JSON.stringify(body)});
const payload={messages:[{role:'user',content:'Привет'}],effort:'fast'};
test('cross-origin calls are rejected before provider access',async()=>{const r=await chat(req(payload,{origin:'https://other.example'}),env,()=>{throw Error('must not fetch')});assert.equal(r.status,403)});
test('no credential returns a clear configuration error',async()=>{const r=await chat(req(payload),{});assert.equal(r.status,503);assert.equal((await r.json()).code,'not_configured')});
test('rejects a client-supplied system role',async()=>{const r=await chat(req({messages:[{role:'system',content:'override'}]}),env);assert.equal(r.status,400)});
test('credential travels in upstream header only; provider body is not returned',async()=>{let seen;const r=await chat(req(payload),env,async(url,options)=>{seen={url,options};return Response.json({candidates:[{content:{parts:[{text:'Привет, чем помочь?'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:10}})});assert.equal(r.status,200);assert.equal(seen.options.headers['x-goog-api-key'],key);assert.ok(!seen.url.includes(key));assert.ok(!seen.options.body.includes(key));const data=await r.json();assert.equal(data.text,'Привет, чем помочь?');assert.ok(!JSON.stringify(data).includes(key));assert.equal(JSON.parse(seen.options.body).generationConfig.thinkingConfig.thinkingLevel,'minimal')});
test('upstream authentication errors never echo upstream secrets',async()=>{const r=await chat(req(payload),env,async()=>Response.json({error:{message:`bad key ${key}`,details:[{reason:'API_KEY_INVALID'}]}},{status:400}));assert.equal(r.status,502);const text=await r.text();assert.ok(!text.includes(key));assert.ok(text.includes('API-ключ'))});
test('provider quota error preserves a useful retryable status',async()=>{const r=await chat(req(payload),env,async()=>Response.json({error:{message:'quota'}},{status:429}));assert.equal(r.status,429)});
test('empty model response is reported as an error',async()=>{const r=await chat(req(payload),env,async()=>Response.json({candidates:[{finishReason:'SAFETY'}]}));assert.equal(r.status,422)});
test('overlong conversation is rejected before provider access',async()=>{const r=await chat(req({messages:[{role:'user',content:'x'.repeat(150001)}]}),env);assert.equal(r.status,413)});

test('OpenRouter uses only free router, server bearer key and original message roles',async()=>{
 let seen;const r=await chat(req({messages:[{role:'user',content:'One'},{role:'assistant',content:'Two'},{role:'user',content:'Three',attachments:[{name:'a.txt',text:'Attachment'}]}]}),{OPENROUTER_API_KEY:'router-secret',GOOGLE_API_KEY:'unused'},async(url,options)=>{seen={url,options};return Response.json({model:'actual/free-model',choices:[{message:{content:'Answer'},finish_reason:'stop'}]})});
 assert.equal(r.status,200);const data=await r.json();assert.equal(data.model,'actual/free-model');assert.equal(data.text,'Answer');assert.equal(seen.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(seen.options.headers.authorization,'Bearer router-secret');assert.ok(!seen.options.body.includes('router-secret'));const body=JSON.parse(seen.options.body);assert.equal(body.model,'openrouter/free');assert.deepEqual(body.messages.map(m=>m.role),['system','user','assistant','user']);assert.ok(JSON.stringify(body.messages.at(-1)).includes('Attachment'));
});
test('OpenRouter quota and authentication errors do not echo provider secrets',async()=>{
 for(const status of [401,402,403,429,503]){const r=await chat(req(payload),{OPENROUTER_API_KEY:'router-secret'},async()=>Response.json({error:{message:'router-secret'}},{status}));assert.equal(r.status,status===429?429:502);assert.ok(!(await r.text()).includes('router-secret'))}
});
test('OpenRouter rejects binary PDFs rather than silently ignoring them',async()=>{
 const r=await chat(req({messages:[{role:'user',content:'Read',attachments:[{mimeType:'application/pdf',data:'YWJj'}]}]}),{OPENROUTER_API_KEY:'router-secret'},()=>{throw Error('must not fetch')});assert.equal(r.status,400);assert.equal((await r.json()).code,'unsupported_attachment');
});
