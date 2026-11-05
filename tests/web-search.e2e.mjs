import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from '../scripts/server.mjs';
const server=createServer({});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sources=Array.from({length:8},(_,i)=>({id:i+1,domain:`source${i+1}.example`,url:`https://source${i+1}.example/article`,title:`Проверенный источник ${i+1}`,snippet:'Краткая выдержка из найденного материала. <script>window.injected=true</script>'}));
const research={searchId:'test-snapshot',query:'Проверь новости',sources,searchedAt:'2026-11-05T12:00:00Z'};
const reply={text:'Найденные сведения подтверждаются источниками [1] и [2].\n\n`[1]` — пример кода, а [99] отсутствует в выдаче.',model:'test-model',search:{query:research.query,sources,searchedAt:research.searchedAt}};
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
let browser;
try{
 browser=await chromium.launch({headless:true});await mkdir('test-artifacts',{recursive:true});
 for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();
  let searchGate=pending(),chatGate=pending(),searchCalls=0,chatCalls=0;
  await page.route('**/api/status',route=>route.fulfill({json:{configured:true,provider:'openrouter',label:'Guzan 1.1',searchConfigured:true}}));
  await page.route('**/api/search',async route=>{searchCalls++;await searchGate.promise;await route.fulfill({json:research})});
  await page.route('**/api/chat',async route=>{chatCalls++;assert.equal(route.request().postDataJSON().searchId,'test-snapshot');await chatGate.promise;await route.fulfill({json:reply})});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:'Поиск в интернете',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Поиск в интернете',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Проверь новости');
  await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  await page.getByText('Ищу в интернете',{exact:false}).waitFor();assert.equal(chatCalls,0);
  searchGate.resolve();await page.getByText('Готовлю ответ',{exact:false}).waitFor();
  await page.locator('.source-chips').waitFor();assert.equal(await page.locator('a.source-chip').count(),6);
  await page.getByRole('button',{name:'Показать остальные источники'}).click();
  const dialog=page.getByRole('dialog',{name:'Источники поиска'});await dialog.waitFor();assert.equal(await dialog.locator('.source-result').count(),8);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  chatGate.resolve();await page.locator('.source-citation').first().waitFor();
  assert.equal(await page.locator('.source-citation').count(),2);
  assert.equal(await page.locator('.source-citation').first().getAttribute('href'),sources[0].url);
  assert.equal(await page.locator('.markdown code').textContent(),'[1]');
  assert.equal(searchCalls,1);assert.equal(chatCalls,1);
  await page.reload();await page.waitForLoadState('networkidle');await page.locator('.source-citation').first().waitFor();
  assert.equal(searchCalls,1);assert.equal(chatCalls,1);
  const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,composer:document.querySelector('.composer-area').getBoundingClientRect().bottom,height:innerHeight}));
  assert.ok(dimensions.documentWidth<=dimensions.width+1,'Source UI overflows horizontally');assert.ok(dimensions.composer<=dimensions.height+1,'Composer clipped by search controls');
  await page.screenshot({path:`test-artifacts/search-${viewport.width}.png`});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await page.screenshot({path:`test-artifacts/search-${viewport.width}-dark.png`});
  console.log(`Search phases, source pills, citations, persistence and layout verified: ${viewport.width}`);
  await context.close();
 }
 // Failed search must not call the language model or fabricate source pills.
 const context=await browser.newContext();const page=await context.newPage();let modelCalls=0;
 await page.route('**/api/status',route=>route.fulfill({json:{configured:true,provider:'openrouter',searchConfigured:true}}));
 await page.route('**/api/search',route=>route.fulfill({status:429,json:{error:'Квота поиска исчерпана'}}));
 await page.route('**/api/chat',route=>{modelCalls++;return route.fulfill({json:reply})});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForLoadState('networkidle');
 await page.getByRole('button',{name:'Поиск в интернете',exact:true}).click();await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Тест поиска');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await page.getByText('Квота поиска исчерпана',{exact:true}).waitFor();assert.equal(modelCalls,0);assert.equal(await page.locator('.source-chips').count(),0);
 await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
