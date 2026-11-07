const byId=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'});
const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
const num=new Intl.NumberFormat('ru-RU');
const stamp=value=>value==null?'—':time.format(value);
const dayLabel=day=>date.format(day*86_400_000);
const view={tab:'overview',days:30,page:1,query:'',userId:'',userLabel:'',requestId:0};
const stats=[['registrations','Регистрации','#d6ebac'],['logins','Входы','#91c9e8']];
const requests=[['chat','Чат','#c6e1a5'],['site','Сайты','#91c9e8'],['image','Изображения','#e6b17f'],['search','Поиск','#cbb0f0']];
let selectedGrant=null;

async function api(path,body){
 const response=await fetch('/api/admin/'+path,body===undefined?{cache:'no-store'}:{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 });
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(new Error(result?.error||'Не удалось выполнить запрос.'),{status:response.status});
 return result;
}
function showLogin(enabled,message=''){
 view.requestId++;
 byId('loading').hidden=true;
 byId('dashboard').hidden=true;
 byId('panel').replaceChildren();
 byId('identity').hidden=true;
 byId('sign-in').hidden=false;
 byId('setup-note').hidden=enabled;
 byId('login-form').hidden=!enabled;
 const output=byId('login-error');
 output.textContent=message;output.hidden=!message;
}
function showDashboard(login){
 byId('loading').hidden=true;
 byId('sign-in').hidden=true;
 byId('identity').hidden=false;
 byId('admin-name').textContent=login;
 byId('dashboard').hidden=false;
 void loadPanel();
}
function notice(message='',error=false){
 const node=byId('dashboard-message');
 node.textContent=message;node.hidden=!message;node.classList.toggle('error',error);
}
function chart(title,series,metrics,trackingDay){
 const visible=(point,key)=>key==='registrations'||point.day>=trackingDay;
 const ceiling=Math.max(1,...series.flatMap(point=>metrics.map(([key])=>point[key])));
 const left=36,right=586,top=12,bottom=145;
 const x=i=>left+(right-left)*i/Math.max(1,series.length-1);
 const y=value=>bottom-(bottom-top)*value/ceiling;
 const ticks=[...new Set([0,Math.round(ceiling/2),ceiling])];
 const labels=[...new Set([0,Math.floor((series.length-1)/2),series.length-1])];
 return `<article class="box"><h2>${title}</h2><svg class="chart" viewBox="0 0 600 175" role="img" aria-label="${title}">
  ${ticks.map(tick=>`<line class="gridline" x1="${left}" y1="${y(tick)}" x2="${right}" y2="${y(tick)}"></line><text x="4" y="${y(tick)+4}">${num.format(tick)}</text>`).join('')}
  ${metrics.map(([key,label,color])=>`<polyline stroke="${color}" points="${series.flatMap((point,i)=>visible(point,key)?[x(i)+','+y(point[key])]:[]).join(' ')}"></polyline>${series.map((point,i)=>visible(point,key)&&point[key]>0?`<circle cx="${x(i)}" cy="${y(point[key])}" r="3" fill="${color}"><title>${dayLabel(point.day)} · ${label} · ${point[key]}</title></circle>`:'').join('')}`).join('')}
  ${labels.map(i=>`<text x="${x(i)}" y="165" text-anchor="${i===0?'start':i===series.length-1?'end':'middle'}">${dayLabel(series[i].day)}</text>`).join('')}
 </svg><div class="legend">${metrics.map(([key,label,color])=>`<span><b style="color:${color}">●</b>${label} · ${num.format(series.reduce((total,point)=>total+point[key],0))}</span>`).join('')}</div></article>`;
}
function overview(data){
 const trackingDay=Math.floor((data.trackingSince+3*3_600_000)/86_400_000);
 const fields=[['users','Аккаунты'],['activeToday','Активны сегодня'],['activeSessions','Действующие сессии'],['subscribed','С подпиской'],['blocked','Заблокированы']];
 return `<div class="panel-head"><h2>Обзор</h2><div class="range" aria-label="Период">${[7,30,90].map(days=>`<button type="button" data-days="${days}" aria-pressed="${view.days===days}">${days} дней</button>`).join('')}</div></div>
 <dl class="kpis">${fields.map(([key,label])=>`<div class="kpi"><dt>${label}</dt><dd>${num.format(data.totals[key])}</dd></div>`).join('')}</dl>
 <div class="charts">${chart('Регистрации и входы',data.series,stats,trackingDay)}${chart('Успешные запросы',data.series,requests,trackingDay)}</div>
 <p class="tracking">Часовой пояс Москва. Учёт входов и запросов с ${stamp(data.trackingSince)}. Данные за последние 90 дней.</p>
 <details class="box"><summary>Статистика по дням</summary><div class="table-wrap"><table><thead><tr><th scope="col">Дата</th>${[...stats,...requests].map(([,label])=>`<th scope="col">${label}</th>`).join('')}<th scope="col">Ошибки запросов</th></tr></thead><tbody>
 ${data.series.slice().reverse().map(point=>`<tr><td>${dayLabel(point.day)}</td>${[...stats,...requests].map(([key])=>`<td>${key==='registrations'||point.day>=trackingDay?num.format(point[key]):'—'}</td>`).join('')}<td>${point.day>=trackingDay?num.format(point.errors):'—'}</td></tr>`).join('')}
 </tbody></table></div></details>`;
}
function pagination(data){
 const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
 return `<div class="pagination"><span>Страница ${data.page} из ${pages} · Всего ${num.format(data.total)}</span><button type="button" data-page="${data.page-1}" ${data.page<=1?'disabled':''}>Назад</button><button type="button" data-page="${data.page+1}" ${data.page>=pages?'disabled':''}>Далее</button></div>`;
}
const action=(name,id,label)=>`<button type="button" data-action="${name}" data-id="${esc(id)}">${label}</button>`;
function users(data){
 return `<section class="box"><div class="panel-head"><h2>Пользователи</h2><form class="filters" id="search-users"><input type="search" name="query" aria-label="Имя или email" placeholder="Имя или email" value="${esc(view.query)}" maxlength="120"><button type="submit">Найти</button></form></div>
 <div class="table-wrap"><table><thead><tr><th scope="col">Аккаунт</th><th scope="col">Подписка</th><th scope="col">Активность</th><th scope="col">Действия</th></tr></thead><tbody>
 ${data.items.map(user=>`<tr><td><strong>${esc(user.name||'Имя не указано')}</strong><small>${esc(user.email)}</small><small>Создан ${stamp(user.created)}</small></td>
  <td><span class="badge ${user.subscriptionUntil?'active':''}">${user.subscriptionUntil?'До '+stamp(user.subscriptionUntil):'Базовый'}</span></td>
  <td><span class="badge ${user.blocked?'blocked':'active'}">${user.blocked?'Заблокирован':user.activeSessions+' активных сессий'}</span><small>Последняя активность ${stamp(user.lastSeen)}</small></td>
  <td><div class="actions"><button type="button" data-action="user-sessions" data-id="${esc(user.id)}" data-label="${esc(user.name||user.email)}">Сессии</button>
   <button type="button" data-action="open-grant" data-id="${esc(user.id)}" data-label="${esc(user.name||user.email)}">${user.subscriptionUntil?'Продлить':'Выдать подписку'}</button>
   ${user.subscriptionUntil?action('revoke',user.id,'Отозвать'):''}${action(user.blocked?'unblock':'block',user.id,user.blocked?'Разблокировать':'Блокировать')}</div></td></tr>`).join('')}
 </tbody></table></div>${data.items.length?'':'<p class="empty">Ничего не найдено.</p>'}${pagination(data)}</section>`;
}
function sessions(data){
 return `<section class="box"><div class="panel-head"><div><h2>Сессии</h2>${view.userId?`<p class="tracking">${esc(view.userLabel)}</p>`:''}</div><div class="actions">
 ${view.userId?`${action('end-user-sessions',view.userId,'Завершить все сессии')}<button type="button" data-action="all-sessions">Все пользователи</button>`:''}</div></div>
 <div class="table-wrap"><table><thead><tr><th scope="col">Аккаунт</th><th scope="col">Устройство</th><th scope="col">Вход</th><th scope="col">Активность</th><th scope="col">Срок</th><th scope="col">Статус</th><th scope="col">Действие</th></tr></thead><tbody>
 ${data.items.map(session=>`<tr><td><strong>${esc(session.name||session.email)}</strong>${session.name?`<small>${esc(session.email)}</small>`:''}</td>
 <td>${esc(session.device||'Не определено')}</td><td>${stamp(session.started)}</td><td>${stamp(session.lastSeen)}</td><td>${stamp(session.expires)}</td>
 <td><span class="badge ${session.ended==null?'active':''}">${session.ended==null?'Действует':'Завершена'}</span>${session.ended==null?'':`<small>${stamp(session.ended)}</small>`}</td>
 <td>${session.ended==null?action('end-session',session.id,'Завершить'):'—'}</td></tr>`).join('')}</tbody></table></div>
 ${data.items.length?'':'<p class="empty">Сессий пока нет.</p>'}${pagination(data)}</section>`;
}
async function loadPanel(){
 const id=++view.requestId;
 const tab=view.tab;
 document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.tab===tab)));
 const params=tab==='overview'?{days:view.days}:tab==='users'?{page:view.page,q:view.query}:{page:view.page,userId:view.userId};
 try{
  const data=await api(tab+'?'+new URLSearchParams(params));
  if(id!==view.requestId)return;
  byId('panel').innerHTML={overview,users,sessions}[tab](data);
 }catch(error){
  if(id!==view.requestId)return;
  if(error.status===401){showLogin(true,'Сессия администратора завершилась. Войдите снова.');return;}
  notice(error.message,true);
 }
}
async function manage(body,button){
 button.disabled=true;
 try{
  await api('manage',body);
  if(byId('grant-dialog').open)byId('grant-dialog').close();
  notice('Изменение сохранено.');
  await loadPanel();
 }catch(error){
  if(error.status===401){byId('grant-dialog').close();showLogin(true,error.message);}
  else if(byId('grant-dialog').open)byId('grant-account').textContent=error.message;
  else notice(error.message,true);
 }finally{button.disabled=false;}
}
byId('login-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,submit=form.querySelector('[type=submit]');
 submit.disabled=true;
 try{
  const {login}=await api('login',Object.fromEntries(new FormData(form)));
  form.reset();showDashboard(login);
 }catch(error){form.elements.password.value='';showLogin(true,error.message);}
 finally{submit.disabled=false;}
});
byId('sign-out').addEventListener('click',async()=>{
 try{await api('logout',{});showLogin(true);}
 catch(error){if(error.status===401)showLogin(true);else notice(error.message,true);}
});
byId('refresh').addEventListener('click',()=>{notice();void loadPanel();});
document.querySelector('.tabs').addEventListener('click',event=>{
 const button=event.target.closest('[data-tab]');
 if(!button)return;
 Object.assign(view,{tab:button.dataset.tab,page:1,userId:'',userLabel:''});
 notice();void loadPanel();
});
byId('panel').addEventListener('submit',event=>{
 if(event.target.id!=='search-users')return;
 event.preventDefault();
 view.query=String(new FormData(event.target).get('query')||'');view.page=1;
 notice();void loadPanel();
});
byId('panel').addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button)return;
 if(button.dataset.days){view.days=Number(button.dataset.days);void loadPanel();return;}
 if(button.dataset.page){view.page=Number(button.dataset.page);void loadPanel();return;}
 const {action,id,label}=button.dataset;
 if(action==='user-sessions'||action==='all-sessions'){
  Object.assign(view,{tab:'sessions',page:1,userId:id||'',userLabel:label||''});
  notice();void loadPanel();return;
 }
 if(action==='open-grant'){
  selectedGrant=id;
  byId('grant-account').textContent=label;
  byId('grant-form').reset();
  byId('grant-dialog').showModal();
  return;
 }
 const questions={
  'end-session':'Завершить эту сессию?',
  'end-user-sessions':'Завершить все сессии этого пользователя?',
  block:'Заблокировать аккаунт и завершить все его сессии?',
  unblock:'Разблокировать аккаунт?',
  revoke:'Отозвать доступ по подписке?',
 };
 if(questions[action]&&confirm(questions[action]))void manage({action,id},button);
});
byId('grant-cancel').addEventListener('click',()=>byId('grant-dialog').close());
byId('grant-form').addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.currentTarget;
 void manage({action:'grant',id:selectedGrant,days:Number(new FormData(form).get('days'))},form.querySelector('[type=submit]'));
});
api('session').then(session=>{
 if(session.authenticated)showDashboard(session.login);
 else showLogin(session.enabled);
}).catch(error=>showLogin(false,error.message));
