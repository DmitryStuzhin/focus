// Browser regression check, run by CI after building the app.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import http from 'node:http';
import {Readable} from 'node:stream';
import worker from '../dist/server/index.js';
import {chat} from '../worker/api.js';
import {fresh,STORAGE_KEY} from '../public/store.js';
const state=fresh();
state.activeChat='long-chat';
state.chats=[{id:'long-chat',project:'personal',title:'Длинный диалог',created:Date.now(),updated:Date.now(),archived:false,deleted:false,messages:Array.from({length:40},(_,index)=>({id:`message-${index}`,role:index%2?'assistant':'user',content:index%2?Array.from({length:12},(_,n)=>`Абзац ${n+1}. Развёрнутый ответ с пояснениями и примером.`).join('\n\n'):`Вопрос ${index+1}`,at:Date.now()}))}];
// Exercise local skills in this browser fixture without creating accounts in every viewport.
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://'+req.headers.host);
 const request=new Request(url,{method:req.method,headers:req.headers,
  ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
 let response;
 if(url.pathname==='/api/auth/session')response=Response.json({enabled:false,user:null});
 else if(url.pathname==='/api/chat')response=await chat(request,{});
 else response=await worker.fetch(request,{},url.pathname==='/api/status'?{userId:'browser-fixture'}:{});
 res.writeHead(response.status,Object.fromEntries(response.headers));
 if(response.body)Readable.fromWeb(response.body).pipe(res);
 else res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 for(const viewport of [{width:1440,height:900},{width:1024,height:400},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  await context.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state});
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelectorAll('.messages article').length===40);
  // Let the initial provider-status render settle before simulating wheel input.
  await page.waitForLoadState('networkidle');
  const layout=await page.evaluate(()=>{
   const main=document.querySelector('.main').getBoundingClientRect();
   const composer=document.querySelector('.composer-area').getBoundingClientRect();
   const scroller=document.querySelector('#main-scroll');
   return {mainBottom:main.bottom,composerTop:composer.top,composerBottom:composer.bottom,height:innerHeight,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,documentHeight:document.documentElement.scrollHeight};
  });
  assert.ok(layout.mainBottom<=layout.height+1,`Main escaped viewport: ${JSON.stringify(layout)}`);
  assert.ok(layout.composerTop>=0&&layout.composerBottom<=layout.height+1,`Composer escaped viewport: ${JSON.stringify(layout)}`);
  assert.ok(layout.clientHeight>50&&layout.scrollHeight>layout.clientHeight,'History must have its own scrollable area');
  assert.ok(layout.documentHeight<=layout.height+1,'The application must fit within the page viewport');
  await page.locator('#main-scroll').hover();
  await page.mouse.wheel(0,700);
  await page.waitForFunction(()=>document.querySelector('#main-scroll').scrollTop>0);
  await page.evaluate(()=>{const s=document.querySelector('#main-scroll');s.scrollTo({top:s.scrollHeight,behavior:'instant'})});
  const bottom=await page.evaluate(()=>{const s=document.querySelector('#main-scroll');return {remaining:s.scrollHeight-s.scrollTop-s.clientHeight,lastBottom:s.querySelector('article:last-of-type').getBoundingClientRect().bottom,scrollBottom:s.getBoundingClientRect().bottom}});
  assert.ok(bottom.remaining<=1,'Cannot reach the end of history');
  assert.ok(bottom.lastBottom<=bottom.scrollBottom+1,'Last response is clipped at scroll end');
  console.log(`Long-chat scroll and composer verified: ${viewport.width}x${viewport.height}`);
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForLoadState('networkidle');
 const toggle=page.getByRole('button',{name:'Тёмная тема',exact:true});
 assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 const composer=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await composer.fill('Посчитай 0,1 + 0,2');
 await toggle.click();
 assert.equal(await composer.inputValue(),'Посчитай 0,1 + 0,2');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await page.getByText('0,3',{exact:false}).last().waitFor();
 assert.equal(await page.locator('.assistant-message .assistant-label span').textContent(),'Калькулятор');
 assert.equal(await page.locator('.topbar .status').textContent(),'Не подключено');
 await page.reload();
 await page.waitForLoadState('networkidle');
 assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await context.close();
 console.log('System theme, theme persistence and local calculator verified in the chat');
 const imagesContext=await browser.newContext();
 const imagesPage=await imagesContext.newPage();
 await imagesPage.goto('http://127.0.0.1:'+server.address().port);
 await imagesPage.waitForLoadState('networkidle');
 const pngs=await imagesPage.evaluate(()=>['red','blue','green'].map(color=>{
  const c=document.createElement('canvas');c.width=1024;c.height=1024;
  const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1024,1024);
  return c.toDataURL('image/png').split(',')[1];
 }));
 const sent=[];
 await imagesPage.route('**/api/chat',async route=>{
  sent.push(route.request().postDataJSON());
  await route.fulfill({json:{text:'Изображение готово.',provider:'image',model:'test',image:{mimeType:'image/png',data:pngs[sent.length-1]}}});
 });
 for(const [i,prompt] of ['Нарисуй кота','Добавь закат','Сделай фон темнее'].entries()){
  await imagesPage.getByRole('textbox',{name:'Сообщение',exact:true}).fill(prompt);
  await imagesPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  await imagesPage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true}).click();
  await imagesPage.waitForFunction(n=>document.querySelectorAll('[data-generated-file]').length===n,i+1);
 }
 assert.equal(sent[0].imageReference,undefined);
 for(const [i,color] of [[1,[255,0,0]],[2,[0,0,255]]]){
  const ref=sent[i].imageReference;assert.equal(ref.width,1024);assert.equal(ref.height,1024);
  const decoded=await imagesPage.evaluate(async ref=>{
   const blob=new Blob([Uint8Array.from(atob(ref.data),c=>c.charCodeAt(0))],{type:'image/png'});const bmp=await createImageBitmap(blob);
   const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0,1,1);
   return {width:bmp.width,height:bmp.height,color:[...ctx.getImageData(0,0,1,1).data].slice(0,3)};
  },ref);
  assert.equal(decoded.width,512);assert.equal(decoded.height,512);assert.deepEqual(decoded.color,color);
 }
 await imagesContext.close();
 console.log('Natural creation and two successive image edits preserve the latest image');
 const codePage=await browser.newPage({viewport:{width:1440,height:900}});
 await codePage.goto('http://127.0.0.1:'+server.address().port);
 await codePage.waitForLoadState('networkidle');
 const requests=[];
 const original='fn main() { println!("hello"); }\n';
 const updated='fn main() { println!("updated"); }\n';
 await codePage.route('**/api/chat',async route=>{
  requests.push(route.request().postDataJSON());
  await route.fulfill({json:{text:'```rust main.rs\n'+(requests.length===1?original:updated)+'```',model:'test'}});
 });
 await codePage.getByRole('button',{name:'Написать код',exact:true}).click();
 const codeComposer=codePage.getByRole('textbox',{name:'Сообщение',exact:true});
 assert.equal(await codeComposer.inputValue(),'Напиши код для ');
 await codeComposer.fill('Создай файл main.rs');
 await codePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const saveCode=codePage.getByRole('button',{name:'Сохранить в проект',exact:true});
 await saveCode.waitFor();
 assert.equal(await codePage.getByRole('button',{name:'Действия с файлом main.rs'}).count(),0);
 await codePage.getByRole('button',{name:'Сохранить файлы Forge',exact:true}).click();
 await codePage.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
 assert.equal(await codePage.getByRole('button',{name:'Действия с файлом main.rs'}).count(),0);
 await saveCode.click();
 assert.equal(await codePage.locator('#proposed-code').inputValue(),original);
 await codePage.getByRole('button',{name:'Сохранить файл',exact:true}).click();
 const fileMenu=codePage.getByRole('button',{name:'Действия с файлом main.rs'});
 await fileMenu.click();
 await codePage.getByText('Прикрепить к сообщению',{exact:true}).click();
 await codeComposer.fill('Измени main.rs');
 await codePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await codePage.getByRole('button',{name:'Сохранить в проект',exact:true}).nth(1).click();
 assert.equal(requests[1].messages.at(-1).attachments[0].text,original);
 assert.equal(await codePage.locator('#proposed-code').inputValue(),updated);
 assert.match(await codePage.locator('.diff-removed').textContent(),/println!\("hello"\)/);
 assert.match(await codePage.locator('.diff-added').textContent(),/println!\("updated"\)/);

 const fileId=await fileMenu.getAttribute('data-id');
 await codePage.evaluate(async id=>{
  const {putBlob}=await import('/store.js');
  await putBlob(id,new Blob(['edited elsewhere'],{type:'text/plain'}));
 },fileId);
 await codePage.getByRole('button',{name:'Применить правку',exact:true}).click();
 await codePage.getByText(/Исходный файл изменился/).waitFor();
 assert.equal(await codePage.evaluate(async id=>{
  const {getBlob}=await import('/store.js');
  return (await getBlob(id)).text();
 },fileId),'edited elsewhere');
 await codePage.getByRole('button',{name:'Отмена',exact:true}).click();
 await codeComposer.fill('Не помню, где это было. Найди в проекте «edited elsewhere»');
 await codePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await codePage.getByRole('button',{name:/main\.rs:1.*edited elsewhere/}).click();
 const matchDialog=codePage.getByRole('dialog',{name:'main.rs:1'});
 await matchDialog.getByText('edited elsewhere',{exact:true}).waitFor();
 assert.equal(requests.length,2,'project search must not call the provider or chat API');
 await codePage.close();
 console.log('Code generation, stale edit protection and local project search verified');
 const quotePage=await browser.newPage({viewport:{width:1440,height:900}});
 await quotePage.goto('http://127.0.0.1:'+server.address().port);
 await quotePage.waitForLoadState('networkidle');
 const example='def greet(name):\n    return "<b>Привет</b>"\n';
 const quoteRequests=[];
 await quotePage.route('**/api/chat',async route=>{
  quoteRequests.push(route.request().postDataJSON());
  const text=quoteRequests.length===1?'```python\n'+example+'```':'Пояснение к цитате.';
  await route.fulfill({json:{text,model:'test'}});
 });
 const quoteComposer=quotePage.getByRole('textbox',{name:'Сообщение',exact:true});
 const quoteSend=quotePage.getByRole('button',{name:'Отправить сообщение',exact:true});
 await quoteComposer.fill('Покажи пример функции');
 await quoteSend.click();
 const code=quotePage.locator('.code-block code');
 const keyword=code.locator('.hljs-keyword').first();
 await keyword.waitFor();
 assert.equal(await code.textContent(),example);
 assert.equal(await code.locator('b').count(),0,'code markup must stay inert');
 const darkColor=await keyword.evaluate(node=>getComputedStyle(node).color);
 await quotePage.getByRole('button',{name:'Тёмная тема',exact:true}).click();
 assert.notEqual(await keyword.evaluate(node=>getComputedStyle(node).color),darkColor);
 await quoteComposer.fill('Что делает эта строка?');
 const start=await keyword.boundingBox();
 const name=await code.locator('.hljs-title').first().boundingBox();
 await quotePage.mouse.move(start.x,start.y+start.height/2);
 await quotePage.mouse.down();
 await quotePage.mouse.move(name.x+name.width,name.y+name.height/2,{steps:8});
 await quotePage.mouse.up();
 const ask=quotePage.getByRole('button',{name:'Спросить Focus',exact:true});
 await ask.waitFor();
 const selected=await quotePage.evaluate(()=>getSelection().toString().trim());
 assert.equal(selected,'def greet');
 await ask.click();
 const quotePreview=quotePage.locator('#composer-quote');
 assert.equal(await quotePreview.locator('.quote-copy span').textContent(),selected);
 assert.equal(await quoteComposer.inputValue(),'Что делает эта строка?');
 await quotePage.getByRole('button',{name:'Убрать цитату'}).click();
 assert.equal(await quotePreview.locator('.message-quote').count(),0);
 await code.evaluate(node=>{
  document.activeElement.blur();
  const range=document.createRange();
  range.selectNodeContents(node);
  const selection=getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
 });
 await ask.click();
 await quoteSend.click();
 await quotePage.getByText('Пояснение к цитате.',{exact:true}).waitFor();
 const sentQuote=quoteRequests[1].messages.at(-1);
 assert.equal(sentQuote.content,'Что делает эта строка?');
 assert.equal(sentQuote.quote,example.trim());
 await quotePage.reload();
 await quotePage.waitForLoadState('networkidle');
 const savedQuote=quotePage.locator('.message-bubble .quote-copy span');
 assert.equal(await savedQuote.textContent(),example.trim());
 await quotePage.getByRole('button',{name:'Повторить ответ',exact:true}).last().click();
 await quotePage.getByText('Пояснение к цитате.',{exact:true}).waitFor();
 assert.equal(quoteRequests[2].messages.at(-1).quote,example.trim());
 await quotePage.close();
 console.log('Syntax highlighting, selection, removable quote, persisted context and retry verified');
 const planPage=await browser.newPage({viewport:{width:1440,height:900}});
 await planPage.goto('http://127.0.0.1:'+server.address().port);
 await planPage.waitForLoadState('networkidle');
 const planRequests=[];
 await planPage.route('**/api/chat',async route=>{
  planRequests.push(route.request().postDataJSON());
  await route.fulfill({json:{text:planRequests.length===1?'## План\n- [ ] Собрать материалы\n- [ ] Проверить результат':'Продолжаем со второго шага.',model:'test'}});
 });
 await planPage.getByRole('button',{name:'Продумать план',exact:true}).click();
 const planComposer=planPage.getByRole('textbox',{name:'Сообщение',exact:true});
 assert.equal(await planComposer.inputValue(),'Составь план для ');
 await planComposer.fill('Составь план подготовки выпуска');
 await planPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await planPage.getByRole('checkbox',{name:'Собрать материалы'}).check();
 await planPage.reload();
 await planPage.waitForLoadState('networkidle');
 assert.equal(await planPage.getByRole('checkbox',{name:'Собрать материалы'}).isChecked(),true);
 assert.equal(await planPage.getByRole('checkbox',{name:'Проверить результат'}).isChecked(),false);
 await planComposer.fill('Что осталось?');
 await planPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await planPage.getByText('Продолжаем со второго шага.',{exact:true}).waitFor();
 assert.match(planRequests[1].messages.find(m=>m.role==='assistant').content,/- \[x\] Собрать материалы/);
 await planPage.close();
 console.log('Plan progress persists and is included in the next chat request');
 const sitePage=await browser.newPage({viewport:{width:1440,height:900}});
 const siteRequests=[];
 const siteHTML=(heading)=>`<!doctype html><html><head><style>h1{color:rgb(18, 52, 86)}</style></head>
 <body><h1>${heading}</h1><button id="count">0</button><script>
 const button=document.getElementById('count');
 button.onclick=()=>button.textContent=String(Number(button.textContent)+1);
 try { parent.document.body.dataset.compromised='true'; } catch { document.body.dataset.isolated='true'; }
 fetch('/api/status').catch(()=>document.body.dataset.networkBlocked='true');
 </script></body></html>`;
 await sitePage.route('**/api/chat',async route=>{
  siteRequests.push(route.request().postDataJSON());
   if(!siteRequests.at(-1).sitePreview){
   await route.fulfill({json:{text:'Краткое резюме разговора.',model:'test'}});
   return;
  }
  const heading=siteRequests.filter(request=>request.sitePreview).length===1?'Первый сайт':'Вторая версия';
  await route.fulfill({json:{text:'```html index.html\n'+siteHTML(heading)+'\n```',model:'test'}});
 });
 await sitePage.goto('http://127.0.0.1:'+server.address().port);
 await sitePage.waitForLoadState('networkidle');
 const siteComposer=sitePage.getByRole('textbox',{name:'Сообщение',exact:true});
 await sitePage.getByRole('button',{name:'Создать сайт',exact:true}).click();
 assert.equal(await siteComposer.inputValue(),'Сделай сайт');
 await siteComposer.fill('У меня есть идея для демо. Сделай сайт со счётчиком');
 await sitePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await sitePage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true}).click();
 await sitePage.getByRole('button',{name:'Предпросмотр',exact:true}).last().click();
 const frame=sitePage.frameLocator('#preview-root iframe');
 const heading=frame.getByRole('heading',{name:'Первый сайт'});
 await heading.waitFor();
 assert.equal(siteRequests[0].sitePreview,true);
 assert.equal(await heading.evaluate(el=>getComputedStyle(el).color),'rgb(18, 52, 86)');
 const sandbox=sitePage.locator('#preview-root iframe');
 assert.equal(await sandbox.getAttribute('sandbox'),'allow-scripts');
 await frame.locator('body[data-isolated=true][data-network-blocked=true]').waitFor();
 assert.equal(await sitePage.locator('body').getAttribute('data-compromised'),null);
 const bounds=await sitePage.locator('#preview-root').boundingBox();
 const chatBounds=await sitePage.locator('.main').boundingBox();
 assert.ok(bounds.x>=chatBounds.x+chatBounds.width-1,'preview must appear to the right of the chat');
 await frame.getByRole('button',{name:'0'}).click();
 await frame.getByRole('button',{name:'1'}).waitFor();
 await sitePage.getByRole('button',{name:'На весь экран',exact:true}).click();
 assert.equal((await sitePage.locator('#preview-root').boundingBox()).width,1440);
 await sitePage.getByRole('button',{name:'Свернуть',exact:true}).click();
 await siteComposer.fill('Сделай краткое резюме разговора');
 await sitePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await sitePage.getByText('Краткое резюме разговора.',{exact:true}).waitFor();
 assert.equal(siteRequests[1].sitePreview,undefined);
 assert.equal(siteRequests[1].messages.at(-1).attachments.length,0);
 await siteComposer.fill('Первая версия подходит. Теперь добавь на сайт новый заголовок');
 await frame.getByRole('button',{name:'1'}).waitFor();
 await sitePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await sitePage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true}).click();
 await sitePage.getByRole('button',{name:'Предпросмотр',exact:true}).last().click();
 await frame.getByRole('heading',{name:'Вторая версия'}).waitFor();
 assert.equal(siteRequests[2].sitePreview,true);
 assert.match(siteRequests[2].messages.at(-1).attachments[0].text,/<h1>Первый сайт<\/h1>/);
 await sitePage.reload();
 await frame.getByRole('heading',{name:'Вторая версия'}).waitFor();
 await sitePage.getByRole('button',{name:'Закрыть предпросмотр',exact:true}).click();
 await sitePage.locator('#preview-root').waitFor({state:'hidden'});
 await sitePage.getByRole('button',{name:'Предпросмотр',exact:true}).first().click();
 await frame.getByRole('heading',{name:'Первый сайт'}).waitFor();
 await sitePage.close();
 console.log('Isolated interactive site preview opens beside chat and updates after revisions');
 const draftPage=await browser.newPage({viewport:{width:1440,height:900}});
 await draftPage.goto('http://127.0.0.1:'+server.address().port);
 await draftPage.waitForLoadState('networkidle');
 await draftPage.getByRole('button',{name:'Создать сайт',exact:true}).click();
 const draftComposer=draftPage.getByRole('textbox',{name:'Сообщение',exact:true});
 assert.equal(await draftComposer.inputValue(),'Сделай сайт');
 await draftComposer.fill('ты можешь сделать сайт?');
 await draftPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await draftPage.getByText(/Какой сайт сделать/).waitFor();
 await draftComposer.fill('Для стоматологической клиники');
 await draftPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const draftConfirmation=draftPage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true});
 await draftConfirmation.click();
 await draftPage.getByRole('button',{name:'Предпросмотр',exact:true}).last().click();
 const draftFrame=draftPage.frameLocator('#preview-root iframe');
 await draftFrame.getByRole('heading',{name:'Забота о вашей улыбке'}).waitFor();
 await draftPage.getByText(/Подготовил стартовую страницу/).waitFor();
 const question=draftFrame.getByText('Как записаться?',{exact:true});
 await question.click();
 assert.equal(await draftFrame.locator('details[open]').count(),1);
 const right=await draftPage.locator('#preview-root').boundingBox();
 const chatBox=await draftPage.locator('.main').boundingBox();
 assert.ok(right.x>=chatBox.x+chatBox.width-1);
 await draftPage.close();
 console.log('Dental site opens to the right using the actual API without model credentials');
 const gamePage=await browser.newPage({viewport:{width:1440,height:900}});
 await gamePage.goto('http://127.0.0.1:'+server.address().port);
 await gamePage.waitForLoadState('networkidle');
 const gameComposer=gamePage.getByRole('textbox',{name:'Сообщение',exact:true});
 await gameComposer.fill('Сделай мне залипательную игру на мобилку');
 await gamePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await gamePage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true}).click();
 await gamePage.getByRole('button',{name:'Предпросмотр',exact:true}).last().click();
 const gameFrame=gamePage.frameLocator('#preview-root iframe');
 await gameFrame.getByRole('heading',{name:'Поймай импульс'}).waitFor();
 const gameBox=await gamePage.locator('#preview-root').boundingBox();
 const gameChat=await gamePage.locator('.main').boundingBox();
 assert.ok(gameBox.x>=gameChat.x+gameChat.width-1);
 await gameFrame.getByRole('button',{name:'Играть',exact:true}).click();
 await gameFrame.locator('.cell[data-target]').evaluate(cell=>cell.click());
 assert.equal(await gameFrame.locator('#score').textContent(),'1');
 await gameFrame.locator('body').evaluate(()=>{
  const now=performance.now.bind(performance);
  performance.now=()=>now()+21000;
  document.querySelector('#start').addEventListener('click',()=>{performance.now=now;},{once:true,capture:true});
 });
 await gameFrame.getByRole('button',{name:'Играть снова',exact:true}).click();
 assert.equal(await gameFrame.locator('#score').textContent(),'0');
 let gameRevision;
 await gamePage.route('**/api/chat',async route=>{
  gameRevision=route.request().postDataJSON();
  await route.fulfill({status:503,json:{error:'Модель недоступна. Текущая версия сохранена.'}});
 });
 await gameComposer.fill('Сделай игру сложнее');
 await gamePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await gamePage.getByRole('dialog').getByRole('button',{name:'Запустить',exact:true}).click();
 await gamePage.getByText('Модель недоступна. Текущая версия сохранена.',{exact:true}).waitFor();
 assert.equal(gameRevision.previewKind,'game');
 assert.match(gameRevision.messages.at(-1).attachments[0].text,/Поймай импульс/u);
 await gameFrame.getByRole('heading',{name:'Поймай импульс'}).waitFor();
 await gamePage.close();
 console.log('Natural mobile game request opens a playable preview with score, restart and revision context');

 const csvPage=await browser.newPage({viewport:{width:1440,height:900}});
 await csvPage.goto('http://127.0.0.1:'+server.address().port);
 await csvPage.waitForLoadState('networkidle');
 const chooser=csvPage.waitForEvent('filechooser');
 await csvPage.getByRole('button',{name:'Прикрепить файлы',exact:true}).click();
 await (await chooser).setFiles([
  {name:'old.csv',mimeType:'text/csv',buffer:Buffer.from('id,price\n001,12\n002,24')},
  {name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('id,price\n002,24\n001,15')},
 ]);
 await csvPage.locator('.attachment-chip').nth(1).waitFor();
 await csvPage.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Вот два отчёта. Сравни, пожалуйста, CSV по столбцу id');
 await csvPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const report=csvPage.getByRole('table').filter({hasText:'Запись в первом файле'});
 await report.getByRole('cell',{name:'price: «12» → «15»',exact:true}).waitFor();
 assert.equal(await report.getByRole('row').count(),2);
 await csvPage.close();
 console.log('CSV comparison uses both chat attachments and shows the exact changed cell without a model');

 const chartPage=await browser.newPage({viewport:{width:390,height:844}});
 const chartReply=[
  '## 📊 Результаты',
  '',
  'Период | Значение',
  '--- | ---:',
  'Пн | 12',
  'Вт | 19',
  '',
  '```json',
  JSON.stringify({type:'line',title:'Посещения',unit:'визитов',labels:['Пн','Вт'],values:[12,19]}),
  '```',
  '',
  '> Визитов стало больше.',
  '',
  '```json',
  JSON.stringify({type:'bar',title:'Продажи',labels:['Пн','Вт'],values:[30,20]}),
  '```',
  '',
  '```json',
  JSON.stringify({status:'ok'}),
  '```',
 ].join('\n');
 await chartPage.route('**/api/chat',route=>route.fulfill({json:{text:chartReply,model:'test'}}));
 await chartPage.goto('http://127.0.0.1:'+server.address().port);
 await chartPage.waitForLoadState('networkidle');
 await chartPage.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Оформи статистику');
 await chartPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const graphic=chartPage.getByRole('img',{name:'Посещения'});
 await graphic.waitFor();
 const graphBox=await graphic.boundingBox();
 assert.ok(graphBox.x>=0&&graphBox.x+graphBox.width<=390);
 await chartPage.getByRole('cell',{name:'19',exact:true}).waitFor();
 await chartPage.getByRole('img',{name:'Продажи'}).waitFor();
 await chartPage.locator('.code-block pre').getByText('{"status":"ok"}',{exact:true}).waitFor();
 await chartPage.locator('.answer-chart').first().getByText('Данные графика',{exact:true}).click();
 await chartPage.locator('.answer-chart table').getByRole('cell',{name:'19',exact:true}).waitFor();
 await chartPage.reload();
 await chartPage.getByRole('img',{name:'Продажи'}).waitFor();
 await chartPage.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Покажи только JSON для графика');
 await chartPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const codeReply=chartPage.locator('.assistant-message').last();
 await codeReply.locator('.code-block pre').filter({hasText:'Посещения'}).waitFor();
 assert.equal(await codeReply.locator('.answer-chart').count(),0);
 await chartPage.close();
 console.log('A phone renders an SVG chart with inspectable values, a Markdown table and a callout');

 const officePage=await browser.newPage({viewport:{width:390,height:844}});
 await officePage.goto('http://127.0.0.1:'+server.address().port+'/#tables');
 await officePage.getByRole('heading',{name:'Сверка таблиц'}).waitFor();
 const office=await officePage.evaluate(async()=>{
  const {createWorkbook,createDocument,createSlides,openTable,officeText}=await import('/office.js');
  const workbook=createWorkbook([{name:'Товары',rows:[['id','price'],['001','10']]}]);
  return {
   rows:await openTable(new File([workbook],'fixture.xlsx')),
   workbook:Array.from(new Uint8Array(await workbook.arrayBuffer())),
   word:(await officeText(new File([createDocument('Сводка','Пункт & данные')],'fixture.docx'))).text,
   slides:(await officeText(new File([createSlides('Слайды','# Раздел\nСодержимое')],'fixture.pptx'))).text
  };
 });
 assert.deepEqual(office.rows,[['id','price'],['001','10']]);
 assert.match(office.word,/Пункт & данные/u);
 assert.match(office.slides,/Слайд 1\nРаздел\nСодержимое/u);
 await officePage.locator('#table-before').setInputFiles({name:'before.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(office.workbook)});
 await officePage.locator('#table-after').setInputFiles({name:'after.csv',mimeType:'text/csv',buffer:Buffer.from('id;price\n001;11\n002;20')});
 await officePage.getByRole('button',{name:'Сравнить',exact:true}).click();
 await officePage.getByRole('heading',{name:'Результат сверки'}).waitFor();
 assert.equal(await officePage.locator('.table-totals dd').allTextContents().then(values=>values.join(',')),'1,0,1,0');
 const downloaded=officePage.waitForEvent('download');
 await officePage.getByRole('button',{name:'Скачать XLSX'}).click();
 assert.match((await downloaded).suggestedFilename(),/\.xlsx$/u);
 assert.equal(await officePage.evaluate(()=>document.documentElement.scrollWidth),390);
 await officePage.close();
 console.log('Office attachments and XLSX comparison work on a phone');


}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}

await import("./auth.e2e.mjs");
