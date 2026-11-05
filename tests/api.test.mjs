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

test('malformed JSON message shapes return 400 before provider access',async()=>{
 let providerCalls=0;
 const fetcher=async()=>{providerCalls++;throw Error('must not fetch')};
 for(const input of [null,{messages:[null]},{messages:[{role:'user',content:'Question',attachments:{}}]}]){
  assert.equal((await chat(req(input),env,fetcher)).status,400);
 }
 assert.equal(providerCalls,0);
});

test('calculator returns exact results without a provider',async()=>{
 const fail=()=>assert.fail('local skills must not use the provider');
 for(const [expression,expected] of [
  ['0,1 + 0.2','0,3'],['-2^2 + 2^-2','−3,75'],['2^2^3','256'],
  ['15% × 800','120'],['1/3','1/3'],['(125 + 18) * 1,2','171,6'],
 ]){
  const r=await chat(req({messages:[{role:'user',content:'/calc '+expression}]}),{},fail);
  assert.equal(r.status,200,expression);
  const result=await r.json();
  assert.equal(result.model,'local-calculator');
  assert.equal(result.text,'**Результат** '+expected);
 }
});

test('statistics returns exact median and mean for an unsorted list with decimals',async()=>{
 const r=await chat(req({messages:[{role:'user',content:'/stats 5,5; -2.5\n2; 1'}]}),{},()=>assert.fail('must not fetch'));
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.model,'local-statistics');
 for(const row of ['Количество | 4','Сумма | 6','Среднее | 1,5','Медиана | 1,5','Минимум | −2,5','Максимум | 5,5']){
  assert.ok(data.text.includes('| '+row+' |'),row);
 }
});

test('invalid local input is rejected without running code or falling through to a provider',async()=>{
 for(const content of ['/calc 1/0','/calc 2^21','/calc (1+2','/calc 1 2','/calc globalThis.alert(1)','/stats 1; nope','/stats']){
  const r=await chat(req({messages:[{role:'user',content}]}),env,()=>assert.fail('must not fetch'));
  assert.equal(r.status,400,content);
  assert.equal((await r.json()).code,'skill_input');
 }
});

test('image generation uses server model and returns validated raster data',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 let seen;
 const r=await chat(req({messages:[{role:'user',content:'/image космос'}]}),{OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'configured/model'},async(url,options)=>{
  seen={url,options};return Response.json({data:[{b64_json:png,media_type:'image/png'}]});
 });
 assert.equal(r.status,200);
 assert.equal(seen.url,'https://openrouter.ai/api/v1/images');
 assert.deepEqual(JSON.parse(seen.options.body),{model:'configured/model',prompt:'космос'});
 assert.equal((await r.json()).image.data,png);
});
test('image configuration and provider errors are handled without exposing secrets',async()=>{
 const input={messages:[{role:'user',content:'/image кот'}]};
 assert.equal((await chat(req(input),{},()=>assert.fail())).status,503);
 for(const status of [402,429,500]){
  const r=await chat(req(input),{OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'model'},async()=>Response.json({error:'secret'},{status}));
  assert.equal(r.status,status===429?429:502);
  assert.ok(!(await r.text()).includes('secret'));
 }
 const r=await chat(req(input),{OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'model'},async()=>Response.json({data:[{b64_json:'PHN2Zz4='}]}));
 assert.equal(r.status,502);
});

test('Cloudflare image generation uses its own token and returns the generated image',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const account='a'.repeat(32);
 const env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'cloudflare',OPENROUTER_API_KEY:'openrouter',OPENROUTER_IMAGE_MODEL:'paid/model'};
 let sent;
 const r=await chat(req({messages:[{role:'user',content:'/image космос'}]}),env,async(url,options)=>{
  sent={url,options};
  return Response.json({success:true,result:{image:png}});
 });
 assert.equal(r.status,200);
 assert.equal(sent.url,'https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/black-forest-labs/flux-2-dev');
 assert.equal(sent.options.headers.authorization,'Bearer cloudflare');
 assert.ok(sent.options.body instanceof FormData);
 assert.equal(sent.options.headers['content-type'],undefined);
 assert.deepEqual(Object.fromEntries(sent.options.body),{prompt:'космос',steps:'25',width:'1024',height:'1024'});
 assert.equal((await r.json()).image.data,png);
});

test('Cloudflare quota or incomplete config never falls back to paid images',async()=>{
 const input={messages:[{role:'user',content:'/image кот'}]};
 const env={CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),OPENROUTER_API_KEY:'paid',OPENROUTER_IMAGE_MODEL:'paid/model'};
 const incomplete=await chat(req(input),env,async()=>assert.fail('must not call a provider'));
 assert.equal(incomplete.status,503);
 let calls=0;
 const r=await chat(req(input),{...env,CLOUDFLARE_API_TOKEN:'token'},async(url)=>{
  calls++;
  assert.equal(new URL(url).hostname,'api.cloudflare.com');
  return Response.json({errors:[{code:3036}]},{status:429});
 });
 assert.equal(r.status,429);
 assert.equal((await r.json()).code,'image_daily_quota');
 assert.equal(calls,1);
});


test('Cloudflare image format is passed as dimensions and excluded from the prompt',async()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cloudflare'};
 const messages=[{role:'user',content:'/image космос --ar 9:16'}];
 await chat(req({messages}),env,async(url,options)=>{
  assert.deepEqual(Object.fromEntries(options.body),{prompt:'космос',steps:'25',width:'720',height:'1280'});
  return Response.json({result:{image:'iVBORw0KGgo='}});
 }).then(response=>assert.equal(response.status,200));
 messages[0].content='/image космос --ar 3:2';
 const response=await chat(req({messages}),env,()=>assert.fail('unsupported ratio must not reach provider'));
 assert.equal(response.status,400);
 assert.equal((await response.json()).code,'image_aspect_ratio');
});

test('natural image request uses the image provider without a chat model',async()=>{
 const r=await chat(req({messages:[{role:'user',content:'Нарисуй кота'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async(url,options)=>{
  assert.ok(url.endsWith('/flux-2-dev'));assert.equal(options.body.get('prompt'),'Нарисуй кота');assert.equal(options.body.get('input_image_0'),null);
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });assert.equal(r.status,200);
});
test('edits send binary reference, retain output dimensions and reject invalid references',async()=>{
 const imageReference={mimeType:'image/png',data:'iVBORw0KGgo=',width:1280,height:720};
 const request={messages:[{role:'user',content:'Добавь закат'}],imageReference};
 const cf={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'};
 const r=await chat(req(request),cf,async(url,{body})=>{
  assert.equal(body.get('width'),'1280');assert.equal(body.get('height'),'720');
  assert.match(body.get('prompt'),/Preserve all unmentioned/);
  assert.equal(body.get('input_image_0').type,'image/png');
  assert.deepEqual(new Uint8Array(await body.get('input_image_0').arrayBuffer()),Uint8Array.from(atob(imageReference.data),c=>c.charCodeAt(0)));
  return Response.json({result:{image:imageReference.data}});
 });assert.equal(r.status,200);
 for(const ref of [{...imageReference,data:'https://evil.test/a.png'},{...imageReference,width:99999}])assert.equal((await chat(req({...request,imageReference:ref}),cf,()=>{throw Error('must not fetch')})).status,400);
 assert.equal((await chat(req({messages:[{role:'user',content:'Измени изображение'}]}),cf)).status,400);
 assert.equal((await chat(req(request),{OPENROUTER_API_KEY:'key',OPENROUTER_IMAGE_MODEL:'model'},()=>{throw Error('must not fetch')})).status,503);
});
