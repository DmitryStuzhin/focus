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
   const blob=await (await fetch('data:image/png;base64,'+ref.data)).blob();const bmp=await createImageBitmap(blob);
   const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0,1,1);
   return {width:bmp.width,height:bmp.height,color:[...ctx.getImageData(0,0,1,1).data].slice(0,3)};
  },ref);
  assert.equal(decoded.width,512);assert.equal(decoded.height,512);assert.deepEqual(decoded.color,color);
 }
 await imagesContext.close();
 console.log('Natural creation and two successive image edits preserve the latest image');

}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
