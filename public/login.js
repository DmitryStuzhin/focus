function workspaceURL(){
 const example=new URLSearchParams(location.search).get('example');
 return ['tables','document','calculate'].includes(example)?'/?example='+encodeURIComponent(example):'/';
}
import {AUTH_EVENT_KEY,uid} from './store.js';
import {goals,roles} from './onboarding.js';

const emailForm = document.querySelector('#email-form');
const codeForm = document.querySelector('#code-form');
const profileForm = document.querySelector('#profile-form');
const modes = document.querySelector('.auth-modes');
const modeButtons = [...modes.querySelectorAll('[data-mode]')];
const emailInput = document.querySelector('#email');
const codeInput = document.querySelector('#code');
const title = document.querySelector('#login-title');
const intro = document.querySelector('#card-intro');
const step = document.querySelector('#step');
const feedback = document.querySelector('#feedback');
const resend = document.querySelector('#resend');
const changeEmail = document.querySelector('#change-email');
const verifyLabel = document.querySelector('#verify-label');
const forms = [emailForm,codeForm,profileForm];
let mode='login', email='', challenge='', registrationToken='', resendAt=0, timer, pending=false;

for(const [value,label] of Object.entries(roles))profileForm.elements.role.add(new Option(label,value));
for(const [value,label] of Object.entries(goals)){
 const option=document.createElement('label');
 const checkbox=document.createElement('input');
 Object.assign(checkbox,{type:'checkbox',name:'goals',value});
 option.append(checkbox,label);
 document.querySelector('#goal-options').append(option);
}

function screen(stage){
 const registering=mode==='register';
 const screens=[
  [registering?'Регистрация в Focus':'Вход в Focus',registering
   ?'Укажите почту, чтобы подтвердить её кодом из письма.'
   :'Укажите почту. Мы отправим код для входа.'],
  ['Проверьте почту','Введите шестизначный код из письма, отправленного на '+email+'.'],
  ['Расскажите о себе','Укажите, для каких задач вы планируете использовать Focus.'],
 ];
 [title.textContent,intro.textContent]=screens[stage];
 step.textContent='Шаг '+(stage+1)+' из '+(registering?3:2);
 step.hidden=false;
 verifyLabel.textContent=registering?'Подтвердить почту':'Войти в Focus';
 for(const [index,form] of forms.entries())form.hidden=index!==stage;
 for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
}

function startEmail(nextMode=mode,focus=true){
 mode=nextMode;
 challenge='';
 registrationToken='';
 clearInterval(timer);
 resendAt=0;
 notice();
 screen(0);
 if(focus)emailInput.focus();
}

function enterWorkspace(){
 try{localStorage.setItem(AUTH_EVENT_KEY,uid());}catch{}
 location.replace(workspaceURL());
}

function notice(message=''){
 feedback.textContent=message;
 feedback.hidden=!message;
}
function showRequestError(err,fallback){
 const message=err.message||fallback;
 const wait=err.retry>=60?Math.ceil(err.retry/60)+' мин.':err.retry+' с.';
 notice(err.retry>0?message+' До следующей попытки: '+wait:message);
}
function updateResend(){
 const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
 resend.disabled=pending||seconds>0;
 resend.textContent=seconds?'Новый код через '+seconds+' с':'Получить новый код';
 if(!seconds)clearInterval(timer);
}
function busy(on){
 pending=on;
 for(const field of profileForm.elements)field.disabled=on;
 emailInput.readOnly=codeInput.readOnly=on;
 for(const form of [emailForm,codeForm])form.querySelector('[type=submit]').disabled=on;
 for(const button of modeButtons)button.disabled=on;
 changeEmail.disabled=on;
 updateResend();
}
async function request(path,data){
 const response=await fetch('/api/auth/'+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),
 });
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result){
  const err=new Error(result?.error||'Что-то пошло не так. Попробуйте ещё раз.');
  err.retry=Number(response.headers.get('retry-after'))||0;
  err.code=result?.code;
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
  const result=await request('request',{email:target,intent:mode});
  email=target;
  emailInput.value=target;
  challenge=result.challenge;
  codeInput.value='';
  screen(1);
  countdown(result.resendAfter);
  codeInput.focus();
 }catch(err){
  if(err.retry&&!codeForm.hidden)countdown(err.retry);
  showRequestError(err,'Не удалось отправить код.');
 }finally{busy(false);}
}
emailForm.addEventListener('submit',event=>{
 event.preventDefault();
 void sendCode(emailInput.value.trim());
});
resend.addEventListener('click',()=>void sendCode(email));
changeEmail.addEventListener('click',()=>startEmail());
for(const button of modeButtons)button.addEventListener('click',()=>{
 if(mode!==button.dataset.mode){
  profileForm.reset();
  startEmail(button.dataset.mode);
 }
});
codeInput.addEventListener('input',()=>{codeInput.value=codeInput.value.replace(/\D/gu,'').slice(0,6);});
codeForm.addEventListener('submit',async event=>{
 event.preventDefault();
 if(pending||!challenge)return;
 notice();
 busy(true);
 try{
  const result=await request('verify',{challenge,code:codeInput.value});
  if(result.user){enterWorkspace();return;}
  registrationToken=result.registrationToken;
  challenge='';
  clearInterval(timer);
  screen(2);
 }catch(err){
  if(err.code==='registration_required')startEmail('register',false);
  if(err.code==='account_exists')startEmail('login',false);
  showRequestError(err,'Не удалось проверить код.');
 }finally{
  busy(false);
  if(!profileForm.hidden)profileForm.elements.role.focus();
  else if(!codeForm.hidden)codeInput.focus();
  else emailInput.focus();
 }
});
profileForm.addEventListener('submit',async event=>{
 event.preventDefault();
 if(pending||!registrationToken)return;
 const fields=new FormData(profileForm);
 const selected=fields.getAll('goals');
 notice();
 busy(true);
 try{
  const {user,starterTemplate}=await request('register',{registrationToken,role:fields.get('role'),goals:selected});
  if(starterTemplate)try{sessionStorage.setItem('focus.starter.'+user.id,starterTemplate);}catch{}
  enterWorkspace();
 }catch(err){
  if(err.code==='registration_expired')startEmail(mode,false);
  if(err.code==='account_exists')startEmail('login',false);
  showRequestError(err,'Не удалось создать аккаунт.');
 }finally{
  busy(false);
  if(!emailForm.hidden)emailInput.focus();
 }
});
async function start(){
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});
  const session=response.status===404?{enabled:false}:await response.json();
  if(!response.ok&&response.status!==404)throw new Error();
  if(session.user){location.replace(workspaceURL());return;}
  if(session.enabled){
   modes.hidden=false;
   startEmail(location.hash==='#register'?'register':'login',false);
   return;
  }
  title.textContent='Открыть Focus';
  intro.textContent='Вход по почте пока недоступен. Можно открыть рабочее пространство.';
  step.hidden=true;
  document.querySelector('#guest').hidden=false;
 }catch{
  intro.textContent='Не удалось подключиться к Focus. Проверьте соединение и обновите страницу.';
 }
}
window.addEventListener('storage',event=>{if(event.key===AUTH_EVENT_KEY)location.reload();});
void start();
