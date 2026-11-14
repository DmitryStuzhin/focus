import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from '../scripts/server.mjs';
import {fresh,STORAGE_KEY} from '../public/store.js';

let delivered,now=Date.now();
const server=createServer({
 FOCUS_AUTH_ENABLED:'1',FOCUS_AUTH_SECRET:'fixture-secret-for-browser-tests',
 FOCUS_AUTH_DB:':memory:',FOCUS_SMTP_USER:'auth@example.com',FOCUS_SMTP_PASSWORD:'fixture',
 FOCUS_ADMIN_EMAIL:'owner@example.com',FOCUS_ADMIN_ALLOWED_IPS:'127.0.0.1',
},undefined,{clock:()=>now,mailer:async mail=>{delivered=mail;}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const artifacts=new URL('../test-artifacts/',import.meta.url);
await mkdir(artifacts,{recursive:true});
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.goto(url);
 assert.equal(new URL(page.url()).pathname,'/login');
 await page.getByRole('heading',{name:'Вход в Focus'}).waitFor();
 await page.getByLabel('Электронная почта').waitFor();
 await page.getByRole('heading',{name:/Место для работы/}).waitFor();
 await page.screenshot({path:new URL('focus-login-desktop.png',artifacts).pathname,fullPage:true});
 const verify=async(email,register=false)=>{
  if(register)await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByRole('button',{name:'Получить код'}).click();
  await page.getByRole('heading',{name:'Проверьте почту'}).waitFor();
  assert.equal(delivered.to,email);
  const otp=page.getByLabel('Код из письма');
  await otp.fill(delivered.code==='000000'?'000001':'000000');
  const submit=page.getByRole('button',{name:register?'Подтвердить почту':'Войти в Focus'});
  await submit.click();
  await page.getByText('Код не совпал. Проверьте письмо.').waitFor();
  await otp.fill(delivered.code);
  await submit.click();
  if(register){
   await page.getByRole('heading',{name:'Расскажите о себе'}).waitFor();
   await page.getByLabel('Чем вы занимаетесь?').selectOption('student');
   await page.getByRole('checkbox',{name:'Учёба'}).check();
   await page.getByRole('checkbox',{name:'Программирование'}).check();
   await page.getByRole('button',{name:'Создать аккаунт'}).click();
  }
  await page.getByRole('heading',{name:'Над чем поработаем?'}).waitFor();
 };
 await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state:{...fresh(),settings:{...fresh().settings,name:'Гостевой проект'}}});
 await verify('first@example.com',true);
 assert.equal(new URL(page.url()).pathname,'/');
 assert.equal(await page.getByRole('link',{name:'Админ-панель'}).count(),0);
 await page.getByRole('button',{name:/Моё пространство/}).click();
 await page.getByText('first@example.com',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Имя в аккаунте').inputValue(),'');
 await page.getByLabel('Название',{exact:true}).fill('Аккаунт номер один');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('button',{name:/Аккаунт номер один/}).click();
 await page.getByRole('button',{name:'Выйти из аккаунта'}).click();
 await page.getByLabel('Электронная почта').waitFor();
 await verify('owner@example.com',true);
 await page.getByRole('button',{name:/Моё пространство/}).click();
 await page.getByText('owner@example.com',{exact:true}).waitFor();
 assert.equal(await page.getByText('Аккаунт номер один',{exact:true}).count(),0);
 assert.equal(await page.getByText('Гостевой проект',{exact:true}).count(),0);
 await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'Админ-панель'}).click();
 await page.getByRole('heading',{name:'Focus в цифрах'}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/admin');
 await page.getByRole('link',{name:'Focus',exact:true}).click();
 await page.getByRole('button',{name:/Моё пространство/}).click();
 await page.getByRole('button',{name:'Выйти из аккаунта'}).click();
 now+=61_000;
 await verify('owner@example.com');
 assert.equal(await page.getByRole('link',{name:'Админ-панель'}).count(),1);
 await page.close();

 const phone=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await phone.goto(url);
 await phone.getByLabel('Электронная почта').waitFor();
 await phone.screenshot({path:new URL('focus-login-mobile.png',artifacts).pathname,fullPage:true});
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
 await phone.getByRole('button',{name:'Регистрация',exact:true}).click();
 await phone.getByLabel('Электронная почта').fill('mobile@example.com');
 await phone.getByRole('button',{name:'Получить код'}).click();
 await phone.getByLabel('Код из письма').fill(delivered.code);
 await phone.getByRole('button',{name:'Подтвердить почту'}).click();
 await phone.getByRole('heading',{name:'Расскажите о себе'}).waitFor();
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
 await phone.screenshot({path:new URL('focus-registration-mobile.png',artifacts).pathname,fullPage:true});
 await phone.close();
 console.log('Registration, email login, account isolation, admin access and mobile layout passed');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
