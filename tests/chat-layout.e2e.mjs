// Browser regression check, run by CI after building the app.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from '../scripts/server.mjs';
import {fresh,STORAGE_KEY} from '../public/store.js';
const state=fresh();
state.activeChat='long-chat';
state.chats=[{id:'long-chat',project:'personal',title:'Длинный диалог',created:Date.now(),updated:Date.now(),archived:false,deleted:false,messages:Array.from({length:40},(_,index)=>({id:`message-${index}`,role:index%2?'assistant':'user',content:index%2?Array.from({length:12},(_,n)=>`Абзац ${n+1}. Развёрнутый ответ с пояснениями и примером.`).join('\n\n'):`Вопрос ${index+1}`,at:Date.now()}))}];
const server=createServer({});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
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
 assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 const composer=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await composer.fill('/calc 0,1 + 0,2');
 await toggle.click();
 assert.equal(await composer.inputValue(),'/calc 0,1 + 0,2');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await page.getByText('0,3',{exact:false}).last().waitFor();
 assert.equal(await page.locator('.assistant-message .assistant-label span').textContent(),'Калькулятор');
 assert.equal(await page.locator('.topbar .status').textContent(),'Не подключено');
 await page.reload();
 await page.waitForLoadState('networkidle');
 assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await context.close();
 console.log('Dark default, theme persistence and local calculator verified in the chat');
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
 assert.equal(await codeComposer.inputValue(),'/code ');
 await codeComposer.fill('/code создай main.rs');
 await codePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await codePage.getByRole('button',{name:'Сохранить в проект',exact:true}).click();
 assert.equal(await codePage.locator('#proposed-code').inputValue(),original);
 await codePage.getByRole('button',{name:'Сохранить файл',exact:true}).click();
 const fileMenu=codePage.getByRole('button',{name:'Действия с файлом main.rs'});
 await fileMenu.click();
 await codePage.getByText('Прикрепить к сообщению',{exact:true}).click();
 await codeComposer.fill('/code измени main.rs');
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
 await codePage.close();
 console.log('Code generation, file preview and stale edit protection verified');
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
 assert.equal(await planComposer.inputValue(),'/plan ');
 await planComposer.fill('/plan подготовить выпуск');
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
  const heading=siteRequests.length===1?'Первый сайт':'Вторая версия';
  await route.fulfill({json:{text:'```html index.html\n'+siteHTML(heading)+'\n```',model:'test'}});
 });
 await sitePage.goto('http://127.0.0.1:'+server.address().port);
 await sitePage.waitForLoadState('networkidle');
 const siteComposer=sitePage.getByRole('textbox',{name:'Сообщение',exact:true});
 await sitePage.getByRole('button',{name:'Создать сайт',exact:true}).click();
 assert.equal(await siteComposer.inputValue(),'/site ');
 await siteComposer.fill('Сделай сайт со счётчиком');
 await sitePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const frame=sitePage.frameLocator('#preview-root iframe');
 const heading=frame.getByRole('heading',{name:'Первый сайт'});
 await heading.waitFor();
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
 await siteComposer.fill('Добавь новый заголовок');
 await frame.getByRole('button',{name:'1'}).waitFor();
 await sitePage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await frame.getByRole('heading',{name:'Вторая версия'}).waitFor();
 assert.equal(siteRequests[1].sitePreview,true);
 assert.match(siteRequests[1].messages.at(-1).attachments[0].text,/<h1>Первый сайт<\/h1>/);
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
 await draftPage.getByRole('textbox',{name:'Сообщение',exact:true}).fill('/site сделай сайт для стоматологической клиники');
 await draftPage.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const draftFrame=draftPage.frameLocator('#preview-root iframe');
 await draftFrame.getByRole('heading',{name:'Забота о вашей улыбке'}).waitFor();
 await draftPage.getByText(/Открыл стартовую страницу/).waitFor();
 const question=draftFrame.getByText('Как записаться?',{exact:true});
 await question.click();
 assert.equal(await draftFrame.locator('details[open]').count(),1);
 const right=await draftPage.locator('#preview-root').boundingBox();
 const chatBox=await draftPage.locator('.main').boundingBox();
 assert.ok(right.x>=chatBox.x+chatBox.width-1);
 await draftPage.close();
 console.log('Dental site opens to the right using the actual API without model credentials');





}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
