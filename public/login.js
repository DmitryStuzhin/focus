import {AUTH_EVENT_KEY,uid} from './store.js';

const emailForm = document.querySelector('#email-form');
const codeForm = document.querySelector('#code-form');
const emailInput = document.querySelector('#email');
const codeInput = document.querySelector('#code');
const title = document.querySelector('#login-title');
const intro = document.querySelector('#card-intro');
const step = document.querySelector('#step');
const feedback = document.querySelector('#feedback');
const resend = document.querySelector('#resend');
const changeEmail = document.querySelector('#change-email');
let email = '', challenge = '', resendAt = 0, timer, pending = false;

function notice(message=''){
 feedback.textContent=message;
 feedback.hidden=!message;
}
function updateResend(){
 const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
 resend.disabled=pending||seconds>0;
 resend.textContent=seconds?'Новый код через '+seconds+' с':'Получить новый код';
 if(!seconds)clearInterval(timer);
}
function busy(on){
 pending=on;
 emailInput.readOnly=on;
 codeInput.readOnly=on;
 emailForm.querySelector('[type=submit]').disabled=on;
 codeForm.querySelector('[type=submit]').disabled=on;
 changeEmail.disabled=on;
 updateResend();
}
async function request(path,data){
 const response=await fetch('/api/auth/'+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),
 });
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result){
  const err=new Error(result?.error||'Что-то пошло не так. Попробуй ещё раз.');
  err.retry=Number(response.headers.get('retry-after'))||0;
  throw err;
 }
 return result;
}
function countdown(seconds){
 clearInterval(timer);
 resendAt=Date.now()+seconds*1000;
 updateResend();
 timer=setInterval(updateResend,1000);
}
async function sendCode(target){
 if(pending)return;
 notice();
 busy(true);
 try{
  const result=await request('request',{email:target});
  email=target;
  challenge=result.challenge;
  codeInput.value='';
  title.textContent='Проверь почту';
  intro.textContent='Введи шестизначный код из письма, отправленного на '+email+'.';
  step.textContent='ШАГ 2 / 2';
  emailForm.hidden=true;
  codeForm.hidden=false;
  countdown(result.resendAfter);
  codeInput.focus();
 }catch(err){
  if(err.retry&&!codeForm.hidden)countdown(err.retry);
  notice(err.message||'Не удалось отправить код.');
 }finally{busy(false);}
}
emailForm.addEventListener('submit',event=>{
 event.preventDefault();
 void sendCode(emailInput.value.trim());
});
resend.addEventListener('click',()=>void sendCode(email));
changeEmail.addEventListener('click',()=>{
 notice();
 challenge='';
 codeForm.hidden=true;
 emailForm.hidden=false;
 step.textContent='ШАГ 1 / 2';
 title.textContent='Войди в Focus';
 intro.textContent='Укажи почту. Мы отправим код для входа или регистрации.';
 emailInput.focus();
});
codeInput.addEventListener('input',()=>{codeInput.value=codeInput.value.replace(/\D/gu,'').slice(0,6);});
codeForm.addEventListener('submit',async event=>{
 event.preventDefault();
 if(pending||!challenge)return;
 notice();
 busy(true);
 try{
  await request('verify',{challenge,code:codeInput.value});
  try{localStorage.setItem(AUTH_EVENT_KEY,uid());}catch{}
  location.replace('/');
 }catch(err){
  notice(err.message||'Не удалось проверить код.');
  codeInput.focus();
 }finally{busy(false);}
});
async function start(){
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});
  const session=response.status===404?{enabled:false}:await response.json();
  if(!response.ok&&response.status!==404)throw new Error();
  if(session.user){location.replace('/');return;}
  if(session.enabled){emailForm.hidden=false;return;}
  title.textContent='Добро пожаловать';
  intro.textContent='Вход по почте пока недоступен. Можно открыть рабочее пространство.';
  step.hidden=true;
  document.querySelector('#guest').hidden=false;
 }catch{
  intro.textContent='Не удалось подключиться к Focus. Проверь соединение и обнови страницу.';
 }
}
window.addEventListener('storage',event=>{if(event.key===AUTH_EVENT_KEY)location.reload();});
void start();
