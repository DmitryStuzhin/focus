import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from '../scripts/server.mjs';

let code;
const server=createServer({
 FOCUS_AUTH_ENABLED:'1',
 FOCUS_AUTH_SECRET:'fixture-secret-for-product-browser-test',
 FOCUS_AUTH_DB:':memory:',
 FOCUS_SMTP_USER:'auth@example.com',
 FOCUS_SMTP_PASSWORD:'fixture',
},undefined,{mailer:async mail=>{code=mail.code;}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
await mkdir('test-artifacts',{recursive:true});
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(url+'/tools.html#profile');
 const profile=page.locator('#profile');
 await profile.locator('input[type=file]').setInputFiles({
  name:'totals.csv',mimeType:'text/csv',buffer:Buffer.from('Отдел;Сумма\nПродажи;0,1\nПродажи;0,02\nДоставка;5'),
 });
 await profile.getByRole('button',{name:'Проанализировать'}).click();
 await profile.getByLabel('Группировать по').selectOption({label:'Отдел'});
 await profile.getByLabel('Суммировать').selectOption({label:'Сумма'});
 const pivot=profile.getByRole('table',{name:'Сводная таблица'});
 assert.match(await pivot.getByRole('row',{name:/Продажи/}).textContent(),/0,12/u);
 assert.equal(await profile.getByRole('meter',{name:'Продажи'}).getAttribute('value'),'2');
 await profile.screenshot({path:'test-artifacts/focus-f5-pivot-mobile.png'});
 await page.goto(url+'/examples.html');
 await page.locator('[data-example=tables]').click();
 await page.locator('#example-copy').click();
 await page.waitForURL('**/login?example=tables');
 await page.getByRole('button',{name:'Регистрация',exact:true}).click();
 await page.getByLabel('Электронная почта').fill('sample@example.com');
 await page.getByRole('button',{name:'Получить код'}).click();
 await page.getByLabel('Код из письма').fill(code);
 await page.getByRole('button',{name:'Подтвердить почту'}).click();
 await page.getByRole('button',{name:'Создать аккаунт'}).click();
 const dialog=page.getByRole('dialog',{name:'Скопировать пример в Focus?'});
 await dialog.screenshot({path:'test-artifacts/focus-r2-copy-mobile.png'});
 await dialog.getByRole('button',{name:'Скопировать',exact:true}).click();
 await dialog.waitFor({state:'hidden'});
 await page.reload();
 await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();
 const quota=page.getByRole('button',{name:'Лимит на 5 часов. Осталось 100%'});
 await quota.waitFor();
 assert.equal(await quota.locator('meter').getAttribute('value'),'100');
 const bounds=await quota.boundingBox();
 assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'quota fits the phone viewport');
 await quota.click();
 const quotaDialog=page.getByRole('dialog',{name:'Лимит на 5 часов'});
 assert.match(await quotaDialog.textContent(),/Осталось 100%/u);
 await quotaDialog.getByRole('button',{name:'Закрыть'}).click();
 await page.route('**/api/status',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
 await page.reload();
 await page.getByRole('button',{name:'Лимит на 5 часов. Данные недоступны'}).click();
 await page.unroute('**/api/status');
 await quotaDialog.getByRole('button',{name:'Обновить'}).click();
 await quota.waitFor();
 assert.match(await quotaDialog.textContent(),/Осталось 100%/u);
 await quotaDialog.getByRole('button',{name:'Закрыть'}).click();
 const saved=await page.evaluate(async()=>{
  const {selectStorageScope,readState,getBlob}=await import('/store.js');
  const session=await (await fetch('/api/auth/session')).json();
  selectStorageScope(session.user.id);
  const state=await readState();
  const project=state.projects.find(item=>item.id===state.activeProject);
  const files=state.files.filter(file=>file.project===project.id);
  const csv=files.find(file=>file.name==='Исходная выгрузка.csv');
  return {name:project.name,count:files.length,csv:await (await getBlob(csv.id)).text()};
 });
 assert.deepEqual([saved.name,saved.count],['Пример · сверка выгрузок',3]);
 assert.match(saved.csv,/101;1200/u);
 console.log('Mobile grouped table analysis and authenticated example copy passed');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
