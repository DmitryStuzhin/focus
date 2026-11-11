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
test('a selected excerpt reaches the model as context in the user turn',async()=>{
 const quote='def greet(name):\n    return name';
 const content='Что делает эта строка?';
 const r=await chat(req({messages:[{role:'user',content,quote}]}),{OPENROUTER_API_KEY:'test'},async(_url,options)=>{
  const message=JSON.parse(options.body).messages.at(-1);
  assert.equal(message.role,'user');
  assert.deepEqual(message.content,[
   {type:'text',text:content},
   {type:'text',text:'Выделенный пользователем фрагмент сообщения (контекст для вопроса):\n'+quote},
  ]);
  return Response.json({choices:[{message:{content:'Ответ'},finish_reason:'stop'}]});
 });
 assert.equal(r.status,200);
 const tooLong=await chat(req({messages:[{role:'user',content,quote:'x'.repeat(4001)}]}),env,()=>assert.fail('must not fetch'));
 assert.equal(tooLong.status,400);
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

const imagePass='b'.repeat(64);
const imagePassHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(imagePass))).toString('hex');
const imageSubscription={FOCUS_IMAGE_SUBSCRIPTIONS:imagePassHash+':2099-01-01'};
const imagePassHeader={'x-focus-image-pass':imagePass};

test('image generation uses server model and returns validated raster data',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 let seen;
 const r=await chat(req({messages:[{role:'user',content:'/image космос'}]},imagePassHeader),{...imageSubscription,OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'configured/model'},async(url,options)=>{
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
  const r=await chat(req(input,imagePassHeader),{...imageSubscription,OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'model'},async()=>Response.json({error:'secret'},{status}));
  assert.equal(r.status,status===429?429:502);
  assert.ok(!(await r.text()).includes('secret'));
 }
 const r=await chat(req(input,imagePassHeader),{...imageSubscription,OPENROUTER_API_KEY:'secret',OPENROUTER_IMAGE_MODEL:'model'},async()=>Response.json({data:[{b64_json:'PHN2Zz4='}]}));
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
 assert.equal(sent.url,'https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/black-forest-labs/flux-2-klein-9b');
 assert.equal(sent.options.headers.authorization,'Bearer cloudflare');
 assert.ok(sent.options.body instanceof FormData);
 assert.equal(sent.options.headers['content-type'],undefined);
 assert.deepEqual(Object.fromEntries(sent.options.body),{prompt:'космос',width:'1024',height:'1024'});
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
  assert.deepEqual(Object.fromEntries(options.body),{prompt:'космос',width:'720',height:'1280'});
  return Response.json({result:{image:'iVBORw0KGgo='}});
 }).then(response=>assert.equal(response.status,200));
 messages[0].content='/image космос --ar 3:2';
 const response=await chat(req({messages}),env,()=>assert.fail('unsupported ratio must not reach provider'));
 assert.equal(response.status,400);
 assert.equal((await response.json()).code,'image_aspect_ratio');
});

test('natural image format selects phone and YouTube dimensions',async()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cloudflare'};
 for(const [content,width,height] of [
  ['Нарисуй обои на телефон с ночным городом','720','1280'],
  ['Создай горизонтальное изображение для YouTube','1280','720'],
 ]){
  const response=await chat(req({messages:[{role:'user',content}]}),env,async(_url,options)=>{
   assert.equal(options.body.get('width'),width,content);
   assert.equal(options.body.get('height'),height,content);
   assert.equal(options.body.get('prompt'),content);
   return Response.json({result:{image:'iVBORw0KGgo='}});
  });
  assert.equal(response.status,200);
 }
});

test('natural image request uses the image provider without a chat model',async()=>{
 const r=await chat(req({messages:[{role:'user',content:'Нарисуй кота'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async(url,options)=>{
  assert.ok(url.endsWith('/flux-2-klein-9b'));assert.equal(options.body.get('prompt'),'Нарисуй кота');assert.equal(options.body.get('input_image_0'),null);
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
 assert.equal((await chat(req(request,imagePassHeader),{...imageSubscription,OPENROUTER_API_KEY:'key',OPENROUTER_IMAGE_MODEL:'model'},()=>{throw Error('must not fetch')})).status,503);
});

test('Cloudflare capacity rejection switches to Klein and preserves the edit',async()=>{
 const calls=[];
 const cf={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf',OPENROUTER_API_KEY:'paid',OPENROUTER_IMAGE_MODEL:'paid'};
 const imageReference={mimeType:'image/png',data:'iVBORw0KGgo=',width:1280,height:720};
 const r=await chat(req({messages:[{role:'user',content:'Добавь закат'}],imageReference}),cf,async(url,{body})=>{
  calls.push({url,steps:body.get('steps'),prompt:body.get('prompt'),width:body.get('width'),ref:await body.get('input_image_0').text()});
  return calls.length===1?Response.json({errors:[{code:4006,message:'AiError: Service temporarily at capacity'}]},{status:429}):Response.json({result:{image:imageReference.data}});
 });
 assert.equal(r.status,200);
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/cloudflare.com.*flux-2-klein-9b$/);
 assert.match(calls[1].url,/cloudflare.com.*flux-2-klein-4b$/);
 assert.equal(calls[0].steps,null);
 assert.equal(calls[1].steps,null);
 assert.equal(calls[1].width,'1280');
 assert.match(calls[1].prompt,/Добавь закат/);
 assert.equal(calls[1].ref,calls[0].ref);
 assert.match((await r.json()).model,/flux-2-klein-4b$/);
});
test('wrapped quota and long retry delays stop without repeated provider calls',async()=>{
 for(const [body,headers,code] of [[{errors:[{code:'3036'}]},{},'image_daily_quota'],[{errors:[{code:4006,message:'AiError: you have used up your daily free allocation of 10,000 neurons'}]},{},'image_daily_quota'],[{errors:[]},{'retry-after':'60'},'image_rate_limit']]){
  let calls=0;const r=await chat(req({messages:[{role:'user',content:'/image cat'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async()=>{calls++;return Response.json(body,{status:429,headers})});
  assert.equal(calls,1);assert.equal(r.status,429);assert.equal((await r.json()).code,code);
 }
});
test('persistent image overload has a bounded retry count',async()=>{
 let calls=0;const r=await chat(req({messages:[{role:'user',content:'/image cat'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async()=>{calls++;return Response.json({errors:[{code:3040,message:'secret'}]},{status:429,headers:{'retry-after':'0'}})});
 assert.equal(calls,3);assert.equal(r.status,429);assert.ok(!(await r.text()).includes('secret'));
});

test('OpenAI image opt-in supports generation and edits with the dedicated server key',async()=>{
 const env={...imageSubscription,FOCUS_OPENAI_IMAGE_API_KEY:'openai-secret',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'};
 const png='iVBORw0KGgo=';
 const generated=await chat(req({messages:[{role:'user',content:'Нарисуй кота --ar 16:9'}]},imagePassHeader),env,async(url,{body,headers})=>{
  assert.equal(url,'https://api.openai.com/v1/images/generations');
  assert.equal(headers.authorization,'Bearer openai-secret');
  assert.deepEqual(JSON.parse(body),{model:'gpt-image-2.5-sunburst',prompt:'Нарисуй кота',size:'1280x720',quality:'medium',output_format:'jpeg'});
  return Response.json({data:[{b64_json:png}]});
 });
 assert.equal(generated.status,200);
 assert.equal((await generated.json()).image.data,png);
 const imageReference={mimeType:'image/png',data:png,width:1280,height:720};
 const edited=await chat(req({messages:[{role:'user',content:'Добавь закат'}],imageReference},imagePassHeader),env,async(url,{body,headers})=>{
  assert.equal(url,'https://api.openai.com/v1/images/edits');
  assert.equal(headers['content-type'],undefined);
  assert.match(body.get('prompt'),/Добавь закат/);
  assert.equal(body.get('size'),'1280x720');
  assert.equal(body.get('image[]').type,'image/png');
  return Response.json({data:[{b64_json:png}]});
 });
 assert.equal(edited.status,200);
 const exhausted=await chat(req({messages:[{role:'user',content:'Нарисуй кота'}]},imagePassHeader),env,async()=>Response.json({error:{code:'insufficient_quota',message:'openai-secret'}},{status:429}));
 assert.equal(exhausted.status,429);
 const error=await exhausted.json();
 assert.equal(error.code,'image_openai_quota');
 assert.ok(!error.error.includes('openai-secret'));
});


test('public callers and expired image passes cannot spend the OpenAI key',async()=>{
 const env={...imageSubscription,FOCUS_OPENAI_IMAGE_API_KEY:'paid',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'free'};
 const input={messages:[{role:'user',content:'/image кот'}],subscription:true};
 const guest=await chat(req(input),env,async(url,options)=>{
  assert.match(url,/api.cloudflare.com.*flux-2-klein-9b$/);
  assert.equal(options.headers.authorization,'Bearer free');
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });
 assert.equal(guest.status,200);
 const expired={...env,FOCUS_IMAGE_SUBSCRIPTIONS:imagePassHash+':2000-01-01'};
 const denied=await chat(req(input,imagePassHeader),expired,()=>assert.fail('expired pass cannot reach a provider'));
 assert.equal(denied.status,403);
 assert.equal((await denied.json()).code,'image_subscription_required');
 const unlisted=await chat(req(input,{'x-focus-image-pass':'a'.repeat(64)}),env,()=>assert.fail('unlisted pass cannot reach a provider'));
 assert.equal(unlisted.status,403);
});

test('studio paid mode requires a pass and never falls back to the basic provider',async()=>{
 const env={...imageSubscription,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'free'};
 const input={messages:[{role:'user',content:'/image кот'}],imageMode:'paid'};
 const never=()=>assert.fail('paid request must not reach the free provider');
 assert.equal((await chat(req(input),env,never)).status,403);
 assert.equal((await chat(req(input,imagePassHeader),env,never)).status,503);
 const subscribed={...env,OPENROUTER_API_KEY:'router-key',OPENROUTER_IMAGE_MODEL:'test-image-model'};
 const result=await chat(req(input,imagePassHeader),subscribed,async(url,{body,headers})=>{
  assert.equal(url,'https://openrouter.ai/api/v1/images');
  assert.equal(headers.authorization,'Bearer router-key');
  assert.deepEqual(JSON.parse(body),{model:'test-image-model',prompt:'кот'});
  return Response.json({data:[{b64_json:'iVBORw0KGgo='}]});
 });
 assert.equal(result.status,200);
});

test('a studio image edit sends the selected reference and preserves its format by default',async()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'free'};
 const imageReference={mimeType:'image/png',data:'iVBORw0KGgo=',width:1280,height:720};
 const input={messages:[{role:'user',content:'/image-edit серый фон'}],imageReference};
 const result=await chat(req(input),env,async(url,{body})=>{
  assert.match(url,/flux-2-klein-9b$/u);
  assert.match(body.get('prompt'),/серый фон$/u);
  assert.equal(body.get('input_image_0').type,'image/png');
  assert.equal(body.get('width'),'1280');
  assert.equal(body.get('height'),'720');
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });
 assert.equal(result.status,200);
});

test('unit conversion is exact and refuses incompatible dimensions',async()=>{
 const run=content=>chat(req({messages:[{role:'user',content}]}),{},()=>assert.fail('conversion is local'));
 assert.equal((await (await run('/convert 2,5 км в м')).json()).text,'**Результат** 2500 м');
 assert.equal((await run('/convert 5 кг в л')).status,400);
});

test('design mode uses Leonardo JSON while ordinary edits keep their reference',async()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'token'};
 const response=await chat(req({messages:[{role:'user',content:'/design афиша --ar 9:16'}]}),env,async(url,options)=>{
  assert.match(url,/\/leonardo\/lucid-origin$/);
  assert.equal(options.headers['content-type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),{prompt:'афиша',width:720,height:1280,num_steps:25});
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });
 assert.equal(response.status,200);
 assert.equal((await response.json()).model,'@cf/leonardo/lucid-origin');
});

test('CSV handles quoted delimiters, decimal commas and blanks without a model',async()=>{
 const run=text=>chat(req({messages:[{role:'user',content:'/csv',attachments:[{name:'test.csv',text}]}]}),{},()=>assert.fail('local analysis should not call a provider'));
 const response=await run('Название;Цена;Количество\r\n"чай; мята";10,5;2\r\nкофе;20,5;\r\n');
 assert.equal(response.status,200);
 const {text}=await response.json();
 assert.match(text,/Строк данных:\*\* 2/);
 assert.match(text,/\| Цена \| 0 \| 10,5 \| 20,5 \| 31 \| 15,5 \|/);
 assert.match(text,/\| Количество \| 1 \| 2 \| 2 \| 2 \| 2 \|/);
 assert.equal((await run('Название;Цена\n"незакрыто;10')).status,400);
});

test('file comparison preserves line order and finds additions and deletions',async()=>{
 const response=await chat(req({messages:[{role:'user',content:'/diff',attachments:[
  {name:'old.txt',text:'Первая\nСтарая\nПоследняя\n'},
  {name:'new.txt',text:'Первая\nНовая\nПоследняя\nДополнение\n'},
 ]}]}),{},()=>assert.fail('local comparison should not call a provider'));
 assert.equal(response.status,200);
 const {text}=await response.json();
 assert.match(text,/Удалено \| 2 \| Старая/);
 assert.match(text,/Добавлено \| 2 \| Новая/);
 assert.match(text,/Добавлено \| 4 \| Дополнение/);
 assert.doesNotMatch(text,/Последняя/);
});

test('coding mode passes source context and requests named complete files',async()=>{
 const messages=[{role:'user',content:'/code исправь Rust-функцию',attachments:[{name:'main.rs',text:'fn main() {}'}]}];
 const response=await chat(req({messages}),{OPENROUTER_API_KEY:'secret'},async(url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.messages[0].content,/полное содержимое файла/);
  assert.match(body.messages[0].content,/Режим Focus Forge/);
  assert.match(body.messages.at(-1).content[1].text,/Файл: main\.rs\nfn main\(\) \{\}/);
  return Response.json({choices:[{message:{content:'Исправил пример.'},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
 const empty=await chat(req({messages:[{role:'user',content:'/code'}]}),{},()=>assert.fail('empty code request should not call a model'));
 assert.equal(empty.status,400);
 assert.equal((await empty.json()).code,'code_input');
});

test('a short correction continues the preceding code task',async()=>{
 const messages=[
  {role:'user',content:'Напиши код функции parser'},
  {role:'assistant',content:'```js parser.js\nexport function parser(value){ return value; }\n```'},
  {role:'user',content:'Добавь обработку пустого ввода'},
 ];
 const response=await chat(req({messages,codeContext:true}),{OPENROUTER_API_KEY:'secret'},async(_url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.messages[0].content,/короткой правке предыдущего кода/u);
  assert.deepEqual(body.messages.slice(-2).map(message=>message.role),['assistant','user']);
  return Response.json({choices:[{message:{content:'```js parser.js\nexport function parser(value){ return value || null; }\n```'},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
});

test('review mode grounds findings in source line numbers and leaves excerpts unnumbered',async()=>{
 const messages=[{role:'user',content:'/review найди ошибки',attachments:[
  {name:'main.py',text:'def score(x):\r\n    return 1 / x'},
  {name:'large.py',text:'[Текст файла сокращён из-за лимита контекста]\nreturn x',truncated:true},
 ]}];
 const response=await chat(req({messages}),{OPENROUTER_API_KEY:'secret'},async(url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.messages[0].content,/Режим \/review/);
  const parts=body.messages.at(-1).content;
  assert.match(parts[1].text,/main.py \(с номерами строк\)\n1 \| def score\(x\):\n2 \|     return 1 \/ x/);
  assert.doesNotMatch(parts[2].text,/с номерами строк|1 \|/);
  return Response.json({choices:[{message:{content:'main.py:2 — деление на ноль при x=0.'},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
});

test('plan mode asks the provider for a checkable plan and accepts marked history',async()=>{
 const messages=[
  {role:'user',content:'/plan собрать проект'},
  {role:'assistant',content:'- [x] Установить зависимости'},
  {role:'user',content:'/plan продолжи'},
 ];
 const response=await chat(req({messages}),{GOOGLE_API_KEY:'secret'},async(url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.systemInstruction.parts[0].text,/- \[ \] Сделать/);
  assert.equal(body.contents[1].parts[0].text,'- [x] Установить зависимости');
  return Response.json({candidates:[{content:{parts:[{text:'- [ ] Собрать проект'}]},finishReason:'STOP'}]});
 });
 assert.equal(response.status,200);
});

test('natural site requests use the HTML preview prompt without intercepting image requests',async()=>{
 const response=await chat(req({messages:[{role:'user',content:'Сделай сайт с галереей фотографий'}]}),{OPENROUTER_API_KEY:'secret'},async(url,options)=>{
  assert.match(url,/chat\/completions$/);
  const body=JSON.parse(options.body);
  assert.match(body.messages[0].content,/html index\.html/);
  assert.match(body.messages[0].content,/Режим Focus Forge/);
  assert.equal(body.max_tokens,8192);
  return Response.json({choices:[{message:{content:'<!doctype html><html><body>Галерея</body></html>'},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'token'};
 const image=await chat(req({messages:[{role:'user',content:'Сделай обложку для сайта'}]}),env,async url=>{
  assert.match(url,/api.cloudflare.com/);
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });
 assert.equal(image.status,200);
});

test('empty website output retries once with a different free model and opens raw HTML',async()=>{
 const messages=[{role:'user',content:'/site сделай сайт стоматологии'}];
 const requests=[];
 const response=await chat(req({messages}),{OPENROUTER_API_KEY:'secret'},async(url,options)=>{
  requests.push(JSON.parse(options.body));
  return Response.json(requests.length===1
   ?{choices:[{message:{content:'',reasoning:'private reasoning'},finish_reason:'length'}]}
   :{choices:[{message:{content:[{type:'text',text:'<!doctype html><html><body><h1>Стоматология</h1></body></html>'}]},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
 assert.deepEqual(requests.map(r=>r.model),['openrouter/free','google/gemma-4-26b-a4b-it:free']);
 assert.deepEqual(requests[0].messages.at(-1),requests[1].messages.at(-1));
 assert.match((await response.json()).text,/^```html index\.html\n<!doctype html>/);
});

test('a site refusal is returned without another model call',async()=>{
 let count=0;
 const response=await chat(req({messages:[{role:'user',content:'/site сделай сайт'}]}),{OPENROUTER_API_KEY:'secret'},async()=>{
  count++;
  return Response.json({choices:[{message:{content:null},finish_reason:'content_filter'}]});
 });
 assert.equal(count,1);
 assert.equal((await response.json()).code,'content_filtered');
});

test('non-JSON provider responses still produce a complete dental site',async()=>{
 const requests=[];
 const input={messages:[{role:'user',content:'/site сделай сайт для стоматологической клиники'}]};
 const response=await chat(req(input),{OPENROUTER_API_KEY:'secret'},async(_url,options)=>{
  requests.push(JSON.parse(options.body).model);
  return new Response('<html>Service unavailable</html>',{status:502});
 });
 assert.deepEqual(requests,['openrouter/free','google/gemma-4-26b-a4b-it:free']);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.model,'local-site-draft');
 assert.match(data.text,/```html index\.html\n<!doctype html>/);
 assert.match(data.text,/Забота о вашей улыбке/);
 assert.match(data.text,/<\/body><\/html>\n```$/);
});

test('the local site generator escapes supplied branding and preserves existing previews on failure',async()=>{
 const messages=[{role:'user',content:'/site стоматология с названием «<script>alert(1)</script>»'}];
 const response=await chat(req({messages}),{},()=>assert.fail('local draft needs no model'));
 assert.equal(response.status,200);
 const {text}=await response.json();
 assert.match(text,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(text,/<script>/);
 const revision=await chat(req({sitePreview:true,messages:[{
  role:'user',content:'Добавь тёмную тему',
  attachments:[{name:'Текущая версия предпросмотра — index.html',text:'<html>старый сайт</html>'}],
 }]}),{OPENROUTER_API_KEY:'secret'},async()=>new Response('broken',{status:502}));
 assert.equal(revision.status,502);
 assert.equal((await revision.json()).code,'site_revision_unavailable');
});

test('natural phrases route a poster, code review and file comparison to their specialized handlers',async()=>{
 const user=content=>({role:'user',content});
 const poster=await chat(req({messages:[user('Сделай постер для джазового концерта')]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'token'},async url=>{
  assert.match(url,/lucid-origin$/);
  return Response.json({result:{image:'iVBORw0KGgo='}});
 });
 assert.equal(poster.status,200);
 const review=await chat(req({messages:[user('Проверь код: найди ошибки')]}),{OPENROUTER_API_KEY:'secret'},async(url,options)=>{
  assert.match(JSON.parse(options.body).messages[0].content,/Режим \/review/);
  return Response.json({choices:[{message:{content:'Прикрепите исходник.'},finish_reason:'stop'}]});
 });
 assert.equal(review.status,200);
 const diff=await chat(req({messages:[{...user('Сравни два файла построчно'),attachments:[{name:'old.txt',text:'старое'},{name:'new.txt',text:'новое'}]}]}),{},()=>assert.fail('compare files locally'));
 assert.equal(diff.status,200);
 assert.equal((await diff.json()).model,'local-diff');
});

test('embedded site requests reach the preview pipeline and retain their subject',async()=>{
 const fail=()=>assert.fail('local site draft must not use a provider');
 const post=content=>chat(req({messages:[{role:'user',content}]}),{},fail);
 const bare=await post('Давай начнём с простого. Сделай сайт');
 assert.equal((await bare.json()).model,'local-site-question');
 const draft=await post('У меня свой бизнес. Хочу, чтобы ты сделал сайт для стоматологии');
 const data=await draft.json();
 assert.equal(data.model,'local-site-draft');
 assert.match(data.text,/стоматолог/iu);
});

test('formats inline and attached JSON without changing numbers, keys or string escapes',async()=>{
 const fail=()=>assert.fail('JSON skill must not use a provider');
 const post=(content,attachments)=>chat(req({messages:[{role:'user',content,attachments}]}),env,fail);
 const source=String.raw`{"id":9007199254740993,"id":1,"line":"a\nb","values":[{},[]]}`;
 const inline=await post('Есть ответ API. Отформатируй JSON:\n```json\n'+source+'\n```');
 assert.equal(inline.status,200);
 const data=await inline.json();
 assert.equal(data.model,'local-json');
 assert.equal(data.provider,'local');
 assert.match(data.text,/"id": 9007199254740993,\n  "id": 1,/u);
 assert.ok(data.text.includes(String.raw`"line": "a\nb"`));
 const attached=await post('Проверь JSON. Спасибо!',[{name:'input.json',text:source}]);
 assert.equal((await attached.json()).text,data.text);
 const invalid=await post('Отформатируй JSON: {"x":}');
 assert.equal(invalid.status,400);
 assert.match((await invalid.json()).error,/Синтаксическая ошибка/u);
});

test('interactive builds retry incomplete output and send game or app requirements to the model',async()=>{
 const html='<!doctype html><html><body><button id="go">Старт</button><script>document.querySelector("#go").onclick=()=>{document.body.dataset.started="yes";};</script></body></html>';
 const requests=[];
 const response=await chat(req({messages:[{role:'user',content:'Сделай мне залипательную игру на мобилку'}]}),
  {OPENROUTER_API_KEY:'secret'},async(_url,options)=>{
   requests.push(JSON.parse(options.body));
   const content=requests.length===1?'```html index.html\n<h1>Играть</h1>\n```':html;
   return Response.json({choices:[{message:{content},finish_reason:'stop'}]});
  });
 assert.equal(response.status,200);
 assert.equal(requests.length,2);
 assert.match(requests[0].messages[0].content,/играбельную браузерную игру/u);
 assert.match((await response.json()).text,/```html index\.html\n<!doctype html>/u);
 const app=await chat(req({messages:[{role:'user',content:'Собери приложение для учёта расходов'}]}),
  env,async(_url,options)=>{
   assert.match(JSON.parse(options.body).systemInstruction.parts[0].text,/интерактивное приложение/u);
   return Response.json({candidates:[{content:{parts:[{text:html}]},finishReason:'STOP'}]});
  });
 assert.equal(app.status,200);
 assert.match((await app.json()).text,/<script>/u);
});

test('game fallback is playable HTML, and an unavailable app or edit returns an error',async()=>{
 const fail=()=>assert.fail('no configured provider');
 const call=(content,extra={},attachments)=>chat(req({messages:[{role:'user',content,attachments}],...extra}),{},fail);
 const game=await call('Сделай мне залипательную игру на мобилку');
 assert.equal(game.status,200);
 assert.equal((await game.json()).model,'local-game-draft');
 const app=await call('Собери приложение для расходов');
 assert.equal(app.status,503);
 const edit=await call('Добавь новый уровень',{sitePreview:true,previewKind:'game'},[
  {name:'Текущая версия предпросмотра — index.html',text:'<html>Моя игра</html>'},
 ]);
 assert.equal(edit.status,503);
 assert.match((await edit.json()).error,/Текущая версия сохранена/u);
});

test('CSV comparison joins by key and handles reordered rows, columns and quoted values',async()=>{
 const response=await chat(req({messages:[{
  role:'user',content:'Проверяем две выгрузки. Сравни CSV по столбцу «Код товара».',
  attachments:[
   {name:'old.csv',text:'Код товара;Название;Цена\n001;"A; тест";20\n002;B;42\n003;C;15\n004;D;8'},
   {name:'new.csv',text:'Цена,Код товара,Название,Наличие\n42,002,B,да\n9,004,D,да\n20,001,A; тест,да\n80,005,E,нет'},
  ],
 }]}),env,()=>assert.fail('CSV comparison must not use the provider'));
 assert.equal(response.status,200);
 const {model,text}=await response.json();
 assert.equal(model,'local-csv-diff');
 assert.match(text,/Добавлено: 1 · Удалено: 1 · Изменено: 1 · Совпало по общим столбцам: 2/u);
 assert.match(text,/Добавлены столбцы: Наличие/u);
 assert.match(text,/\| Изменена \| 004 \| 4 \| 2 \| Цена: «8» → «9» \|/u);
 assert.match(text,/\| Удалена \| 003/u);
 assert.match(text,/\| Добавлена \| 005/u);
});

test('CSV comparison rejects ambiguous or incomplete input',async()=>{
 const valid={name:'old.csv',text:'id,name\n001,Alpha'};
 for(const [other,error] of [
  [{name:'new.csv',text:'id,name\n001,Alpha\n001,Beta'},/повтор ключа/u],
  [{name:'new.csv',text:'id,name\n,Alpha'},/пустой ключ/u],
  [{name:'new.csv',text:'sku,name\n001,Alpha'},/нет столбца/u],
  [{...valid,truncated:true},/целиком/u],
 ]){
  const response=await chat(req({messages:[{role:'user',content:'Сравни два CSV',attachments:[valid,other]}]}),
   env,()=>assert.fail('invalid CSV must not use the provider'));
  assert.equal(response.status,400);
  assert.match((await response.json()).error,error);
 }
});

test('document verification includes traceable locations and identifies excerpts',async()=>{
 const response=await chat(req({messages:[
  {role:'user',content:'Условия поставки',attachments:[{name:'terms.txt',text:'Договор\nСрок оплаты — 10 дней.'}]},
  {role:'assistant',content:'Принял.'},
  {role:'user',content:'Проверь, пожалуйста, по документу, какой срок оплаты.',attachments:[
   {name:'annex.txt',text:'В доступном фрагменте срок не указан.',truncated:true},
  ]},
 ]}),env,async(_url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.systemInstruction.parts[0].text,/Отдельно отмечай расхождения/u);
  assert.match(body.contents[0].parts[1].text,/terms\.txt \(с номерами строк\)\n1 \| Договор\n2 \| Срок оплаты/u);
  assert.match(body.contents.at(-1).parts[1].text,/annex\.txt \(фрагмент\)/u);
  return Response.json({candidates:[{content:{parts:[{text:'10 дней. terms.txt, строка 2.'}]},finishReason:'STOP'}]});
 });
 assert.equal(response.status,200);
 assert.equal((await response.json()).text,'10 дней. terms.txt, строка 2.');
});

test('Focus answers identity and bare site questions even when the model cannot answer',async()=>{
 const noFetch=()=>assert.fail('A product capability question does not need a provider');
 const ask=(content,config={})=>chat(req({messages:[{role:'user',content}]}),config,noFetch);
 const response=await ask('ты можешь сделать сайт?',{OPENROUTER_API_KEY:'fixture'});
 const site=await response.json();
 assert.equal(site.model,'local-site-question');
 assert.match(site.text,/HTML, CSS и JavaScript.*прямо в чате/u);
 assert.match(site.text,/Какой сайт сделать/u);
 const who=await (await ask('Ты дипсик?')).json();
 assert.match(who.text,/Я — Guzan 1\.1/u);
 const skills=await (await ask('Что ты умеешь?',{TAVILY_API_KEY:'fixture'})).json();
 assert.match(skills.text,/Веб-поиск/u);
 assert.doesNotMatch(skills.text,/изображения|fixture/iu);
});

test('a combined request keeps the exact calculation and completes the plan',async()=>{
 const r=await chat(req({messages:[{role:'user',content:'Посчитай 2+2. Составь план релиза.'}]}),
  {OPENROUTER_API_KEY:'fixture'},async(_url,options)=>{
   const {messages}=JSON.parse(options.body);
   assert.match(messages[0].content,/focus-chart/u);
   assert.match(messages[0].content,/Возможности приложения Focus/u);
   assert.match(messages[0].content,/Режим \/plan/u);
   assert.match(messages.at(-1).content.at(-1).text,/Составь план релиза/u);
   return Response.json({choices:[{message:{content:'- [ ] Собрать релиз'},finish_reason:'stop'}]});
  });
 assert.equal(r.status,200);
 const {text}=await r.json();
 assert.match(text,/Результат.*4/u);
 assert.match(text,/- \[ \] Собрать релиз/u);
});

test('a plain or incomplete website reply retries instead of being used as a preview',async()=>{
 let calls=0;
 const response=await chat(req({messages:[{role:'user',content:'Сделай сайт для фотостудии'}]}),
  {OPENROUTER_API_KEY:'fixture'},async()=>{
   const content=++calls===1?'Опишите, какой сайт нужен':'```html index.html\n<html><h1>Оборванный ответ\n```';
   return Response.json({choices:[{message:{content},finish_reason:'stop'}]});
  });
 assert.equal(calls,2);
 assert.equal((await response.json()).model,'local-site-draft');
});


test('a cut-off OpenRouter answer continues once and keeps the original if continuation fails',async()=>{
 const messages={messages:[{role:'user',content:'Расскажи историю подробно'}]};
 let calls=0;
 const response=await chat(req(messages),{OPENROUTER_API_KEY:'secret'},async(_url,options)=>{
  calls++;
  if(calls===2){
   const body=JSON.parse(options.body);
   assert.equal(body.messages.at(-2).role,'assistant');
   assert.match(body.messages.at(-1).content[0].text,/Продолжи ответ/u);
  }
  return Response.json({choices:[{message:{content:calls===1?'Первая часть, ':'вторая часть.'},finish_reason:calls===1?'length':'stop'}]});
 });
 assert.equal(calls,2);
 assert.equal((await response.json()).text,'Первая часть, вторая часть.');
 let failed=0;
 const partial=await chat(req(messages),{OPENROUTER_API_KEY:'secret'},async()=>{
  if(++failed===2)throw Error('temporary outage');
  return Response.json({choices:[{message:{content:'Начало'},finish_reason:'length'}]});
 });
 assert.equal(partial.status,200);
 assert.equal((await partial.json()).truncated,true);
});



test('Cloudflare quota is recognized on forbidden responses without retrying',async()=>{
 let calls=0;
 const r=await chat(req({messages:[{role:'user',content:'/image cat'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async()=>{calls++;return Response.json({errors:[{code:4006,message:'daily free allocation of 10,000 neurons'}]},{status:403})});
 assert.equal(r.status,429);assert.equal((await r.json()).code,'image_daily_quota');assert.equal(calls,1);
});
test('Cloudflare unavailable model falls back preserving image and prompt',async()=>{
 for(const status of [404,503]){
  const calls=[],imageReference={mimeType:'image/png',data:'iVBORw0KGgo=',width:1024,height:1024};
  const r=await chat(req({messages:[{role:'user',content:'Добавь закат'}],imageReference}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async(url,{body})=>{
   calls.push({url,prompt:body.get('prompt'),image:await body.get('input_image_0').text()});
   return calls.length===1?Response.json({errors:[]},{status}):Response.json({result:{image:imageReference.data}});
  });
  assert.equal(r.status,200);assert.equal(calls.length,2);assert.match(calls[1].url,/klein-4b$/);assert.equal(calls[0].prompt,calls[1].prompt);assert.equal(calls[0].image,calls[1].image);
 }
});
test('Cloudflare permanent errors expose safe diagnostics and never retry',async()=>{
 for(const status of [400,401,403,413,422,500]){
  let calls=0;const r=await chat(req({messages:[{role:'user',content:'/image cat'}]}),{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'cf'},async()=>{calls++;return Response.json({errors:[{code:9999,message:'private-provider-secret'}]},{status})});
  const data=await r.json();assert.equal(calls,1);assert.equal(data.providerStatus,status);assert.equal(data.providerCode,9999);assert.ok(!JSON.stringify(data).includes('private-provider-secret'));
 }
});
