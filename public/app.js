import {eventStream} from './event-stream.js';
import {workspaceAPI,snapshotWorkspace,decodeWorkspace} from './workspace-features.js';
import {openTable,createWorkbook,createDocument,createSlides,officeFilename,officeText} from './office.js';
import {compareTables} from './tabular.js';
import {projectFiles,projectZip} from './project-bundle.js';
import {resolveAction,SPLIT_ACTIONS} from './action-phrases.js';
import {projectSearchQuery,projectPath,searchProjectFiles,readMatchContext} from './project-search.js';
import {codeFollowUpIntent,localIntent,taskIntent} from './work-intent.js';
import {isPreviewBlock,isSiteRevision,buildIntent,nativeBuildIntent,updatesBuild} from './site-preview.js';
import {compareText} from './text-diff.js';
import {imageIntent,latestImage,imageReference} from './image-intent.js';
import {buildChatContext,searchQuery,MAX_QUOTE_LENGTH} from './chat-context.js';
import {bindQuoteSelection} from './quote-selection.js';
import {sourcePills,sourcesDialog,linkCitations} from './search-ui.js';
import {inlineMarkdown,answerTable,answerChart,prefersJsonCode} from './answer-format.js';
import {STUDIO_LABELS,SITE_STARTERS,IMAGE_STARTERS,TOOL_STARTERS,CODE_STARTERS,FORGE_STARTERS,renderSites,renderImages,renderSkills,renderFocusCode,renderFocusForge} from './studios.js';
import {icon,mark} from './icons.js';
import {uid,readState,writeState,fresh,putBlob,getBlob,deleteBlob,replaceWorkspace,validBackup,selectStorageScope,AUTH_EVENT_KEY} from './store.js';
import {forgeIntent,forgeReport,namedCodeFiles} from './forge.js';
const app=document.querySelector('#app');
const MODEL_LABEL='Focus';
const IMAGE_COST_NOTICE='После отправки провайдер может завершить генерацию и списать стоимость, даже если остановить ожидание.';
let state=fresh(), account=null, ready=false;
let cloudRevision=null, cloudAuto=false, cloudSaving=false, cloudTimer, localRevision=0;
let pendingResearch=null;
const imagePassKey=()=>account?"focus-image-pass."+account.id:"focus-image-pass";
const savedImagePass=()=>isSecureContext?sessionStorage.getItem(imagePassKey()):null;
const hasImageAccess=()=>account?account.subscriptionUntil>Date.now()||!!savedImagePass():!!savedImagePass();
let ui={view:'chat',archive:false,filesTab:'files',folder:null,collapsed:new Set(),sidebarClosed:false,mobileNav:false,mobileFiles:false,draft:'',quote:null,attachments:[],menu:null,sort:'name'};
const studio={siteBrief:'',codeBrief:'',forgeBrief:'',image:{brief:'',mode:'free',ratio:'1:1',style:'',reference:null,favorites:false},imageError:'',imageController:null};
const studioRoute=()=>{const view=location.hash.slice(1);return Object.hasOwn(STUDIO_LABELS,view)?view:null};
let toastTimer,uploadAttach=false,objectURLs=[],modalOpener=null,generation=null,apiStatus={configured:false,model:'',label:MODEL_LABEL};
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById(id);
const activeProject=()=>state.projects.find(p=>p.id===state.activeProject&&!p.deleted)||state.projects.find(p=>!p.deleted);
const activeChat=()=>state.chats.find(c=>c.id===state.activeChat&&!c.deleted);
const hideSelectionAction=bindQuoteSelection(el('selection-action'), excerpt=>{
 const chat=activeChat();
 if(!chat||ui.view!=='chat')return;
 const text=excerpt.length>MAX_QUOTE_LENGTH?excerpt.slice(0,MAX_QUOTE_LENGTH-1).trimEnd()+'…':excerpt;
 ui.quote={chatId:chat.id,text};
 updateComposerQuote();
});
const projectName=id=>state.projects.find(p=>p.id===id)?.name||'Без проекта';
const liveProjects=()=>state.projects.filter(p=>!p.deleted);
const plural=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
const humanSize=n=>n<1024?`${n} Б`:n<1048576?`${(n/1024).toFixed(0)} КБ`:`${(n/1048576).toFixed(1)} МБ`;
const time=t=>new Date(t).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
const date=t=>new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const fileIcon=f=>f.kind==='folder'?'folder':f.type?.startsWith('image/')?'image':/\.(pptx?|odp)$/i.test(f.name)?'slides':/\.(xlsx?|csv)$/i.test(f.name)?'table':'file';
const ib=(action,name,label,extra='')=>{const cls=extra.match(/class="([^"]*)"/)?.[1]||'';extra=extra.replace(/class="[^"]*"/,'');return `<button type="button" class="icon-btn ${cls}" data-action="${action}" title="${e(label)}" aria-label="${e(label)}" ${extra}>${icon(name)}</button>`};
const button=(action,text,type='',extra='')=>`<button ${extra.includes('type=')?'':'type="button"'} class="btn ${type}" data-action="${action}" ${extra}>${text}</button>`;
const visibleFiles=()=>state.files.filter(f=>f.project===activeProject()?.id&&!f.deleted);
async function persist(){
 localRevision++;
 try{
  await writeState(state);
  scheduleCloudSave();
  return true;
 }catch(error){
  toast(error?.name==='QuotaExceededError'
   ?'Хранилище браузера заполнено. Скачай резервную копию перед выходом.'
   :'Не удалось сохранить изменения в браузере. Скачай резервную копию перед выходом.');
  return false;
 }
}
function log(text,project=activeProject()?.id){state.changes.unshift({id:uid(),text,project,at:Date.now()});state.changes=state.changes.slice(0,400)}
const forgeFileType=name=>/\.html?$/iu.test(name)?'text/html':/\.css$/iu.test(name)?'text/css':/\.(?:js|mjs|cjs)$/iu.test(name)?'text/javascript':/\.json$/iu.test(name)?'application/json':'text/plain';
async function saveForgeCheckpoint(chat,content){
 const files=namedCodeFiles(content);
 if(!files.length||files.length>50||files.reduce((sum,file)=>sum+file.content.length,0)>3000000)return null;
 const now=Date.now();
 const folder=(name,parent)=>state.files.find(file=>file.project===chat.project&&!file.deleted&&file.kind==='folder'&&(file.parent||null)===(parent||null)&&file.name===name);
 const addFolder=(name,parent)=>{const existing=folder(name,parent);if(existing)return existing;const entry={id:uid(),project:chat.project,parent:parent||null,name,kind:'folder',type:'',size:0,created:now,updated:now,deleted:false,forgeManaged:true};state.files.push(entry);return entry};
 const legacyRoot=folder('Guzan Forge',null);
 if(legacyRoot)legacyRoot.name='Focus Forge';
 const root=legacyRoot||addFolder('Focus Forge',null);
 const stamp=new Date(now).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',', '').replace(':','-');
 let checkpointName='Версия '+stamp,index=2;
 while(folder(checkpointName,root.id))checkpointName='Версия '+stamp+' ('+(index++)+')';
 const checkpoint=addFolder(checkpointName,root.id);
 for(const source of files){
  const parts=source.name.split('/');let parent=checkpoint.id;
  for(const name of parts.slice(0,-1))parent=addFolder(name,parent).id;
  const id=uid(),type=forgeFileType(source.name),blob=new Blob([source.content],{type:type+';charset=utf-8'});
  await putBlob(id,blob);
  state.files.push({id,project:chat.project,parent,name:parts.at(-1),kind:'file',type,size:blob.size,created:now,updated:now,deleted:false,forgeManaged:true,sourcePath:source.name});
 }
 log(`Focus Forge сохранил контрольную точку «${checkpointName}» (${files.length} ${plural(files.length,'файл','файла','файлов')})`,chat.project);
 return {id:checkpoint.id,count:files.length,name:checkpointName};
}
function forgeCard(report,message){if(!report)return '';const ready=report.status==='ready';return `<section class="forge-report ${ready?'ready':'needs-work'}" aria-label="Проверка Focus Forge"><div class="forge-report-head"><div><strong>Focus Forge</strong><span>${ready?'Результат подготовлен':'Нужна доработка'}</span></div><span class="forge-status">${ready?'Проверено':'Есть замечания'}</span></div><div class="forge-checks">${report.checks.map(item=>`<div class="forge-check ${item.status}"><span aria-hidden="true">${item.status==='pass'?'✓':item.status==='warn'?'!':'×'}</span><div><strong>${e(item.label)}</strong><small>${e(item.detail)}</small></div></div>`).join('')}</div>${report.checkpoint?`<button class="btn ghost forge-open" data-action="open-forge-checkpoint" data-id="${e(report.checkpoint.id)}">Открыть контрольную точку</button>`:report.files.length&&!message.truncated?`<button class="btn ghost" data-action="save-forge-checkpoint" data-id="${e(message.id)}">Сохранить в проект</button>`:''}<small class="forge-limitation">${e(report.limitation)}</small></section>`}
function toast(text){clearTimeout(toastTimer);const t=el('toast');t.textContent=text;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),4200)}
let generatedURLs=[];
function render(){
 hideSelectionAction();
 if(!Object.hasOwn(STUDIO_LABELS,ui.view)&&studioRoute())history.replaceState(null,'',location.pathname+location.search);
 if(ui.quote&&ui.quote.chatId!==activeChat()?.id)ui.quote=null;
 generatedURLs.forEach(url=>URL.revokeObjectURL(url));generatedURLs=[];
 applyTheme();
 const p=activeProject();if(p)state.activeProject=p.id;
 const artifact=ui.view==='chat'?previewArtifact(activeChat()):null;
 const showFiles=!artifact&&state.settings.showFiles&&ui.view==='chat';
 app.innerHTML=`<div class="shell ${showFiles?'':'no-files'} ${ui.sidebarClosed?'sidebar-collapsed':''} ${artifact?'has-site-preview':''}">
 ${sidebar()}<button class="sidebar-shade" aria-label="Закрыть навигацию" data-action="close-nav"></button>
 <main class="main" ${ui.mobileNav||ui.mobileFiles?'inert':''}>${header()}<div class="main-scroll" id="main-scroll">${mainView()}</div>${ui.view==='chat'?composer():''}</main>
 ${artifact?'<div class="preview-space" aria-hidden="true"></div>':ui.view==='chat'?filesPanel(showFiles):''}</div>`;
 syncPreviewPanel(artifact);
 if(ui.view==='chat'){
  const answers=activeChat()?.messages.filter(message=>message.role==='assistant')||[];
  [...app.querySelectorAll('.messages>.assistant-message')].slice(0,answers.length).forEach((node,index)=>{
   if(answers[index]?.codeMode)node.querySelector('.assistant-label span').textContent='Focus Code';
  });
 }
 for(const img of app.querySelectorAll('[data-generated-file]')){
  getBlob(img.dataset.generatedFile).then(blob=>{
   if(!blob||!img.isConnected)return;
   const url=URL.createObjectURL(blob);generatedURLs.push(url);img.src=url;
  }).catch(()=>{img.alt='Изображение недоступно на этом устройстве'});
 }
 if(ui.view==='chat')resizeComposer();
}
function sidebar(){
 const studioLinks=Object.entries(STUDIO_LABELS).filter(([view])=>!['code','forge'].includes(view)).map(([view,label])=>`<a class="nav-row studio-nav ${ui.view===view?'active':''}" href="#${view}" data-action="studio-view" data-id="${view}" ${ui.view===view?'aria-current="page"':''}>${icon({sites:'globe',images:'image',tables:'table',skills:'command'}[view])}<span>${label}</span></a>`).join('');
 const productLabel=ui.view==='code'?'Focus Code':ui.view==='forge'?'Focus Forge':'Focus';
 return `<aside class="sidebar ${ui.mobileNav?'mobile-open':''}" aria-label="Навигация" ${(innerWidth<640&&!ui.mobileNav)||(innerWidth>=640&&ui.sidebarClosed)?'inert':''}><div class="brand-row"><button class="brand focus-brand product-switcher" data-action="product-menu" aria-label="Переключить продукт Focus"><img src="/favicon.svg" alt="" width="24" height="24"><span>${productLabel}</span>${icon('down')}</button>${ib('toggle-sidebar','panel','Свернуть навигацию')}</div>
 <nav class="nav-group"><button class="nav-row new-chat" data-action="new-chat">${icon('compose')}<span>Новый диалог</span><kbd class="keycap">⌘ N</kbd></button><button class="nav-row" data-action="search">${icon('search')}<span>Поиск</span><kbd class="keycap">⌘ K</kbd></button><button class="nav-row ${ui.view==='workspace'?'active':''}" data-action="workspace">${icon('grid')}<span>Рабочее пространство</span></button></nav>
 <nav class="nav-group studio-links" aria-label="Инструменты Focus">${studioLinks}${account?.isAdmin?'<a class="nav-row studio-nav" href="/admin">'+icon('settings')+'<span>Админ-панель</span></a>':''}</nav>
 <div class="projects-heading"><span>Проекты</span>${ib('create-project','plus','Создать проект')}</div>
 <div class="sidebar-tabs" role="tablist" aria-label="Состояние диалогов"><button class="tab ${!ui.archive?'active':''}" role="tab" aria-selected="${!ui.archive}" data-action="tab-dialogs">Диалоги</button><button class="tab ${ui.archive?'active':''}" role="tab" aria-selected="${ui.archive}" data-action="tab-archive">Архив</button></div>
 <nav class="project-tree" aria-label="Проекты и диалоги">${liveProjects().map(p=>{const chats=state.chats.filter(c=>c.project===p.id&&!c.deleted&&!!c.archived===ui.archive).sort((a,b)=>b.updated-a.updated);return `<div class="project-row ${p.id===state.activeProject?'active':''}"><button class="project-link" data-action="select-project" data-id="${p.id}">${icon('chevron',`caret ${ui.collapsed.has(p.id)?'':'open'}`)}${icon('folder')}<span class="truncate">${e(p.name)}</span></button><button class="icon-btn row-more" data-action="project-menu" data-id="${p.id}" aria-label="Действия с проектом ${e(p.name)}">${icon('more')}</button></div>${ui.collapsed.has(p.id)?'':`<div class="chat-list">${chats.map(c=>`<div class="chat-row ${c.id===state.activeChat&&ui.view==='chat'?'active':''}"><button class="chat-link truncate" data-action="select-chat" data-id="${c.id}">${e(c.title)}</button><button class="icon-btn row-more" data-action="chat-menu" data-id="${c.id}" aria-label="Действия с диалогом ${e(c.title)}">${icon('more')}</button></div>`).join('')}</div>`}`}).join('')}${liveProjects().length?'':`<p class="empty-nav">Создайте проект, чтобы начать</p>`}</nav>
 <div class="sidebar-footer"><button class="nav-row ${ui.view==='trash'?'active':''}" data-action="trash">${icon('trash')}<span>Корзина</span>${trashCount()?`<span style="margin-left:auto;font-size:11px">${trashCount()}</span>`:''}</button><button class="profile" data-action="settings"><span class="avatar">${e((state.settings.name||'М')[0].toUpperCase())}</span><span class="profile-label"><strong class="truncate">${e(state.settings.name)}</strong><small>Личное пространство</small></span>${icon('settings')}</button></div></aside>`;
}
function studioSites(){
 const projects=new Set(liveProjects().map(project=>project.id));
 return state.chats.filter(chat=>!chat.deleted&&projects.has(chat.project)).flatMap(chat=>{
  const preferred=chat.messages.find(message=>message.id===chat.siteVersion);
  const message=findWebsite(preferred)&&(!preferred.previewKind||preferred.previewKind==='site')?preferred:chat.messages.findLast(message=>message.role==='assistant'&&(!message.previewKind||message.previewKind==='site')&&findWebsite(message));
  const selection=findWebsite(message);
  return selection?[{id:chat.id,title:chat.title.replace(/^\/site\s+/iu,''),project:projectName(chat.project),updated:date(chat.updated),at:chat.updated,selection}]:[];
 }).sort((a,b)=>b.at-a.at);
}

function studioImages(){
 const projects=new Set(liveProjects().map(project=>project.id));
 const prompts=new Map();
 for(const chat of state.chats){
  if(chat.deleted||!projects.has(chat.project))continue;
  let prompt='';
  for(const message of chat.messages){
   if(message.role==='user')prompt=message.content;
   if(message.imageFile)prompts.set(message.imageFile,prompt);
  }
 }
 return state.files.filter(file=>!file.deleted&&projects.has(file.project)&&file.type?.startsWith('image/')&&
  (typeof file.imagePrompt==='string'||prompts.has(file.id)))
  .sort((a,b)=>b.created-a.created)
  .map(file=>({...file,prompt:file.imagePrompt||prompts.get(file.id)}));
}

function studioCodeRuns(){
 return state.chats.filter(chat=>!chat.deleted&&state.projects.some(project=>project.id===chat.project&&!project.deleted)&&chat.messages.some(message=>message.role==='assistant'&&message.codeMode))
  .sort((a,b)=>b.updated-a.updated).slice(0,12)
  .map(chat=>({id:chat.id,title:chat.title,project:projectName(chat.project),updated:date(chat.updated)}));
}

function studioForgeCheckpoints(){
 const project=activeProject();if(!project)return [];
 const root=state.files.find(file=>file.project===project.id&&!file.deleted&&file.kind==='folder'&&!file.parent&&['Focus Forge','Guzan Forge'].includes(file.name));
 if(!root)return [];
 const folders=state.files.filter(file=>file.project===project.id&&!file.deleted&&file.kind==='folder'&&file.parent===root.id);
 return folders.sort((a,b)=>b.created-a.created).map(folder=>{
  const ids=descendants(folder.id);
  const files=state.files.filter(file=>!file.deleted&&file.kind==='file'&&ids.has(file.id)).length;
  return {id:folder.id,name:folder.name,files,updated:`${date(folder.created)}, ${time(folder.created)}`};
 });
}

function mainView(){
 const project=activeProject()?.name;
 switch(ui.view){
  case 'chat':return chatView();
  case 'workspace':return workspaceView();
  case 'code':return renderFocusCode({e,project,brief:studio.codeBrief,runs:studioCodeRuns()});
  case 'forge':return renderFocusForge({e,project,brief:studio.forgeBrief,checkpoints:studioForgeCheckpoints()});
  case 'sites':return renderSites({e,project,brief:studio.siteBrief,sites:studioSites(),busy:!!generation,canPublish:!!account});
  case 'images':{
   const files=studioImages();
   const source=files.find(file=>file.id===studio.image.reference);
   if(!source&&studio.image.reference){studio.image.reference=null;studio.image.ratio='1:1';}
   return renderImages({e,project,files,form:studio.image,source,
    access:apiStatus.images,hasPass:hasImageAccess(),subscriptionUntil:account?.subscriptionUntil,busy:!!studio.imageController,error:studio.imageError});
  }
  case 'skills':return renderSkills();
  case 'tables':return tablesView();
  default:return collectionView();
 }
}

function refreshImageStudio(){
 if(ui.view!=='images')return;
 const scroll=el('main-scroll')?.scrollTop||0;
 render();
 el('main-scroll').scrollTop=scroll;
}

function openStudioSite(id,downloadOnly=false){
 const entry=studioSites().find(site=>site.id===id);
 const chat=entry&&state.chats.find(chat=>chat.id===entry.id);
 const artifact=chat&&previewArtifact(chat,entry.selection);
 if(!artifact)return;
 if(downloadOnly){download(new Blob([artifact.code],{type:'text/html;charset=utf-8'}),artifact.filename);return;}
 selectChat(id);
 setPreview(entry.selection);
}

function startStudioSite(){
 if(generation){toast('Дождитесь ответа или остановите запрос');return;}
 const brief=studio.siteBrief.trim();
 if(!brief)return;
 newChat();
 if(ui.view!=='chat')return;
 studio.siteBrief='';
 ui.draft='/site '+brief;
 send();
}

function startStudioTask(mode){
 if(generation){toast('Дождитесь ответа или остановите запрос');return;}
 const key=mode==='forge'?'forgeBrief':'codeBrief';
 const brief=studio[key].trim();
 if(!brief)return;
 newChat();
 if(ui.view!=='chat')return;
 studio[key]='';
 ui.draft='/code '+(mode==='forge'?'Focus Forge — собери готовый проект и доведи задачу до проверяемого результата. ':'')+brief;
 send();
}

async function saveGeneratedImage(image,project,prompt){
 const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.mimeType];
 if(!extension||typeof image.data!=='string')throw new Error('Получен неподдерживаемый формат изображения.');
 const bytes=Uint8Array.from(atob(image.data),char=>char.charCodeAt(0));
 if(!bytes.length)throw new Error('Получено пустое изображение.');
 const blob=new Blob([bytes],{type:image.mimeType});
 const id=uid(),now=Date.now();
 await putBlob(id,blob);
 state.files.push({id,project,parent:null,name:'Focus-'+id.slice(0,8)+'.'+extension,kind:'file',type:blob.type,size:blob.size,
  created:now,updated:now,deleted:false,...(prompt?{imagePrompt:prompt}:{})});
 return id;
}

async function generateStudioImage(approved=false){
 if(studio.imageController)return;
 const project=activeProject();
 if(!project){projectDialog();return;}
 const {brief,mode,ratio,style,reference}=studio.image;
 const prompt=brief.trim();
 if(!prompt)return;
 const paid=mode==='paid';
 const pass=paid&&!(account?.subscriptionUntil>Date.now())?savedImagePass():null;
 if(paid&&!hasImageAccess()){imageSubscriptionDialog();return;}
 if(!approved){confirm('Запустить генерацию изображения?',IMAGE_COST_NOTICE,()=>{queueMicrotask(()=>void generateStudioImage(true));},'Запустить');return;}
 const controller=new AbortController();
 studio.imageController=controller;
 studio.imageError='';
 refreshImageStudio();
 let generated=false;
 try{
  let imageReferenceData;
  if(reference){
   const file=studioImages().find(file=>file.id===reference);
   const blob=file&&await getBlob(file.id);
   if(!blob)throw new Error('Исходное изображение недоступно. Выберите другое или уберите его.');
   imageReferenceData=await imageReference(blob);
  }
  const command=reference?'/image-edit':style==='poster'?'/design':'/image';
  const format=ratio&&(!paid||apiStatus.images?.paidFormats!==false)?' --ar '+ratio:'';
  const response=await fetch('/api/chat',{method:'POST',signal:controller.signal,
   headers:{'content-type':'application/json',...(pass?{'x-focus-image-pass':pass}:{})},
   body:JSON.stringify({messages:[{role:'user',content:command+' '+prompt+format}],...(paid?{imageMode:'paid'}:{}),
    ...(imageReferenceData?{imageReference:imageReferenceData}:{})})});
  if(response.status===401&&account){location.replace('/login');return;}
  const data=await response.json().catch(()=>null);
  if(data?.code==='image_subscription_required'&&account){
   if(pass)sessionStorage.removeItem(imagePassKey());
   await refreshAccount();
  }
  if(!response.ok||!data?.image)throw new Error(data?.error||'Сервис не вернул изображение. Попробуйте ещё раз.');
  const id=await saveGeneratedImage(data.image,project.id,prompt);
  if(reference&&studio.image.reference===reference)studio.image.reference=id;
  studio.image.favorites=false;
  persist();
  generated=true;
 }catch(error){
  studio.imageError=error.name==='AbortError'?'Ожидание остановлено.':error.message;
 }finally{
  studio.imageController=null;
  refreshImageStudio();
  if(generated&&ui.view==='images')el('studio-images-title')?.scrollIntoView({block:'start'});
 }
}

function header(){let title=STUDIO_LABELS[ui.view]||(ui.view==='workspace'?'Рабочее пространство':ui.view==='trash'?'Корзина':ui.view==='archive'?'Архив':activeProject()?.name||'Новый диалог');return `<header class="topbar"><div class="topbar-title">${ib('toggle-sidebar','menu','Открыть навигацию',ui.sidebarClosed?'':`class="mobile-only"`)}<span class="truncate">${e(title)}</span>${ui.view==='chat'&&activeChat()?`<span class="top-divider desktop-only"></span><span class="truncate desktop-only" style="color:var(--muted);font-size:12px;font-weight:400">${e(activeChat().title)}</span>`:''}</div><div class="topbar-actions">${themeButton()}${ui.view==='chat'?`<button class="status" data-action="model-info" title="Статус подключения"><span class="status-dot"></span>${apiStatus.configured?e(MODEL_LABEL):'Не подключено'}</button><span class="top-divider"></span>${activeChat()?ib('current-chat-menu','more','Действия с диалогом'):''}${ib('toggle-files','panel','Показать или скрыть файлы',`aria-pressed="${state.settings.showFiles}"`)}`:button('new-chat',`${icon('plus')} <span>Новый диалог</span>`,'ghost topbar-new-chat','aria-label="Новый диалог"')}</div></header>`}
function chatView(){const c=activeChat();if(!c||!c.messages.length)return `<section class="welcome"><div class="welcome-inner">${mark}
 <h1>Над чем поработаем?</h1><div class="suggestions focus-start" aria-label="Быстрые задачи">
  <button class="suggestion" aria-label="Создать сайт" data-action="prompt" data-prompt="Сделай сайт">${icon('globe')}<span>Создать сайт<small>Предпросмотр и исходники</small></span></button>
  <button class="suggestion" data-action="studio-view" data-id="tables">${icon('table')}<span>Сверить таблицы<small>Изменения между двумя выгрузками</small></span></button>
  <button class="suggestion" data-action="research-plan">${icon('search')}<span>Исследовать тему<small>Поиск с источниками</small></span></button>
  <button class="suggestion" data-action="studio-view" data-id="images">${icon('image')}<span>Создать изображение<small>Генерация и правки</small></span></button>
 </div><div class="version-actions focus-code-shortcut">
  <button class="inline-link" aria-label="Написать код" data-action="prompt" data-prompt="Напиши код для ">Написать код</button>
  <button class="inline-link" aria-label="Продумать план" data-action="prompt" data-prompt="Составь план для ">Продумать план</button>
 </div></div></section>`;
 let lastUserContent='';
 return `<section class="messages" aria-label="Сообщения диалога">${c.messages.map(m=>{
  if(m.role==='user')lastUserContent=m.content;
  return m.role==='assistant'?`<article class="assistant-message"><div class="assistant-label">Focus <span>${e(m.model==='local-calculator'?'Калькулятор':m.model==='local-statistics'?'Статистика':m.model==='local-conversion'?'Конвертер':m.model==='local-csv'?'Анализ CSV':m.model==='local-diff'?'Сравнение файлов':m.model==='local-project-search'?'Поиск по проекту':m.taskMode==='plan'?'План':m.taskMode==='review'?'Ревью кода':MODEL_LABEL)}</span></div>${sourcePills({...m.search,owner:m.id})}${m.search?.failedQueries?.length?`<p class="settings-note">Не удалось выполнить запросов: ${m.search.failedQueries.length}</p>`:''}<div class="markdown">${m.model==='local-project-search'?renderProjectMatches(m):m.model==='local-diff'?'<div class="code-block"><pre><code>'+e(m.content)+'</code></pre></div>':linkCitations(markdown(m.content,m,lastUserContent),m.search)}</div>${m.imageFile&&state.files.some(f=>f.id===m.imageFile&&!f.deleted)?'<figure class="generated-image"><img data-generated-file="'+e(m.imageFile)+'" alt="Сгенерированное изображение" /><button class="btn" data-action="download-file" data-id="'+e(m.imageFile)+'">Скачать изображение</button></figure>':''}<div class="assistant-actions">${ib('copy-message','copy','Скопировать ответ',`data-id="${m.id}"`)}${ib('save-answer','file','Сохранить ответ в файл',`data-id="${m.id}"`)}${ib('download-answer','download','Скачать ответ',`data-id="${m.id}"`)}${ib('office-export','file','Экспорт в Word или PowerPoint',`data-id="${m.id}"`)}${!m.truncated&&/\x60\x60\x60\w+\s+[^\s]+/u.test(m.content)?button('download-project','Скачать файлы ZIP','ghost',`data-id="${m.id}"`):''}${ib('retry-answer','refresh','Повторить ответ')}${m.truncated?'<small>Достигнута максимальная длина ответа</small>':''}</div></article>`:`<article class="message">${m.files?.length?`<div class="message-files">${m.files.map(id=>{const f=state.files.find(x=>x.id===id&&!x.deleted);return f?`<button class="message-file" data-action="preview-file" data-id="${f.id}">${icon(fileIcon(f))}<span class="truncate">${e(f.name)}</span></button>`:''}).join('')}</div>`:''}<div class="message-bubble">${typeof m.quote==='string'&&m.quote?quoteMarkup(m.quote):''}<div>${e(m.content)}</div></div><div class="message-time"><span>${time(m.at)}</span>${ib('copy-message','copy','Скопировать сообщение',`data-id="${m.id}"`)}${ib('edit-message','rename','Изменить сообщение',`data-id="${m.id}"`)}${ib('delete-message','trash','Удалить сообщение',`data-id="${m.id}"`)}</div></article>`;}).join('')}${generation?.chatId===c.id?`<div class="assistant-message" role="status"><div class="assistant-label">Focus</div>${generation.sources?.length?sourcePills({sources:generation.sources,query:generation.query,owner:'pending'}):''}<div class="generating ${generation.phase==='searching'?'web-searching':''}">${generation.phase==='searching'?'Ищу в интернете':generation.phase==='imaging'?'Создаю изображение':generation.forge?'Подготавливаю файлы и предпросмотр':'Готовлю ответ'}<span class="typing-dots"><i></i><i></i><i></i></span></div><div class="stream-text" id="stream-text" aria-live="polite" aria-atomic="false">${e(generation.text)}</div></div>`:c.backgroundJob?`<div class="pending-note">${icon('clock')}<span>Исследование выполняется в фоне</span>
 <button class="inline-link" data-action="resume-background">Проверить результат</button>
 <button class="inline-link" data-action="cancel-background">Остановить</button></div>`:c.error?`<div class="request-error" role="alert">${icon('info')}<div>${c.pendingSearch?.sources?.length?sourcePills({...c.pendingSearch,owner:'pending'}):''}<p>${e(c.error)}</p><button class="inline-link" data-action="retry-answer">Повторить запрос</button></div></div>`:c.messages.at(-1)?.role==='user'?`<div class="pending-note">${icon('info')}<span>${apiStatus.configured?'Ответ не получен. Вы можете повторить запрос.':'Запрос сохранён. Модель ещё не подключена.'} <button class="inline-link" data-action="retry-answer">Повторить</button></span></div>`:''}</section>`}

function composer(){return `<div class="composer-area"><div class="composer-wrap"><form class="composer" id="composer-form"><div id="composer-quote">${ui.quote?quoteMarkup(ui.quote.text,true):''}</div><div class="attachment-list" ${ui.attachments.length?'':'hidden'}>${ui.attachments.map(id=>{const f=state.files.find(x=>x.id===id);return f?`<span class="attachment-chip">${icon(fileIcon(f))}<span class="truncate">${e(f.name)}</span>${ib('remove-attachment','close','Убрать вложение',`data-id="${id}"`)}</span>`:''}).join('')}</div><textarea id="composer-input" rows="2" placeholder="Задача, вопрос или идея…" aria-label="Сообщение" maxlength="100000">${e(ui.draft)}</textarea><div class="composer-bottom"><div class="composer-left">${ib('attach','attach','Прикрепить файлы')}<button class="web-search-toggle ${state.settings.webSearch?'active':''}" type="button" data-action="toggle-web-search" aria-label="Поиск в интернете" aria-pressed="${!!state.settings.webSearch}" title="${apiStatus.searchConfigured?'Искать источники перед ответом':'Поиск ещё не подключён на сервере'}" ${generation?'disabled':''}>${icon('globe')}<span>Поиск</span></button><button class="composer-select" type="button" data-action="model-menu" aria-label="Выбрать модель">${e(MODEL_LABEL)}${icon('down')}</button><button class="composer-select" type="button" data-action="effort-menu" aria-label="Режим ответа">${apiStatus.provider==='openrouter'?'Обычный ответ':effortLabel()}${icon('down')}</button><button class="composer-select project-context" type="button" data-action="context-menu" aria-label="Контекст проекта">${icon('folder')}<span class="truncate">Файлы проекта</span>${icon('down')}</button></div><button class="send" id="send-button" type="${generation?'button':'submit'}" ${generation?'data-action="stop-generation"':''} aria-label="${generation?'Остановить ответ':'Отправить сообщение'}" ${generation||ui.draft.trim()||ui.attachments.length?'':'disabled'}>${generation?'<span class="stop-square"></span>':icon('arrow')}</button></div></form><div class="composer-hint"><span>История сохраняется в этом браузере</span><span class="enter-hint">· ${state.settings.sendOnEnter?'Enter — отправить, Shift + Enter — новая строка':'Ctrl + Enter — отправить'}</span></div></div></div>`}
function quoteMarkup(text,editable=false){
 return `<div class="message-quote"><div class="quote-copy"><strong>Цитата из диалога</strong><span>${e(text)}</span></div>${editable?ib('remove-quote','close','Убрать цитату'):''}</div>`;
}
function updateComposerQuote(){
 const preview=el('composer-quote');
 if(!preview)return;
 preview.innerHTML=ui.quote?quoteMarkup(ui.quote.text,true):'';
 el('composer-input')?.focus({preventScroll:true});
}
function effortLabel(){return {fast:'Быстро',balanced:'Вдумчиво',deep:'Подробно'}[state.settings.effort]||'Вдумчиво'}
function filesPanel(show){const files=visibleFiles();const current=state.files.find(f=>f.id===ui.folder);const rows=files.filter(f=>(f.parent||null)===ui.folder).sort((a,b)=>(a.kind==='folder'?-1:1)-(b.kind==='folder'?-1:1)||(ui.sort==='date'?b.updated-a.updated:a.name.localeCompare(b.name,'ru')));const size=files.reduce((n,f)=>n+(f.size||0),0);return `<aside class="files-panel ${ui.mobileFiles?'mobile-open':''}" aria-label="Файлы проекта" ${show||ui.mobileFiles?'':'hidden'}><div class="files-header"><div class="files-tabs" role="tablist" aria-label="Панель проекта"><button class="tab ${ui.filesTab==='files'?'active':''}" role="tab" aria-selected="${ui.filesTab==='files'}" data-action="files-tab">Файлы</button><button class="tab ${ui.filesTab==='changes'?'active':''}" role="tab" aria-selected="${ui.filesTab==='changes'}" data-action="changes-tab">Изменения</button>${activeChat()?.siteVersion?button('preview-result','Результат','ghost'):''}</div><div style="display:flex">${ib('refresh-files','refresh','Обновить список файлов')}${ib('close-files','close','Закрыть файлы',`class="mobile-only"`)}</div></div>${ui.filesTab==='files'?`<div class="files-toolbar"><div class="file-path">${ib('folder-up','arrow','На уровень выше',!ui.folder?'disabled':'')}<span class="truncate" title="${e(current?.name||'Корень проекта')}">${e(current?.name||'/')}</span></div><div class="file-actions">${ib('create-file','plus','Создать файл')}${ib('create-folder','folder','Создать папку')}${ib('upload','upload','Загрузить файлы')}</div></div><div class="files-body" id="files-dropzone">${rows.length?rows.map(f=>`<div class="file-row">${icon(fileIcon(f))}<button class="file-open" data-action="${f.kind==='folder'?'open-folder':'preview-file'}" data-id="${f.id}"><strong class="truncate">${e(f.name)}</strong><small>${f.kind==='folder'?'Папка':humanSize(f.size||0)}</small></button><button class="icon-btn row-more" data-action="file-menu" data-id="${f.id}" aria-label="Действия с файлом ${e(f.name)}">${icon('more')}</button></div>`).join(''):`<div class="files-empty">${icon('folder','empty-file-icon')}<span>Здесь пока пусто</span><small>Добавьте материалы для работы</small><button data-action="upload">Выбрать файлы</button></div>`}</div><footer class="files-foot"><span>${files.filter(f=>f.kind!=='folder').length} ${plural(files.filter(f=>f.kind!=='folder').length,'файл','файла','файлов')} · ${humanSize(size)}</span><button data-action="sort-files" style="font-size:10px;padding:0;color:var(--muted)">${ui.sort==='name'?'По имени':'По дате'}</button></footer>`:`<div class="files-body"><div class="change-list">${state.changes.filter(c=>c.project===activeProject()?.id).length?`<p class="change-day">История проекта</p>${state.changes.filter(c=>c.project===activeProject()?.id).slice(0,50).map(c=>`<div class="change-item">${e(c.text)}<small>${date(c.at)}, ${time(c.at)}</small></div>`).join('')}`:`<div class="files-empty">${icon('clock')}<span>Изменений пока нет</span><small>Здесь появятся действия с проектом и файлами</small></div>`}</div></div>`}</aside>`}
function workspaceTools(){const tools=[['sites','Сайты','Создавай страницы и сразу открывай предпросмотр.','globe'],['images','Изображения','Генерируй и продолжай править готовые изображения.','image']];return `<nav class="workspace-tools" aria-label="Инструменты Focus">${tools.map(([view,title,description,symbol])=>`<a class="workspace-tool" href="#${view}" data-action="studio-view" data-id="${view}"><span class="workspace-tool-icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${description}</small></span>${icon('chevron')}</a>`).join('')}</nav>`}
function workspaceView(){return `<section class="workspace"><div class="workspace-heading"><span class="studio-kicker">Focus workspace</span><h1>Ваше пространство</h1><p class="workspace-intro">Проекты объединяют диалоги и файлы по задаче</p></div>${workspaceTools()}<div class="section-heading"><h2>Проекты</h2>${button('create-project',`${icon('plus')} Создать проект`,'ghost')}</div>${liveProjects().map(p=>`<article class="workspace-card"><div class="workspace-symbol">${icon('folder')}</div><div class="workspace-details"><h3>${e(p.name)}</h3><p>${e(p.description)||`${state.chats.filter(c=>c.project===p.id&&!c.deleted).length} ${plural(state.chats.filter(c=>c.project===p.id&&!c.deleted).length,'диалог','диалога','диалогов')} · ${state.files.filter(f=>f.project===p.id&&!f.deleted&&f.kind!=='folder').length} ${plural(state.files.filter(f=>f.project===p.id&&!f.deleted&&f.kind!=='folder').length,'файл','файла','файлов')}`}</p></div>${button('open-workspace',`Открыть ${icon('chevron')}`,'primary',`data-id="${p.id}"`)}${ib('project-menu','more','Действия с проектом',`data-id="${p.id}"`)}</article>`).join('')||`<div class="list-empty">${icon('folder')}<h2>Начните с проекта</h2><p>Соберите диалоги и материалы по одной задаче</p>${button('create-project','Создать проект','primary')}</div>`}<p class="settings-note" style="margin-top:32px">Сейчас пространство хранится на этом устройстве. Резервную копию можно скачать в настройках.</p></section>`}
function trashCount(){return state.projects.filter(p=>p.deleted).length+state.chats.filter(c=>c.deleted&&!state.projects.find(p=>p.id===c.project)?.deleted).length+state.files.filter(f=>f.deleted&&!state.projects.find(p=>p.id===f.project)?.deleted&&!state.files.find(p=>p.id===f.parent)?.deleted).length}
function collectionView(){const trash=ui.view==='trash';const projects=trash?state.projects.filter(p=>p.deleted):[];const chats=state.chats.filter(c=>trash?c.deleted&&!state.projects.find(p=>p.id===c.project)?.deleted:c.archived&&!c.deleted&&!state.projects.find(p=>p.id===c.project)?.deleted);const files=trash?state.files.filter(f=>f.deleted&&!state.projects.find(p=>p.id===f.project)?.deleted&&!state.files.find(p=>p.id===f.parent)?.deleted):[];const count=projects.length+chats.length+files.length;return `<section class="workspace"><h1>${trash?'Корзина':'Архив диалогов'}</h1><p class="workspace-intro">${trash?'Удалённые материалы можно восстановить':'Завершённые диалоги остаются под рукой'}</p><div class="section-heading"><h2>${count?`${count} ${trash?plural(count,'элемент','элемента','элементов'):plural(count,'диалог','диалога','диалогов')}`:''}</h2>${trash&&count?button('empty-trash','Очистить корзину','ghost'):''}</div>${[...projects.map(p=>({item:p,type:'project',title:p.name,sub:'Проект',ico:'folder'})),...chats.map(c=>({item:c,type:'chat',title:c.title,sub:projectName(c.project),ico:'chat'})),...files.map(f=>({item:f,type:'file',title:f.name,sub:projectName(f.project),ico:fileIcon(f)}))].map(({item,type,title,sub,ico})=>`<div class="collection-item">${icon(ico)}<button class="item-main" data-action="${trash?'restore':'select-chat'}" data-id="${item.id}" data-type="${type}"><strong class="truncate">${e(title)}</strong><small>${e(sub)}</small></button><div class="row-actions">${ib(trash?'restore':'unarchive','restore',trash?'Восстановить':'Вернуть в диалоги',`data-id="${item.id}" data-type="${type}"`)}${ib(trash?'permanent-delete':'trash-chat','trash',trash?'Удалить навсегда':'В корзину',`data-id="${item.id}" data-type="${type}"`)}</div></div>`).join('')||`<div class="list-empty">${icon(trash?'trash':'archive')}<h2>${trash?'Корзина пуста':'В архиве пока пусто'}</h2><p>${trash?'Удалённые проекты, диалоги и файлы появятся здесь':'Архивируйте завершённый диалог через меню рядом с его названием'}</p>${button('new-chat','Начать диалог','ghost')}</div>`}</section>`}
function resizeComposer(){const t=el('composer-input');if(t){t.style.height='auto';t.style.height=Math.min(Math.max(t.scrollHeight,56),180)+'px'}}
function themeButton(){
 const dark=document.documentElement.dataset.theme==='dark';
 return ib('toggle-theme',dark?'moon':'sun','Тёмная тема',`aria-pressed="${dark}"`);
}
function applyTheme(){
 const mode=state.settings.theme;
 const dark=mode==='dark'||(mode==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
 document.documentElement.dataset.theme=dark?'dark':'light';
 document.querySelector('meta[name=theme-color]').content=dark?'#191b19':'#fafafa';
 const toggle=app.querySelector('[data-action="toggle-theme"]');
 if(toggle){
  toggle.setAttribute('aria-pressed',String(dark));
  toggle.innerHTML=icon(dark?'moon':'sun');
 }
}
function setView(view){ui.view=view;ui.mobileNav=false;ui.mobileFiles=false;closeMenu();render()}
window.addEventListener('hashchange',()=>{
 if(ready&&(studioRoute()||Object.hasOwn(STUDIO_LABELS,ui.view)))setView(studioRoute()||'chat');
 if(ready&&account&&ui.view==='images')void refreshAccount().then(refreshImageStudio);
});
function selectProject(id,toggle=false){const p=state.projects.find(p=>p.id===id&&!p.deleted);if(!p)return;const same=id===state.activeProject;if(same&&toggle){ui.collapsed.has(id)?ui.collapsed.delete(id):ui.collapsed.add(id)}else{state.activeProject=id;state.activeChat=null;ui.folder=null;ui.draft='';ui.quote=null;ui.attachments=[];ui.collapsed.delete(id)}ui.view='chat';ui.mobileNav=false;persist();render()}
function newChat(){if(!activeProject()){projectDialog();return}state.activeChat=null;ui.draft='';ui.quote=null;ui.attachments=[];ui.archive=false;ui.view='chat';ui.mobileNav=false;persist();render();el('composer-input')?.focus()}
function selectChat(id){const c=state.chats.find(c=>c.id===id&&!c.deleted);if(!c)return;state.activeChat=id;state.activeProject=c.project;ui.archive=!!c.archived;ui.folder=null;ui.draft='';ui.quote=null;ui.attachments=[];ui.view='chat';ui.mobileNav=false;persist();render();el('main-scroll').scrollTop=el('main-scroll').scrollHeight}
function send(){if(activeChat()?.backgroundJob){toast('В этом диалоге уже выполняется исследование');return;}if(generation){toast('Дождитесь ответа или остановите запрос');return}const content=ui.draft.trim();if(!content&&!ui.attachments.length)return;if(!activeProject()){projectDialog();return}let c=activeChat();if(!c){c={id:uid(),title:(content.replace(/^\/site\s+/iu,'')||'Диалог с файлами').replace(/\s+/g,' ').slice(0,48),project:activeProject().id,created:Date.now(),updated:Date.now(),messages:[],archived:false,deleted:false};state.chats.unshift(c);state.activeChat=c.id;log(`Создан диалог «${c.title}»`)}c.messages.push({id:uid(),content,files:[...ui.attachments],at:Date.now(),role:'user',...(ui.quote?{quote:ui.quote.text}:{}),webSearch:!!state.settings.webSearch,...(pendingResearch?{researchPlan:pendingResearch}:{})});pendingResearch=null;c.updated=Date.now();ui.draft='';ui.quote=null;ui.attachments=[];persist();render();el('main-scroll').scrollTop=el('main-scroll').scrollHeight;el('composer-input')?.focus();requestAnswer(c)}
function closeMenu(){document.querySelector('.menu-popup')?.remove();ui.menu=null}
function menu(anchor,options){closeMenu();const div=document.createElement('div');div.className='menu-popup';div.role='menu';div.innerHTML=options.map(o=>o.separator?'<div class="menu-separator"></div>':o.label?`<div class="menu-label">${e(o.label)}</div>`:`<button class="menu-option ${o.danger?'danger':''}" role="menuitem" data-action="${o.action}" ${o.id?`data-id="${e(o.id)}"`:''} ${o.type?`data-type="${e(o.type)}"`:''} ${o.value?`data-value="${e(o.value)}"`:''}>${o.icon?icon(o.icon):''}<span class="menu-option-copy"><span>${e(o.text)}</span>${o.description?`<small>${e(o.description)}</small>`:''}</span>${o.checked?icon('check','check'):''}</button>`).join('');document.body.append(div);const r=anchor.getBoundingClientRect(),d=div.getBoundingClientRect();div.style.left=Math.max(8,Math.min(r.left,innerWidth-d.width-8))+'px';div.style.top=(r.bottom+d.height+8>innerHeight?Math.max(8,r.top-d.height-8):r.bottom+8)+'px';ui.menu=div;div.querySelector('button')?.focus()}
function closeModal(){const d=document.querySelector('dialog');if(d){d.close();d.remove();const opener=modalOpener;modalOpener=null;if(opener?.isConnected)opener.focus();}for(const u of objectURLs)URL.revokeObjectURL(u);objectURLs=[]}
function modal(title,body,{wide=false,onSubmit=null}={}){closeModal();closeMenu();modalOpener=document.activeElement;const d=document.createElement('dialog');d.className=`dialog ${wide?'wide':''}`;d.setAttribute('aria-label',title);d.innerHTML=`<div class="dialog-header"><h2>${e(title)}</h2>${ib('close-modal','close','Закрыть')}</div><div class="dialog-body">${body}</div>`;el('overlay-root').append(d);d.showModal();d.addEventListener('click',ev=>{if(ev.target===d)closeModal()});d.addEventListener('cancel',event=>{event.preventDefault();closeModal()});if(onSubmit)d.querySelector('form')?.addEventListener('submit',ev=>{ev.preventDefault();onSubmit(new FormData(ev.target),ev.target)});return d}
function projectDialog(id){const p=state.projects.find(p=>p.id===id);modal(p?'Настройки проекта':'Новый проект',`<form><p class="dialog-description">Объедините диалоги и файлы по одной задаче</p><div class="form-field"><label for="project-name">Название</label><input id="project-name" name="name" placeholder="Например, запуск продукта" value="${e(p?.name||'')}" maxlength="70" required autofocus /></div><div class="form-field"><label for="project-description">Описание <span style="color:var(--muted);font-weight:400">· необязательно</span></label><textarea id="project-description" name="description" rows="3" placeholder="Для чего этот проект" maxlength="300">${e(p?.description||'')}</textarea></div><div class="form-field"><label for="project-instructions">Инструкции для всех диалогов</label><textarea id="project-instructions" name="instructions" rows="3" maxlength="4000" placeholder="Например, отвечай кратко и используй данные проекта">${e(p?.instructions||'')}</textarea></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">${p?'Сохранить':'Создать проект'}</button></div></form>`,{onSubmit:(data)=>{const name=data.get('name').trim();if(!name)return;if(liveProjects().some(x=>x.name.toLowerCase()===name.toLowerCase()&&x.id!==id)){el('form-error').textContent='Проект с таким названием уже существует';el('form-error').hidden=false;return}if(p){p.name=name;p.description=data.get('description').trim();p.instructions=String(data.get('instructions')||'').trim();log(`Обновлён проект «${name}»`,p.id)}else{const np={id:uid(),name,description:data.get('description').trim(),instructions:String(data.get('instructions')||'').trim(),created:Date.now(),deleted:false};state.projects.push(np);state.activeProject=np.id;state.activeChat=null;ui.folder=null;ui.draft='';ui.attachments=[];ui.view='chat';ui.archive=false;ui.mobileNav=false;log(`Создан проект «${name}»`,np.id)}persist();closeModal();render();toast(p?'Проект обновлён':'Проект создан')}})}
function renameDialog(type,id){const item=type==='chat'?state.chats.find(x=>x.id===id):state.files.find(x=>x.id===id);if(!item)return;const old=type==='chat'?item.title:item.name;modal('Переименовать',`<form><div class="form-field"><label for="rename-name">Название</label><input id="rename-name" name="name" value="${e(old)}" maxlength="120" required autofocus /></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:data=>{const name=data.get('name').trim();if(!name)return;if(type==='file'&&state.files.some(f=>f.id!==id&&f.project===item.project&&(f.parent||null)===(item.parent||null)&&!f.deleted&&f.name===name)){el('form-error').textContent='В этой папке уже есть элемент с таким названием';el('form-error').hidden=false;return}item[type==='chat'?'title':'name']=name;item.updated=Date.now();log(`Переименован ${type==='chat'?'диалог':'файл'} «${old}»`,item.project);persist();closeModal();render()}})}
function confirm(title,text,action,label='Подтвердить',danger=false){modal(title,`<p class="dialog-description">${e(text)}</p><div class="dialog-footer">${button('close-modal','Отмена','ghost')}<button id="confirm-button" class="btn ${danger?'danger':'primary'}">${e(label)}</button></div>`);el('confirm-button').onclick=async event=>{const submit=event.currentTarget;submit.disabled=true;try{await action();closeModal();persist();render()}catch{submit.disabled=false;toast('Не удалось выполнить действие. Попробуйте ещё раз.')}}}
function descendants(id){const ids=new Set([id]);let n=-1;while(n!==ids.size){n=ids.size;state.files.forEach(f=>{if(ids.has(f.parent))ids.add(f.id)})}return ids}
function trashProject(id){const p=state.projects.find(x=>x.id===id);if(!p)return;confirm('Переместить проект в корзину?',`«${p.name}», его диалоги и файлы можно будет восстановить.`,()=>{p.deleted=true;p.deletedAt=Date.now();if(state.activeProject===id){state.activeProject=liveProjects()[0]?.id;state.activeChat=null;ui.view=state.activeProject?'chat':'workspace';ui.draft='';ui.attachments=[];ui.folder=null}log(`Проект «${p.name}» перемещён в корзину`,id)},'В корзину')}
function trashChat(id){const c=state.chats.find(x=>x.id===id);if(!c)return;c.deleted=true;c.deletedAt=Date.now();if(state.activeChat===id){state.activeChat=null;ui.draft=''}log(`Диалог «${c.title}» перемещён в корзину`,c.project);persist();render();toast('Диалог перемещён в корзину')}
function trashFile(id){const f=state.files.find(x=>x.id===id);if(!f)return;const ids=descendants(id);state.files.forEach(x=>{if(ids.has(x.id)){x.deleted=true;x.deletedAt=Date.now()}});ui.attachments=ui.attachments.filter(x=>!ids.has(x));log(`В корзину: «${f.name}»`,f.project);persist();render();toast('Перемещено в корзину')}
function archiveChat(id,value=true){const c=state.chats.find(x=>x.id===id);if(!c)return;c.archived=value;if(value&&state.activeChat===id){state.activeChat=null;ui.draft=''}persist();render();toast(value?'Диалог в архиве':'Диалог возвращён')}
function restore(type,id){if(type==='project'){const p=state.projects.find(x=>x.id===id);if(p)p.deleted=false}else if(type==='chat'){const c=state.chats.find(x=>x.id===id);if(c)c.deleted=false}else{const ids=descendants(id);state.files.forEach(f=>{if(ids.has(f.id))f.deleted=false});const f=state.files.find(x=>x.id===id);if(f&&state.files.find(x=>x.id===f.parent)?.deleted)f.parent=null}persist();render();toast('Восстановлено')}
async function permanentDelete(type,id){if(type==='project'){const files=state.files.filter(f=>f.project===id);await Promise.all(files.filter(f=>f.kind!=='folder').map(f=>deleteBlob(f.id)));state.files=state.files.filter(f=>f.project!==id);state.chats=state.chats.filter(c=>c.project!==id);state.changes=state.changes.filter(c=>c.project!==id);state.projects=state.projects.filter(p=>p.id!==id)}else if(type==='chat'){state.chats=state.chats.filter(c=>c.id!==id)}else{const ids=descendants(id);await Promise.all(state.files.filter(f=>ids.has(f.id)&&f.kind!=='folder').map(f=>deleteBlob(f.id)));state.files=state.files.filter(f=>!ids.has(f.id))}}
function createFolder(){if(!activeProject()){projectDialog();return}modal('Новая папка',`<form><div class="form-field"><label for="folder-name">Название папки</label><input id="folder-name" name="name" placeholder="Материалы" maxlength="100" required autofocus /></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button type="submit" class="btn primary">Создать папку</button></div></form>`,{onSubmit:data=>{const name=data.get('name').trim();if(!name)return;if(fileExists(name)){el('form-error').textContent='Такое название уже есть в этой папке';el('form-error').hidden=false;return}state.files.push({id:uid(),project:activeProject().id,parent:ui.folder,name,kind:'folder',created:Date.now(),updated:Date.now(),deleted:false,size:0});log(`Создана папка «${name}»`);persist();closeModal();render()}})}
function fileExists(name){return visibleFiles().some(f=>(f.parent||null)===ui.folder&&f.name===name)}
function createFile(){if(!activeProject()){projectDialog();return}modal('Новый файл',`<form><div class="form-field"><label for="file-name">Название с расширением</label><input id="file-name" name="name" value="Заметка.md" maxlength="100" required autofocus /><small>Текстовый файл: .md, .txt, .csv или .json</small></div><div class="form-field"><label for="file-content">Содержимое</label><textarea id="file-content" name="content" rows="10" placeholder="Текст, заметки или данные" maxlength="1000000"></textarea></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Создать файл</button></div></form>`,{onSubmit:async(data,form)=>{const name=data.get('name').trim();if(!name)return;if(!/\.(md|txt|csv|json|html|css|js|py|xml|yaml|yml)$/i.test(name)||/[\\/]/.test(name)||fileExists(name)){el('form-error').textContent=fileExists(name)?'Такое название уже есть в этой папке':'Укажите текстовое расширение, например .md или .txt';el('form-error').hidden=false;return}const b=form.querySelector('[type=submit]');b.disabled=true;try{const blob=new Blob([data.get('content')],{type:'text/plain;charset=utf-8'});const id=uid();await putBlob(id,blob);state.files.push({id,project:activeProject().id,parent:ui.folder,name,kind:'file',type:'text/plain',size:blob.size,created:Date.now(),updated:Date.now(),deleted:false});log(`Создан файл «${name}»`);persist();closeModal();render();toast('Файл создан')}catch{b.disabled=false;el('form-error').textContent='Не удалось сохранить файл в браузере';el('form-error').hidden=false}}})}
async function uploadFiles(files,attach=false){if(!activeProject()){projectDialog();return}let added=0,failed=0;for(const file of files){if(file.size>25*1048576){toast(`«${file.name}»: максимум 25 МБ на файл`);continue}try{const id=uid();let name=file.name,n=1;const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';while(fileExists(name))name=`${base} (${n++})${ext}`;await putBlob(id,file);state.files.push({id,project:activeProject().id,parent:ui.folder,name,kind:'file',type:file.type||'application/octet-stream',size:file.size,created:Date.now(),updated:Date.now(),deleted:false});if(attach)ui.attachments.push(id);log(`Загружен файл «${name}»`);added++}catch{failed++}}persist();render();if(added)toast(`Загружено файлов: ${added}${failed?`. Не удалось загрузить: ${failed}`:''}`);else if(failed)toast('Не удалось сохранить файлы. Проверьте доступное место в браузере')}
function pickFiles(attach=false){if(!activeProject()){projectDialog();return}uploadAttach=attach;el('file-input').value='';el('file-input').click()}
function answerMarkdown(m){return m.content+(m.search?.sources?.length?'\n\nИсточники:\n'+m.search.sources.map(s=>`[${s.id}] ${s.title} — ${s.url}`).join('\n'):'')}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
async function downloadFile(id){const f=state.files.find(x=>x.id===id);const b=await getBlob(id);if(!b){toast('Файл недоступен на этом устройстве');return}download(b,f.name)}
function isText(f){return f.type?.startsWith('text/')||/\.(md|txt|csv|json|html?|css|js|jsx|tsx?|py|xml|ya?ml|log|svg|c|h|cpp|cc|hpp|cs|java|kt|kts|go|rs|rb|php|swift|sql|sh|bash|ps1|lua|toml|ini|vue|svelte|dart|scala|r|ipynb)$/i.test(f.name)||/^(?:Dockerfile|Makefile|CMakeLists\.txt)$/i.test(f.name)}
function projectTextFiles(projectId){
 const files=state.files.filter(file=>file.project===projectId&&!file.deleted);
 const folders=new Map(files.filter(file=>file.kind==='folder').map(file=>[file.id,file]));
 return files.filter(file=>file.kind==='file'&&(isText(file)||officeFilename(file.name))).map(file=>({...file,path:projectPath(file,folders)}))
  .filter(file=>!/(?:^|\/)(?:node_modules|\.git)(?:\/|$)|(?:^|\/)(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12))$/iu.test(file.path));
}
async function readProjectText(id){
 const file=state.files.find(item=>item.id===id&&!item.deleted);
 const blob=await getBlob(id);
 if(!file||!blob)return null;
 if(officeFilename(file.name)){
  try{return (await officeText(new File([blob],file.name))).text;}
  catch{return null;}
 }
 return blob.size<=500000?blob.text():null;
}
function renderProjectMatches(message){
 const data=message.projectSearch;
 if(!Array.isArray(data?.results))return markdown(message.content,message);
 return `<p>${e(data.summary)}</p>${data.results.length?`<ul class="project-matches">${data.results.slice(0,20).map((match,index)=>`
  <li><button class="project-match" data-action="open-project-match" data-id="${e(message.id)}" data-match="${index}" type="button">
   <strong>${e(match.path)}:${e(match.line)}</strong><code>${e(match.snippet)}</code>
  </button></li>`).join('')}</ul>`:''}`;
}
async function openProjectMatch(messageId,index){
 const chat=activeChat();
 const message=chat?.messages.find(item=>item.id===messageId&&item.model==='local-project-search');
 const match=message?.projectSearch?.results?.[index];
 if(!match||typeof message.projectSearch.query!=='string')return;
 const file=state.files.find(item=>item.id===match.fileId&&item.project===chat.project&&!item.deleted&&item.kind==='file');
 if(!file){toast('Файл больше недоступен.');return;}
 const text=await readProjectText(file.id);
 const rows=text!==null?readMatchContext(text,match.line,message.projectSearch.query):null;
 if(!rows){toast('Строка изменилась. Повторите поиск по проекту.');return;}
 modal(match.path+':'+match.line,`<div class="code-diff" aria-label="Строки файла">
  ${rows.map(row=>`<div class="diff-line ${row.line===match.line?'diff-added':''}"><span>${row.line}</span><code>${e(row.text.slice(0,1000))}${row.text.length>1000?'…':''}</code></div>`).join('')}
 </div><div class="dialog-footer" style="margin-top:16px">${button('preview-file','Открыть файл','primary',`data-id="${e(file.id)}"`)}</div>`,{wide:true});
}
async function previewFile(id){const f=state.files.find(x=>x.id===id&&!x.deleted);if(!f)return;const blob=await getBlob(id);if(!blob){toast('Файл недоступен на этом устройстве');return}const text=isText(f)&&blob.size<=2*1048576?await blob.text():null;let content;if(text!==null)content=`<pre>${e(text)||'Файл пуст'}</pre>`;else if(f.type?.startsWith('image/')){const url=URL.createObjectURL(blob);content=`<img src="${url}" alt="${e(f.name)}" />`}else content=`<div class="list-empty">${icon(fileIcon(f))}<h2>${e(f.name)}</h2><p>Скачайте файл, чтобы открыть его в подходящем приложении</p></div>`;
 const urlToKeep=content.match(/src="(blob:[^"]+)"/)?.[1];modal(f.name,`<div class="file-preview-header"><span class="file-preview-meta">${humanSize(f.size)} · ${date(f.updated)}</span><div style="display:flex;gap:8px">${text!==null?button('edit-file',`${icon('rename')} Изменить`,'',`data-id="${id}"`):''}${button('download-file',`${icon('download')} Скачать`,'',`data-id="${id}"`)}</div></div><div class="file-preview-content">${content}</div>`,{wide:true});if(urlToKeep)objectURLs.push(urlToKeep)}
async function editFile(id){const f=state.files.find(x=>x.id===id),blob=await getBlob(id);if(!f||!blob)return;const text=await blob.text();modal(f.name,`<form><div class="form-field"><label for="editor-text">Содержимое файла</label><textarea id="editor-text" class="file-editor" name="content" maxlength="2000000" spellcheck="false">${e(text)}</textarea></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить изменения</button></div></form>`,{wide:true,onSubmit:async(data,form)=>{form.querySelector('[type=submit]').disabled=true;try{const b=new Blob([data.get('content')],{type:f.type||'text/plain'});await putBlob(id,b);f.size=b.size;f.updated=Date.now();log(`Изменён файл «${f.name}»`,f.project);persist();closeModal();render();toast('Изменения сохранены')}catch{form.querySelector('[type=submit]').disabled=false;el('form-error').textContent='Не удалось сохранить файл';el('form-error').hidden=false}}})}
let searchWorker,searchRevision=0,searchQueue=Promise.resolve();
const searchVersions=new Map();

function searchDialog(){
 modal('Поиск по пространству',`<div class="search-input-wrap">${icon('search')}<input id="search-input" aria-label="Поиск диалогов, проектов и файлов" placeholder="Название или текст" autocomplete="off" autofocus /></div><div class="search-results" id="search-results" aria-live="polite"></div>`);
 searchResults('');
 el('search-input').oninput=event=>searchResults(event.target.value);
}
function searchResults(query){
 const id=++searchRevision;
 searchQueue=searchQueue.then(async()=>{
  if(id!==searchRevision||!el('search-results'))return;
  if(!searchWorker){
   searchWorker=new Worker('/search-worker.js',{type:'module'});
   searchWorker.onmessage=({data})=>{
    const result=el('search-results');
    if(!result||data.id!==searchRevision)return;
    if(data.error){result.textContent=data.error;return;}
    result.innerHTML=data.rows.map(row=>`<button class="search-result" data-action="${row.action}" data-id="${e(row.id)}">${icon(row.icon)}<span><strong class="truncate">${e(row.title)}</strong><small class="truncate">${e(row.subtitle)}</small></span></button>`).join('')||'<div class="search-empty">Ничего не найдено. Попробуйте другое слово.</div>';
   };
   searchWorker.onerror=()=>{
    searchWorker.terminate();searchWorker=null;searchVersions.clear();
    if(el('search-results'))el('search-results').textContent='Не удалось открыть поиск.';
   };
  }
  const live=new Set(liveProjects().map(project=>project.id));
  const next=new Map(),changed=[];
  const add=(key,revision,entry)=>{
   next.set(key,revision);
   if(searchVersions.get(key)!==revision)changed.push({key,...entry()});
  };
  for(const project of liveProjects()){
   add('project:'+project.id,project.name,()=>({id:project.id,title:project.name,project:project.id,action:'search-project',icon:'folder',subtitle:'Проект'}));
  }
  for(const chat of state.chats){
   if(chat.deleted||!live.has(chat.project))continue;
   add('chat:'+chat.id,chat.updated+':'+chat.title+':'+chat.archived+':'+chat.messages.length,()=>({
    id:chat.id,title:chat.title,project:chat.project,action:'search-chat',icon:'chat',
    subtitle:projectName(chat.project)+(chat.archived?' · Архив':''),messages:chat.messages.map(message=>message.content),
   }));
  }
  for(const file of state.files){
   if(file.deleted||!live.has(file.project))continue;
   const key='file:'+file.id,revision=file.updated+':'+file.name;
   let blob;
   if(searchVersions.get(key)!==revision&&file.kind==='file'&&isText(file)&&file.size<=500000){
    blob=await getBlob(file.id);
   }
   add(key,revision,()=>({id:file.id,title:file.name,project:file.project,action:'search-file',icon:fileIcon(file),
    subtitle:projectName(file.project),blob}));
  }
  const removed=[...searchVersions.keys()].filter(key=>!next.has(key));
  searchWorker.postMessage({id,changed,removed,query});
  searchVersions.clear();
  for(const [key,value] of next)searchVersions.set(key,value);
 }).catch(()=>{
  searchVersions.clear();
  if(el('search-results'))el('search-results').textContent='Не удалось выполнить поиск.';
 });
}
function settingsDialog(){modal('Настройки',`<form id="settings-form">${account?`<div class="settings-section"><h3>Аккаунт Focus</h3><p class="settings-note">${e(account.email)}</p><div class="form-field"><label for="account-name">Имя в аккаунте</label><input id="account-name" name="accountName" value="${e(account.name||'')}" maxlength="80" autocomplete="name" /></div>${button('cloud-workspace','Синхронизация пространства','','type="button"')} ${button('logout','Выйти из аккаунта','ghost','type="button"')} ${button('delete-account','Удалить аккаунт','danger','type="button"')}</div>`:''}<div class="settings-section"><h3>Ваше пространство</h3><div class="form-field"><label for="settings-name">Название</label><input id="settings-name" name="name" value="${e(state.settings.name)}" maxlength="60" required /></div><div class="form-field" style="margin-bottom:0"><label for="settings-theme">Оформление</label><select name="theme" id="settings-theme">${[['light','Светлое'],['dark','Тёмное'],['system','Как на устройстве']].map(([v,l])=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="setting-row"><div>Отправлять по Enter<p>Shift + Enter добавляет новую строку</p></div><button class="switch" type="button" role="switch" aria-label="Отправлять по Enter" aria-checked="${state.settings.sendOnEnter}" data-action="toggle-enter"></button></div></div><div class="settings-section"><h3>Данные</h3><p class="settings-note" style="margin-bottom:16px">По умолчанию история и файлы остаются в этом браузере. Между устройствами они передаются после включения синхронизации. Браузер может очистить локальные данные при нехватке места или при очистке сайта. Регулярно скачивай резервную копию.</p><div class="settings-buttons">${button('export-backup',`${icon('download')} Скачать копию`,'','type="button"')}${button('import-backup',`${icon('upload')} Восстановить`,'','type="button"')}</div></div><div class="settings-section"><h3>Подключение модели</h3><p class="settings-note">${e(MODEL_LABEL)} · ${apiStatus.configured?'подключена':'не настроена'}. Запросы проходят через сервер приложения. Ключ API не хранится в браузере. Текст диалога и поддерживаемые вложения передаются выбранному провайдеру: Google, OpenRouter, Cloudflare или OpenAI. Поисковые запросы передаются Tavily. <a href="/privacy.html">Политика конфиденциальности</a> · <a href="/terms.html">Условия использования</a>. В бесплатном режиме режимы глубины ответа не применяются.</p></div><p class="settings-note"><a href="/about.html">О проекте</a></p><div class="dialog-footer" style="margin-top:24px">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:saveSettings})}
async function updateAccount(path,body){
 const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();
 if(response.status===401){location.replace('/login');throw new Error('Сессия завершена.');}
 if(!response.ok)throw new Error(result.error||'Не удалось обновить аккаунт.');
 account=result.user;
}
async function refreshAccount(){
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});
  if(!response.ok)return;
  const {user}=await response.json();
  if(user)account=user;
 }catch{}
}
async function saveSettings(data,form){
 const submit=form.querySelector('[type=submit]');
 submit.disabled=true;
 const sendOnEnter=form.querySelector('[data-action=toggle-enter]')?.getAttribute('aria-checked')==='true';
 try{
  const name=data.get('accountName');
  if(account&&typeof name==='string'&&name.trim()!==(account.name||''))await updateAccount('profile',{name});
  state.settings.name=data.get('name').trim()||'Моё пространство';
  state.settings.theme=data.get('theme');
  state.settings.sendOnEnter=sendOnEnter;
  persist();if(form.isConnected)closeModal();render();toast('Настройки сохранены');
 }catch(error){toast(error.message);}
 finally{submit.disabled=false;}
}
function imageSubscriptionDialog(){
 if(!isSecureContext){toast('Введите код подписки на защищённой странице HTTPS');return}
 modal('Подписка на изображения',`<form><div class="form-field"><label for="image-pass">Код подписки</label><input id="image-pass" name="pass" type="password" autocomplete="off" maxlength="64" pattern="[a-f0-9]{64}" ${account?'required':''} /></div><p class="settings-note">${account?'Код привязывает подписку к аккаунту.':'Вставьте код, полученный после оплаты. Пустое поле включает базовый режим.'}</p><p class="settings-note" role="alert" data-subscription-error hidden></p><div class="dialog-footer"><button class="btn primary" type="submit">Применить</button></div></form>`,{onSubmit:async(data,form)=>{
  const pass=String(data.get('pass')||'').trim();
  const submit=form.querySelector('[type=submit]');
  submit.disabled=true;
  try{
   if(account){await updateAccount('subscription',{code:pass});sessionStorage.removeItem(imagePassKey());}
   else if(pass)sessionStorage.setItem(imagePassKey(),pass);
   else{sessionStorage.removeItem(imagePassKey());studio.image.mode='free';}
   if(form.isConnected)closeModal();
   studio.imageError='';
   refreshImageStudio();
   toast(account?'Подписка активирована':pass?'Код сохранён для этой вкладки':'Выбран базовый режим');
  }catch(error){
   const message=form.querySelector('[data-subscription-error]');
   message.textContent=error.message;message.hidden=false;
  }finally{submit.disabled=false;}
 }});
}
async function exportBackup(){toast('Подготавливаю резервную копию');try{const blobs={};for(const f of state.files.filter(f=>f.kind!=='folder')){const b=await getBlob(f.id);if(b)blobs[f.id]=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(b)})}download(new Blob([JSON.stringify({...state,blobs},null,2)],{type:'application/json'}),`focus-backup-${new Date().toISOString().slice(0,10)}.json`);toast('Резервная копия скачана')}catch{toast('Не удалось создать копию')}}
async function importBackup(file){
 if(!file)return;
 if(file.size>150*1048576){toast('Резервная копия слишком большая: максимум 150 МБ');return;}
 let data;
 try{
  data=JSON.parse(await file.text());
  if(!validBackup(data))throw new Error();
 }catch{toast('Это не резервная копия Focus или файл повреждён');return;}
 confirm('Восстановить пространство?','Текущая история будет заменена данными из резервной копии. Сначала можно скачать текущую копию в настройках.',async()=>{
  const {state:restored,blobs}=decodeWorkspace(data);
  const next={...fresh(),...restored,settings:{...fresh().settings,...restored.settings}};
  try{await replaceWorkspace(next,blobs);}
  catch(error){
   if(error?.name==='QuotaExceededError'){toast('Недостаточно места в браузере для восстановления. Текущие данные сохранены.');return;}
   throw error;
  }
  state=next;
  Object.assign(ui,{draft:'',attachments:[],folder:null,view:'chat'});
  toast('Пространство восстановлено');
 },'Восстановить');
}
function exportChat(id){const c=state.chats.find(x=>x.id===id);if(!c)return;const text=`# ${c.title}\n\nПроект: ${projectName(c.project)}\n\n`+c.messages.map(m=>`## ${m.role==='assistant'?'Focus':'Вы'} · ${date(m.at)}, ${time(m.at)}\n\n${typeof m.quote==='string'&&m.quote?m.quote.split('\n').map(line=>'> '+line).join('\n')+'\n\n':''}${m.content}${m.search?.sources?.length?'\n\nИсточники:\n'+m.search.sources.map(x=>`[${x.id}] ${x.title} — ${x.url}`).join('\n'):''}${m.files?.length?'\n\nВложения: '+m.files.map(id=>state.files.find(f=>f.id===id)?.name||'Удалённый файл').join(', '):''}`).join('\n\n---\n\n');download(new Blob([text],{type:'text/markdown;charset=utf-8'}),`${c.title.replace(/[\\/:*?"<>|]/g,'').slice(0,60)||'Диалог'}.md`)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Скопировано')}catch{toast('Не удалось скопировать. Выделите текст вручную.')}}
async function handleAction(a,t){const id=t.dataset.id;switch(a){
case 'new-chat':newChat();break;
case 'workspace':setView('workspace');break;
case 'studio-view':if(Object.hasOwn(STUDIO_LABELS,id)){if(studioRoute()===id)setView(id);else location.hash=id;}break;
case 'site-starter':{
 const item=SITE_STARTERS[Number(id)];
 if(item){studio.siteBrief=item.prompt;el('site-brief').value=item.prompt;el('site-brief').focus();}
 break;
}
case 'code-starter':{
 const item=CODE_STARTERS[Number(id)];
 if(item){studio.codeBrief=item.prompt;el('code-brief').value=item.prompt;el('code-brief').focus();}
 break;
}
case 'forge-starter':{
 const item=FORGE_STARTERS[Number(id)];
 if(item){studio.forgeBrief=item.prompt;el('forge-brief').value=item.prompt;el('forge-brief').focus();}
 break;
}
case 'studio-open-chat':selectChat(id);break;
case 'studio-open-site':openStudioSite(id);break;
case 'site-versions':await showSiteVersions(id||activeChat()?.id);break;
case 'site-version-open':{
 const chat=state.chats.find(item=>item.id===id);
 const selection=findWebsite(chat?.messages.find(item=>item.id===t.dataset.version));
 if(selection){closeModal();chat.siteVersion=selection.messageId;selectChat(id);setPreview(selection);}
 break;
}
case 'site-version-diff':showSiteDiff(id,t.dataset.version);break;
case 'preview-files':{
 setPreview(null);
 state.settings.showFiles=true;
 if(innerWidth<960)ui.mobileFiles=true;
 render();
 break;
}
case 'preview-result':{
 const chat=activeChat();
 const selection=findWebsite(chat?.messages.find(message=>message.id===chat.siteVersion));
 if(selection)setPreview(selection);
 break;
}
case 'preview-sources':{
 const chat=activeChat();
 const search=chat?.messages.findLast(message=>message.search?.sources?.length)?.search;
 if(search)modal('Источники диалога',sourcesDialog(search));
 else toast('В этом диалоге пока нет источников');
 break;
}
case 'preview-edit-section':{
 if(!mountedPreview||mountedPreview.pending)break;
 mountedPreview.selecting=!mountedPreview.selecting;
 t.setAttribute('aria-pressed',String(mountedPreview.selecting));
 mountedPreview.frame.contentWindow.postMessage({type:'focus-preview-select',id:mountedPreview.id,active:mountedPreview.selecting},'*');
 if(mountedPreview.selecting)toast('Нажмите на блок сайта');
 break;
}
case 'site-publish':await publishVersion(id,t.dataset.version);break;
case 'site-unpublish':removePublication(id);break;
case 'site-preview-zip':{
 const artifact=previewArtifact(activeChat());
 if(artifact)download(projectZip([{name:'index.html',content:artifact.code}]),'site.zip');
 break;
}
case 'research-plan':researchDialog();break;
case 'cloud-workspace':await cloudWorkspace();break;
case 'office-export':officeExport(id);break;
case 'studio-download-site':openStudioSite(id,true);break;
case 'studio-tool':{
 const item=TOOL_STARTERS[Number(id)];
 if(!item)break;
 newChat();
 const composer=el('composer-input');
 if(composer){composer.value=item.prompt;composer.dispatchEvent(new Event('input',{bubbles:true}));composer.focus();}
 break;
}
case 'image-starter':{
 const item=IMAGE_STARTERS[Number(id)];
 if(item){studio.image.brief=item.prompt;studio.image.style=item.style;refreshImageStudio();el('image-brief')?.focus();}
 break;
}
case 'studio-stop-image':studio.imageController?.abort();break;
case 'studio-favorites':studio.image.favorites=!studio.image.favorites;refreshImageStudio();break;
case 'studio-image-favorite':{
 const file=state.files.find(file=>file.id===id&&!file.deleted);
 if(file){file.favorite=!file.favorite;persist();refreshImageStudio();}
 break;
}
case 'studio-edit-image':{
 if(!studioImages().some(file=>file.id===id))break;
 Object.assign(studio.image,{reference:id,brief:'',ratio:'',style:''});
 studio.imageError='';
 refreshImageStudio();
 el('main-scroll').scrollTop=0;
 el('image-brief')?.focus();
 break;
}
case 'studio-clear-reference':studio.image.reference=null;studio.image.ratio='1:1';studio.imageError='';refreshImageStudio();break;
case 'trash':setView('trash');break;
case 'close-nav':ui.mobileNav=false;render();break;
case 'toggle-sidebar':if(innerWidth<640){ui.mobileNav=!ui.mobileNav}else ui.sidebarClosed=!ui.sidebarClosed;render();break;
case 'select-project':selectProject(id,true);break;
case 'open-workspace':selectProject(id);break;
case 'select-chat':selectChat(id);break;
case 'search':searchDialog();break;
case 'open-project-match':await openProjectMatch(id,Number(t.dataset.match));break;
case 'search-project':closeModal();selectProject(id);break;
case 'search-chat':closeModal();selectChat(id);break;
case 'search-file':{
 const file=state.files.find(item=>item.id===id&&!item.deleted);
 if(!file)break;
 closeModal();
 selectProject(file.project);
 if(file.kind==='folder'){ui.folder=file.id;render();}
 else await previewFile(id);
 break;
}
case 'create-project':projectDialog();break;
case 'edit-project':projectDialog(id);break;
case 'project-menu':menu(t,[{text:'Новый диалог',action:'project-new-chat',id,icon:'compose'},{text:'Настройки проекта',action:'edit-project',id,icon:'settings'},{separator:true},{text:'В корзину',action:'trash-project',id,icon:'trash',danger:true}]);break;
case 'project-new-chat':selectProject(id);newChat();break;
case 'trash-project':trashProject(id);break;
case 'tab-dialogs':ui.archive=false;ui.view='chat';if(activeChat()?.archived)state.activeChat=null;render();break;
case 'tab-archive':ui.archive=true;setView('archive');break;
case 'current-chat-menu':break;
case 'chat-menu':{const cid=id||state.activeChat,c=state.chats.find(x=>x.id===cid);if(c)menu(t,[{text:'Переименовать',action:'rename-chat',id:cid,icon:'rename'},{text:c.archived?'Вернуть в диалоги':'В архив',action:c.archived?'unarchive':'archive-chat',id:cid,icon:'archive'},{text:'Скачать диалог',action:'export-chat',id:cid,icon:'download'},{separator:true},{text:'В корзину',action:'trash-chat',id:cid,icon:'trash',danger:true}]);break;}
case 'rename-chat':renameDialog('chat',id);break;
case 'archive-chat':archiveChat(id);break;
case 'unarchive':archiveChat(id,false);break;
case 'trash-chat':trashChat(id);break;
case 'export-chat':exportChat(id);break;
case 'restore':restore(t.dataset.type,id);break;
case 'permanent-delete':confirm('Удалить навсегда?','Элемент и его содержимое будут удалены без возможности восстановления.',()=>permanentDelete(t.dataset.type,id),'Удалить навсегда',true);break;
case 'empty-trash':confirm('Очистить корзину?','Все элементы корзины будут удалены навсегда.',async()=>{for(const p of state.projects.filter(p=>p.deleted))await permanentDelete('project',p.id);for(const c of state.chats.filter(c=>c.deleted))await permanentDelete('chat',c.id);for(const f of state.files.filter(f=>f.deleted))await permanentDelete('file',f.id)},'Очистить',true);break;
case 'prompt':ui.draft=t.dataset.prompt;render();el('composer-input').focus();el('composer-input').setSelectionRange(ui.draft.length,ui.draft.length);break;
case 'product-menu':menu(t,[
 {text:'Focus',description:'Общение, поиск и работа с проектами',action:'select-product',value:'workspace',icon:'grid',checked:!['code','forge'].includes(ui.view)},
 {text:'Focus Code',description:'Создание и изменение кода',action:'select-product',value:'code',icon:'code',checked:ui.view==='code'},
 {text:'Focus Forge',description:'Сборка и проверка приложений',action:'select-product',value:'forge',icon:'check',checked:ui.view==='forge'},
]);ui.menu?.classList.add('product-menu-popup');break;
case 'select-product':if(t.dataset.value==='workspace')setView('workspace');else if(Object.hasOwn(STUDIO_LABELS,t.dataset.value))location.hash=t.dataset.value;break;
case 'remove-quote':ui.quote=null;updateComposerQuote();break;
case 'model-menu':menu(t,[{label:'Подключённая модель'},{text:MODEL_LABEL,action:'set-model',value:apiStatus.provider||'default',checked:true},{separator:true},{text:'О подключении',action:'model-info',icon:'info'}]);break;
case 'image-subscription':imageSubscriptionDialog();break;
case 'set-model':state.settings.model=t.dataset.value;persist();render();break;
case 'effort-menu':if(apiStatus.provider==='openrouter'){toast('В бесплатном режиме параметры ответа выбирает провайдер');break;}menu(t,[{text:'Быстро',action:'set-effort',value:'fast',checked:state.settings.effort==='fast'},{text:'Вдумчиво',action:'set-effort',value:'balanced',checked:state.settings.effort==='balanced'},{text:'Подробно',action:'set-effort',value:'deep',checked:state.settings.effort==='deep'}]);break;
case 'set-effort':state.settings.effort=t.dataset.value;persist();render();break;
case 'context-menu':menu(t,[{label:'Работать в проекте'},...liveProjects().map(p=>({text:p.name,action:'switch-context',id:p.id,checked:p.id===state.activeProject,icon:'folder'}))]);break;
case 'switch-context':{const d=ui.draft;selectProject(id);ui.draft=d;render();break;}
case 'model-info':modal('Подключение модели',`<p class="dialog-description">${e(MODEL_LABEL)} ${apiStatus.configured?'подключена через сервер приложения.':'ещё не настроена на этом сервере.'}</p><p class="settings-note">История хранится в браузере. Для ответа текст диалога и прикреплённые поддерживаемые файлы передаются провайдеру модели. Focus выбирает модель из настроек сервера. В бесплатном режиме ответы обрабатывает внешний провайдер, базовая модель может меняться. Ключ API хранится на сервере и не передаётся в браузер.</p><p class="settings-note">Встроенные навыки работают без ключа. Попробуйте «Посчитай (125 + 18) * 1,2», «Статистика для чисел 12; 18; 21; 24» или «Переведи 2,5 км в м».</p><p class="settings-note">Прикрепите таблицу и напишите «Проанализируй CSV». Чтобы увидеть правки, прикрепите старую и новую версии и напишите «Сравни два файла построчно».</p><div class="dialog-footer" style="margin-top:24px">${button('close-modal','Понятно','primary')}</div>`);break;
case 'toggle-web-search':if(!apiStatus.searchConfigured){toast('Поиск ещё не подключён на сервере');break;}state.settings.webSearch=!state.settings.webSearch;persist();render();el('composer-input')?.focus();break;
case 'search-sources':{const owner=t.dataset.searchOwner;const search=owner==='pending'?(generation?.sources?{sources:generation.sources,query:generation.query}:activeChat()?.pendingSearch):activeChat()?.messages.find(m=>m.id===owner)?.search;if(search)modal('Источники поиска',sourcesDialog(search));break;}
case 'toggle-files':if(previewArtifact(activeChat())){state.settings.showFiles=true;setPreview(null);if(innerWidth<960){ui.mobileFiles=true;render()}break}if(innerWidth<960){ui.mobileFiles=!ui.mobileFiles}else state.settings.showFiles=!state.settings.showFiles;persist();render();break;
case 'close-files':ui.mobileFiles=false;if(innerWidth>=960)state.settings.showFiles=false;persist();render();break;
case 'files-tab':ui.filesTab='files';render();break;
case 'changes-tab':ui.filesTab='changes';render();break;
case 'refresh-files':render();toast('Список обновлён');break;
case 'sort-files':ui.sort=ui.sort==='name'?'date':'name';render();break;
case 'open-folder':ui.folder=id;render();break;
case 'folder-up':if(ui.folder){ui.folder=state.files.find(f=>f.id===ui.folder)?.parent||null;render()}break;
case 'create-folder':createFolder();break;
case 'create-file':createFile();break;
case 'upload':pickFiles();break;
case 'attach':pickFiles(true);break;
case 'remove-attachment':ui.attachments=ui.attachments.filter(x=>x!==id);render();break;
case 'file-menu':{const f=state.files.find(x=>x.id===id);if(f)menu(t,[{text:'Переименовать',action:'rename-file',id,icon:'rename'},...(f.kind!=='folder'?[{text:'Прикрепить к сообщению',action:'attach-existing',id,icon:'attach'},{text:'Скачать',action:'download-file',id,icon:'download'}]:[]),{separator:true},{text:'В корзину',action:'trash-file',id,icon:'trash',danger:true}]);break;}
case 'rename-file':renameDialog('file',id);break;
case 'trash-file':trashFile(id);break;
case 'attach-existing':if(!ui.attachments.includes(id))ui.attachments.push(id);render();el('composer-input')?.focus();break;
case 'preview-file':await previewFile(id);break;
case 'save-forge-checkpoint':{
 const chat=activeChat();
 const message=chat?.messages.find(item=>item.id===id);
 if(!message?.forge||message.truncated||message.forge.checkpoint)break;
 confirm('Сохранить результат Forge?','Именованные файлы из ответа будут добавлены в новую папку проекта.',async()=>{
  if(message.forge.checkpoint)return;
  const checkpoint=await saveForgeCheckpoint(chat,message.content);
  if(!checkpoint)throw new Error('Нет файлов для сохранения.');
  message.forge=forgeReport(message.content,{kind:message.forge.kind,previewReady:!!findWebsite(message),checkpoint});
 },'Сохранить');
 break;
}
case 'open-forge-checkpoint':if(state.files.some(file=>file.id===id&&!file.deleted&&file.kind==='folder')){ui.folder=id;ui.filesTab='files';ui.view='chat';state.settings.showFiles=true;const chat=activeChat();if(chat)chat.preview=null;if(studioRoute())history.replaceState(null,'',location.pathname+location.search);if(innerWidth<960)ui.mobileFiles=true;persist();render()}break;
case 'download-file':await downloadFile(id);break;
case 'edit-file':await editFile(id);break;
case 'settings':settingsDialog();break;
case 'delete-account':{
 const email=account?.email;
 if(!email)break;
 modal('Удалить аккаунт Focus?',`<form><p>Удалятся профиль, облачная копия, публикации и сессии. Чтобы сохранить локальную историю, скачай резервную копию.</p><div class="form-field"><label for="delete-email">Подтверди адрес ${e(email)}</label><input id="delete-email" name="email" type="email" required autofocus></div><p class="error-text" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost')}<button type="submit" class="btn danger">Удалить аккаунт</button></div></form>`,{onSubmit:async(data,form)=>{
  const submit=form.querySelector('[type=submit]');
  submit.disabled=true;
  try{
   const response=await fetch('/api/auth/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:data.get('email'),confirm:true})});
   if(!response.ok)throw new Error((await response.json()).error);
   try{localStorage.setItem(AUTH_EVENT_KEY,uid());}catch{}
   location.replace('/login');
  }catch(error){
   const message=form.querySelector('.error-text');
   message.hidden=false;message.textContent=error.message;submit.disabled=false;
  }
 }});
 break;
}
case 'logout':{
 t.disabled=true;
 try{
  const response=await fetch('/api/auth/logout',{method:'POST'});
  if(!response.ok)throw new Error();
  try{localStorage.setItem(AUTH_EVENT_KEY,uid());}catch{}
  location.replace('/login');
 }catch{t.disabled=false;toast('Не удалось выйти. Попробуй ещё раз.');}
 break;
}
case 'toggle-theme':state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme();persist();break;
case 'toggle-enter':t.setAttribute('aria-checked',t.getAttribute('aria-checked')!=='true');break;
case 'export-backup':await exportBackup();break;
case 'import-backup':el('import-input').value='';el('import-input').click();break;
case 'close-modal':closeModal();break;
case 'stop-generation':
 if(generation?.backgroundJob){
  try{await workspaceAPI('jobs',{action:'cancel',id:generation.backgroundJob});}catch(error){toast(error.message);}
 }else if(generation)generation.controller.abort();
 break;
case 'resume-background':{
 const chat=activeChat();
 if(chat?.backgroundJob)void recoverJob(chat);
 break;
}
case 'cancel-background':{
 const chat=activeChat();
 if(chat?.backgroundJob){
  try{await workspaceAPI('jobs',{action:'cancel',id:chat.backgroundJob});void recoverJob(chat);}
  catch(error){toast(error.message);}
 }
 break;
}
case 'retry-answer':{const c=activeChat();if(c&&!generation){const lastUser=c.messages.findLastIndex(m=>m.role==='user');if(lastUser>=0){c.messages=c.messages.slice(0,lastUser+1);persist();requestAnswer(c)}}break;}
case 'save-answer':{const m=activeChat()?.messages.find(x=>x.id===id);if(m){confirm('Сохранить ответ?','Ответ будет добавлен в текущую папку проекта как файл Markdown.',async()=>{const fId=uid(),blob=new Blob([answerMarkdown(m)],{type:'text/markdown;charset=utf-8'});await putBlob(fId,blob);let name=(activeChat().title.slice(0,40).replace(/[\\/:*?"<>|]/g,'')||'Ответ')+'.md',n=1;while(fileExists(name))name='Ответ ('+(n++)+').md';state.files.push({id:fId,project:state.activeProject,parent:ui.folder,name,kind:'file',type:'text/markdown',size:blob.size,created:Date.now(),updated:Date.now(),deleted:false});log(`Сохранён ответ «${name}»`);persist();render();toast('Ответ сохранён в файлы проекта')},'Сохранить')}break;}
case 'copy-code':{const block=codeBlockAction(t);if(block)await copy(block.code);break;}
case 'download-code':{const block=codeBlockAction(t);if(block)download(new Blob([block.code],{type:'text/plain;charset=utf-8'}),block.filename||(/^(?:html|htm)$/i.test(block.language)?'index.html':'code.txt'));break;}
case 'review-code':await reviewCodeFile(codeBlockAction(t));break;
case 'open-preview':{
 const selection={messageId:id,block:Number(t.dataset.block)};
 if(previewArtifact(activeChat(),selection))setPreview(selection);
 break;
}
case 'close-preview':setPreview(null);break;
case 'resize-preview':{
 const root=el('preview-root');
 const expanded=root.classList.toggle('preview-full');
 t.textContent=expanded?'Свернуть':'На весь экран';
 t.setAttribute('aria-pressed',String(expanded));
 break;
}
case 'reload-preview':syncPreviewPanel(previewArtifact(activeChat()),true);break;
case 'download-project':{const m=activeChat()?.messages.find(x=>x.id===id);if(!m||m.truncated)break;try{download(projectZip(projectFiles(m.content)),'project.zip');}catch(error){toast(error.message)}break;}
case 'download-answer':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)download(new Blob([answerMarkdown(m)],{type:'text/markdown;charset=utf-8'}),'Ответ.md');break;}
case 'copy-message':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)await copy(m.content);break;}
case 'edit-message':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)modal('Изменить сообщение',`<form><div class="form-field"><textarea name="content" aria-label="Текст сообщения" rows="6" required autofocus>${e(m.content)}</textarea></div><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:data=>{m.content=data.get('content').trim();activeChat().updated=Date.now();persist();closeModal();render()}});break;}
case 'delete-message':{const c=activeChat();if(c){c.messages=c.messages.filter(m=>m.id!==id);c.updated=Date.now();persist();render()}break;}
}}
document.addEventListener('click',ev=>{const t=ev.target.closest('[data-action]');if(t){ev.preventDefault();const a=t.dataset.action;if(a==='current-chat-menu'){t.dataset.id=state.activeChat;handleAction('chat-menu',t).catch(()=>toast('Не удалось выполнить действие'));return}if(!t.closest('.menu-popup'))closeMenu();else closeMenu();handleAction(a,t).catch(()=>toast('Не удалось выполнить действие'))}else if(!ev.target.closest('.menu-popup'))closeMenu()});
document.addEventListener('change',event=>{
 const input=event.target;
 if(input.matches('input[data-plan-id]'))updatePlanStep(input);
 if(input.matches('#image-studio-form input[name=image-mode]')&&input.checked){
  studio.image.mode=input.value;studio.imageError='';refreshImageStudio();
  document.querySelector('#image-studio-form input[name=image-mode]:checked')?.focus();
 }
 if(input.id==='image-format')studio.image.ratio=input.value;
});
document.addEventListener('submit',event=>{
 if(event.target.id==='composer-form'){event.preventDefault();send();}
 if(event.target.id==='code-studio-form'){event.preventDefault();startStudioTask('code');}
 if(event.target.id==='forge-studio-form'){event.preventDefault();startStudioTask('forge');}
 if(event.target.id==='site-studio-form'){event.preventDefault();startStudioSite();}
 if(event.target.id==='image-studio-form'){event.preventDefault();void generateStudioImage();}
 if(event.target.id==='tables-form'){event.preventDefault();void compareUploads(event.target);}
});
document.addEventListener('input',event=>{
 const input=event.target;
 if(input.id==='composer-input'){ui.draft=input.value;el('send-button').disabled=!generation&&!ui.draft.trim()&&!ui.attachments.length;resizeComposer();}
 if(input.id==='code-brief')studio.codeBrief=input.value;
 if(input.id==='forge-brief')studio.forgeBrief=input.value;
 if(input.id==='site-brief')studio.siteBrief=input.value;
 if(input.id==='image-brief')studio.image.brief=input.value;
});
document.addEventListener('keydown',ev=>{if(!ready)return;if(ev.key==='Escape'){if(hideSelectionAction()){ev.preventDefault();return}closeMenu();if(activeChat()?.preview&&ui.view==='chat'){setPreview(null);return}if(ui.mobileNav||ui.mobileFiles){ui.mobileNav=false;ui.mobileFiles=false;render()}}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();searchDialog()}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='n'){ev.preventDefault();closeModal();newChat()}if(ev.target.id==='composer-input'&&ev.key==='Enter'&&!ev.isComposing){if((state.settings.sendOnEnter&&!ev.shiftKey&&!ev.altKey)||(ev.ctrlKey||ev.metaKey)){ev.preventDefault();send()}}if(ui.menu&&(ev.key==='ArrowDown'||ev.key==='ArrowUp')){ev.preventDefault();const buttons=[...ui.menu.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);buttons[(i+(ev.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}});
el('file-input').addEventListener('change',ev=>uploadFiles([...ev.target.files],uploadAttach));
el('import-input').addEventListener('change',ev=>importBackup(ev.target.files[0]));
let dragDepth=0;
document.addEventListener('dragenter',ev=>{if(!ev.dataTransfer?.types.includes('Files')||ui.view!=='chat')return;ev.preventDefault();dragDepth++;if(!document.querySelector('.drop-overlay')){const d=document.createElement('div');d.className='drop-overlay';d.innerHTML=`<div>${icon('upload')}<p>Отпустите файлы, чтобы добавить в проект</p><small>До 25 МБ на файл</small></div>`;document.querySelector('.main')?.append(d)}});
document.addEventListener('dragover',ev=>{if(ev.dataTransfer?.types.includes('Files'))ev.preventDefault()});
document.addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0){document.querySelector('.drop-overlay')?.remove();dragDepth=0}});
document.addEventListener('drop',ev=>{if(!ev.dataTransfer?.files.length)return;ev.preventDefault();dragDepth=0;document.querySelector('.drop-overlay')?.remove();if(ui.view==='chat')uploadFiles([...ev.dataTransfer.files],!!ev.target.closest('.composer'))});
window.addEventListener('resize',()=>{closeMenu();if(innerWidth>=640&&ui.mobileNav){ui.mobileNav=false;render()}if(innerWidth>=960&&ui.mobileFiles){ui.mobileFiles=false;state.settings.showFiles=true;persist();render()}});
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(state.settings.theme==='system')applyTheme()});
const validCodeFilename=name=>/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name);
const splitCodeBlocks=text=>String(text).replace(/\r\n/g,'\n').split(/^[ \t]*```([^\n]*)\n([\s\S]*?)^[ \t]*```[ \t]*(?=$)/gm);
function codeBlockInfo(header){
 const [language,filename,...rest]=header.trim().split(/\s+/u);
 return {language,filename:!rest.length&&filename&&validCodeFilename(filename)?filename:null};
}
function highlightCode(code,info){
 const highlighter=globalThis.hljs;
 const hint=info.language?.toLowerCase();
 const extension=(info.filename||hint)?.split('.').at(-1);
 const language=highlighter?.getLanguage(hint||'')?hint:extension;
 if(!language||code.length>40_000||!highlighter?.getLanguage(language))return e(code);
 return highlighter.highlight(code,{language,ignoreIllegals:true}).value;
}
function codeBlockAction(button){
 const chat=activeChat();
 const message=chat?.messages.find(m=>m.id===button.dataset.id&&m.role==='assistant');
 if(!message)return;
 const parts=splitCodeBlocks(message.content);
 const index=Number(button.dataset.block);
 if(!Number.isInteger(index)||index<0||index*3+2>=parts.length)return;
 const info=codeBlockInfo(parts[index*3+1]);
 return {chat,message,...info,code:parts[index*3+2]};
}
let mountedPreview=null;
function previewArtifact(chat,selection=chat?.preview){
 if(!chat||!selection||!Number.isInteger(selection.block)||selection.block<0)return null;
 const message=chat.messages.find(item=>item.id===selection.messageId&&item.role==='assistant');
 if(!message)return null;
 const parts=splitCodeBlocks(message.content);
 const offset=selection.block*3+1;
 const header=parts[offset];
 const code=parts[offset+1];
 if(typeof header!=='string'||!isPreviewBlock(header,code))return null;
 return {chatId:chat.id,messageId:message.id,block:selection.block,filename:codeBlockInfo(header).filename||'index.html',kind:message.previewKind,code};
}
function findWebsite(message){
 if(!message||message.truncated)return null;
 const parts=splitCodeBlocks(message.content);
 for(let index=1;index+1<parts.length;index+=3){
  if(isPreviewBlock(parts[index],parts[index+1])&&(message.siteMode||/^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(parts[index+1]))){
   return {messageId:message.id,block:(index-1)/3};
  }
 }
 return null;
}
function syncPreviewPanel(artifact,reload=false){
 const root=el('preview-root');
 if(!artifact){
  if(mountedPreview){root.replaceChildren();mountedPreview=null;}
  root.classList.remove('preview-full');
  root.hidden=true;
  return;
 }
 if(!reload&&mountedPreview?.artifact.chatId===artifact.chatId&&mountedPreview.artifact.messageId===artifact.messageId&&mountedPreview.artifact.block===artifact.block&&mountedPreview.artifact.code===artifact.code)return;
 root.hidden=false;
 if(mountedPreview?.artifact.chatId!==artifact.chatId)root.classList.remove('preview-full');
 const expanded=root.classList.contains('preview-full');
 root.innerHTML=`<aside class="site-preview" aria-label="Предпросмотр">
  <header class="site-preview-header">
   <div class="site-preview-title"><strong>Предпросмотр</strong><span class="truncate">${e(artifact.filename)}</span></div>
   <div class="site-preview-actions">
    ${button('site-versions','Версии','ghost')}
    ${button('site-preview-zip','ZIP','ghost')}
    ${button('resize-preview',expanded?'Свернуть':'На весь экран','ghost',`aria-pressed="${expanded}"`)}
    ${ib('reload-preview','refresh','Перезапустить предпросмотр')}
    ${ib('close-preview','close','Закрыть предпросмотр')}
   </div>
  </header>
  <nav class="preview-tools" aria-label="Действия с результатом">
   ${button('preview-edit-section','Выбрать блок','ghost','aria-pressed="false"')}
   ${button('preview-files','Файлы','ghost')}
   ${button('preview-sources','Источники','ghost')}
  </nav>
  <iframe title="Предпросмотр" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
 </aside>`;
 const frame=root.querySelector('iframe');
 const id=uid();
 mountedPreview={artifact,frame,id,pending:true};
 frame.src='/preview.html#'+id;
}
window.addEventListener('message',event=>{
 const current=mountedPreview;
 if(current?.selecting&&event.source===current.frame.contentWindow&&event.origin==='null'&&
    event.data?.type==='focus-preview-selection'&&event.data.id===current.id){
  current.selecting=false;
  el('preview-root').querySelector('[data-action=preview-edit-section]')?.setAttribute('aria-pressed','false');
  const caption=typeof event.data.caption==='string'?event.data.caption.slice(0,180):'';
  const label=typeof event.data.label==='string'?event.data.label.slice(0,80):'блок';
  ui.draft='Измени в этом сайте блок «'+(caption||label)+'»: ';
  if(innerWidth<960)setPreview(null);
  else if(el('composer-input'))el('composer-input').value=ui.draft;
  if(el('send-button'))el('send-button').disabled=false;
  el('composer-input')?.focus();
  return;
 }
 if(!current?.pending||event.source!==current.frame.contentWindow||event.origin!=='null'||
    event.data?.type!=='focus-preview-ready'||event.data.id!==current.id||event.ports.length!==1)return;
 current.pending=false;
 event.ports[0].postMessage(current.artifact.code);
 event.ports[0].close();
});
function setPreview(selection){
 const chat=activeChat();
 if(!chat)return;
 const scroll=el('main-scroll')?.scrollTop||0;
 chat.preview=selection;
 if(selection)ui.mobileFiles=false;
 persist();
 render();
 if(el('main-scroll'))el('main-scroll').scrollTop=scroll;
 if(selection)el('preview-root').querySelector('[data-action=close-preview]')?.focus();
}
async function codeHash(text){
 if(!globalThis.crypto?.subtle)return null;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function reviewCodeFile(block){
 if(!block?.filename||!block.message.codeMode||block.message.truncated)return;
 const {chat,message,filename,code}=block;
 const targets=(Array.isArray(message.codeTargets)?message.codeTargets:[]).filter(item=>item?.name===filename);
 if(targets.length>1){toast('Уточните файл: к запросу прикреплены две версии с одинаковым именем.');return}
 const target=targets[0];
 const project=()=>state.projects.find(p=>p.id===chat.project&&!p.deleted);
 const rootEntry=()=>state.files.find(f=>f.project===chat.project&&!f.deleted&&!f.parent&&f.name.toLowerCase()===filename.toLowerCase());
 const targetFile=()=>state.files.find(f=>f.id===target?.id&&f.project===chat.project&&!f.deleted&&f.kind==='file'&&f.name===filename);
 const getOriginal=async()=>{
  const file=targetFile();
  const blob=file?await getBlob(file.id):null;
  if(!blob||!target.hash)throw Error('Исходный файл недоступен. Прикрепите актуальную версию и повторите запрос.');
  const text=await blob.text();
  if(await codeHash(text)!==target.hash)throw Error('Исходный файл изменился или был показан модели частично. Прикрепите актуальную версию и повторите запрос.');
  return {file,text};
 };
 try{
  if(!project())throw Error('Проект недоступен.');
  if(!target&&rootEntry())throw Error('Файл уже существует. Прикрепите его к запросу на исправление кода для безопасной замены.');
  const original=target?await getOriginal():null;
  modal(filename,`<form>
   ${original?codeChanges(original.text,code):''}
   ${original?`<details class="form-field"><summary>Текущая версия</summary><div class="code-block"><pre><code>${e(original.text)}</code></pre></div></details>`:''}
   <div class="form-field"><label for="proposed-code">Предложенная версия</label><textarea id="proposed-code" class="file-editor" readonly spellcheck="false">${e(code)}</textarea></div>
   <p id="code-save-error" class="error-text" hidden></p>
   <div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">${target?'Применить правку':'Сохранить файл'}</button></div>
  </form>`,{wide:true,onSubmit:async(_,form)=>{
   const submit=form.querySelector('[type=submit]');
   submit.disabled=true;
   try{
    if(!project())throw Error('Проект недоступен.');
    const file=target?(await getOriginal()).file:null;
    if(!target&&rootEntry())throw Error('Файл с таким именем уже появился в проекте.');
    const id=file?.id||uid();
    const blob=new Blob([code],{type:'text/plain;charset=utf-8'});
    await putBlob(id,blob);
    const now=Date.now();
    if(file){file.size=blob.size;file.updated=now;}
    else state.files.push({id,project:chat.project,parent:null,name:filename,kind:'file',type:'text/plain',size:blob.size,created:now,updated:now,deleted:false});
    log((file?'Изменён файл «':'Создан файл «')+filename+'»',chat.project);
    persist();closeModal();render();toast(file?'Правка применена':'Файл сохранён');
   }catch(error){
    submit.disabled=false;
    const notice=form.querySelector('#code-save-error');
    notice.textContent=error.message||'Не удалось сохранить файл.';
    notice.hidden=false;
   }
  }});
 }catch(error){toast(error.message||'Не удалось открыть предпросмотр.')}
}
const planStep=/^([ \t]*(?:[-*]|\d+\.) \[)([ xX])(\][ \t]+)(.+)$/u;
async function updatePlanStep(input){
 const message=activeChat()?.messages.find(item=>item.id===input.dataset.planId&&item.taskMode==='plan');
 if(!message)return;
 const target=Number(input.dataset.planStep);
 const blocks=splitCodeBlocks(message.content);
 let index=0;
 let changed=false;
 const next=blocks.map((part,position)=>{
  if(position%3===1)return '```'+part+'\n';
  if(position%3===2)return part+'```';
  return part.split('\n').map(line=>line.replace(planStep,(original,start,mark,end,title)=>{
   if(index++!==target)return original;
   changed=true;
   return start+(input.checked?'x':' ')+end+title;
  })).join('\n');
 }).join('');
 if(!changed)return;
 const previous=message.content;
 message.content=next;
 const chat=activeChat();
 if(chat)chat.updated=Date.now();
 if(!await persist()){
  message.content=previous;
  input.checked=!input.checked;
 }
}
function codeChanges(before,after){
 try{
  const {added,removed,changes}=compareText(before,after,80);
  if(!added&&!removed)return `<p class="settings-note">${before===after?'Изменений нет.':'Изменились переносы строк или конец файла.'}</p>`;
  return `<div class="form-field"><strong>Изменения по строкам</strong>
   <p class="settings-note">Добавлено: ${added} · Удалено: ${removed}</p>
   <div class="code-diff" aria-label="Изменения по строкам">${changes.map(({type,line,text})=>{
    const prefix=type==='added'?'+':'−';
    return `<div class="diff-line diff-${type}"><span>${prefix}${line}</span><code>${e(text.length>500?text.slice(0,500)+'…':text)}</code></div>`;
   }).join('')}</div>
   ${added+removed>changes.length?'<p class="settings-note">Показаны первые '+changes.length+' изменённых строк.</p>':''}</div>`;
 }catch{
  return '<p class="settings-note">Построчное сравнение доступно до 500 строк на версию. Полный текст обеих версий ниже.</p>';
 }
}
function markdown(text,message,request=''){
 const blocks=splitCodeBlocks(text);
 const website=findWebsite(message);
 let out='',planIndex=0;
 for(let i=0;i<blocks.length;i+=3){
  const lines=blocks[i].split('\n');
  let list='', paragraph=[];
  const closeList=()=>{if(list){out+='</'+list+'>';list='';}};
  const closeParagraph=()=>{if(paragraph.length){out+='<p>'+paragraph.map(inlineMarkdown).join(' ')+'</p>';paragraph=[];}};
  for(let j=0;j<lines.length;j++){
   const line=lines[j];
   const step=message?.taskMode==='plan'?planStep.exec(line):null;
   if(step){
    closeParagraph();closeList();
    out+=`<label class="plan-step"><input type="checkbox" data-plan-id="${e(message.id)}" data-plan-step="${planIndex++}" ${step[2]!==' '?'checked':''}><span>${inlineMarkdown(step[4])}</span></label>`;
    continue;
   }
   const table=answerTable(lines,j);
   if(table){
    closeParagraph();closeList();
    out+=table.html;j=table.end-1;
    continue;
   }
   const item=line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)/u);
   if(item){
    closeParagraph();
    const type=item[2]?'ol':'ul';
    if(list!==type){
     closeList();list=type;
     out+='<'+list+(list==='ol'&&Number(item[2])>1?' start="'+e(item[2])+'"':'')+'>';
    }
    out+='<li>'+inlineMarkdown(item[3])+'</li>';
    continue;
   }
   closeList();
   const heading=line.match(/^(#{1,4})\s+(.+)/u);
   const quote=line.match(/^\s*>\s?(.+)/u);
   if(!line.trim()){closeParagraph();continue;}
   if(heading||quote||/^\s*---+\s*$/u.test(line)){
    closeParagraph();
    if(heading){const level=heading[1].length+1;out+=`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;}
    else if(quote)out+='<blockquote>'+inlineMarkdown(quote[1])+'</blockquote>';
    else out+='<hr>';
   }else paragraph.push(line.trim());
  }
  closeParagraph();closeList();
  if(i+2>=blocks.length)continue;
  const info=codeBlockInfo(blocks[i+1]);
  const code=blocks[i+2];
  const language=info.language?.toLowerCase();
  const autoChart=language==='json'&&!message?.codeMode&&message?.model!=='local-json'&&!prefersJsonCode(request);
  if(message&&!info.filename&&(language==='focus-chart'||autoChart)){
   const chart=answerChart(code,{strictFields:autoChart});
   if(chart){out+=chart;continue;}
  }
  const attrs=message?`data-id="${e(message.id)}" data-block="${i/3}" type="button"`:'';
  const previewable=isPreviewBlock(blocks[i+1],code)&&!message?.truncated;
  const artifact=website?.block===i/3;
  const actions=message?`<span class="code-actions">${button('copy-code','Копировать','ghost',attrs)}${artifact?'':button('download-code','Скачать','ghost',attrs)}${previewable&&!artifact?button('open-preview','Предпросмотр','ghost',attrs):''}${message.codeMode&&info.filename&&!message.truncated?button('review-code','Сохранить в проект','ghost',attrs):''}</span>`:'';
  const codeBlock=`<div class="code-block"><div class="code-toolbar"><small>${e(info.filename||info.language||'Код')}</small>${actions}</div><pre><code>${highlightCode(code,info)}</code></pre></div>`;
  if(artifact){
   const label=message.previewKind==='game'?'Игра':message.previewKind==='app'?'Приложение':'Сайт';
   out+=`<section class="answer-artifact"><div class="artifact-summary"><div><strong>${label}</strong><small>${e(info.filename||'index.html')}</small></div><div class="artifact-actions">${button('open-preview','Открыть','primary',attrs+' aria-label="Предпросмотр"')}${button('download-code','Скачать HTML','ghost',attrs)}</div></div><details><summary>Посмотреть код</summary>${codeBlock}</details></section>`;
  }else out+=codeBlock;
 }
 if(message?.forge)out+=forgeCard(message.forge,message);
 return out;
}
async function attachmentPayload(ids){
 const result=[];
 let bytes=0;
 for(const id of [...new Set(ids)]){
  const file=state.files.find(item=>item.id===id&&!item.deleted&&item.kind==='file');
  if(!file)continue;
  const blob=await getBlob(id);
  if(!blob)continue;
  if(isText(file)&&blob.size<500000){
   result.push({id,name:file.name,text:await blob.text()});
   continue;
  }
  if(officeFilename(file.name)){
   try{
    const extracted=await officeText(new File([blob],file.name));
    if(extracted.text)result.push({id,name:file.name,...extracted});
    else toast('В файле «'+file.name+'» нет текста для анализа');
   }catch(error){toast('«'+file.name+'» — '+error.message);}
   continue;
  }
  if(['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)&&
     blob.size<5*1048576&&bytes+blob.size<6*1048576){
   bytes+=blob.size;
   const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(blob);
   });
   result.push({name:file.name,mimeType:file.type,data});
   continue;
  }
  toast('«'+file.name+'» сохранён в проекте. Для анализа прикрепите текст, офисный файл, PDF или изображение до 5 МБ.');
 }
 return result;
}
async function requestAnswer(c,approved=false){
 if(generation)return;
 c.error=null;c.pendingSearch=null;
 const controller=new AbortController();const lastUser=c.messages.findLast(m=>m.role==='user');
 const action=resolveAction(lastUser?.content,{local:localIntent,task:taskIntent,site:buildIntent,image:imageIntent,native:nativeBuildIntent,project:projectSearchQuery});
 const projectQuery=action.projectQuery??null;
 const localMode=action.local?.mode;
 const localSkill=!!localMode||!!(action.locals&&!action.task)||projectQuery!==null;
 const fileModes=['csv','diff','json','csvdiff'];
 const fileSkill=fileModes.includes(localMode)||action.locals?.some(skill=>fileModes.includes(skill.mode));
 const recentAnswer=c.messages.slice(0,c.messages.lastIndexOf(lastUser)).findLast(message=>message.role==='assistant');
 const codeFollowUp=recentAnswer?.codeMode&&codeFollowUpIntent(lastUser?.content);
 const taskMode=action.task?.mode||(codeFollowUp?'code':null);
 const explicitSearch=action.web;
 const previousImage=latestImage(c.messages);
 const preferredVersion=c.messages.find(message=>message.id===c.siteVersion);
 const priorWebsite=previewArtifact(c)||previewArtifact(c,findWebsite(preferredVersion))||previewArtifact(c,findWebsite(recentAnswer));
 const revisionPhrases=action.phrases||[{visible:action.input}];
 const revision=priorWebsite&&!action.nativeProject&&!action.locals&&!action.splitActions&&!localSkill&&!explicitSearch&&!action.image&&(!taskMode||taskMode==='code')&&revisionPhrases.some(({visible})=>
  isSiteRevision(visible)&&(!/(?:изображени|картинк|фотографи|постер|обложк)/iu.test(visible)||/(?:сайт|страниц|секци|шапк|футер)/iu.test(visible)));
 const contextualImage=!action.splitActions&&previousImage&&action.phrases?.find(({visible})=>imageIntent(visible,true));
 const siteDetails=recentAnswer?.model==='local-site-question'&&lastUser?.content?.trim()&&
  !action.splitActions&&!localSkill&&!taskMode&&!explicitSearch&&!/^\s*(?:\/|кто\b|почему\b|как\b|объясни\s|расскажи\s|сделай\s+кратк)/iu.test(lastUser.content)&&!action.image&&!contextualImage;
 const updating=revision&&(!action.previewKind||
  ((priorWebsite.kind||'site')===action.previewKind&&updatesBuild(action.input)));
 const previewKind=action.previewKind||(updating?(priorWebsite.kind||'site'):siteDetails&&!action.nativeProject?'site':null);
 const website=!!previewKind;
 const codeMode=taskMode==='code'||website;
 const forge=forgeIntent(action.input,{previewKind,taskMode,codeFollowUp});
 const imageRequest=website||taskMode||localSkill||explicitSearch?null:action.image||(contextualImage&&imageIntent(contextualImage.input,true));
 const automaticAction=imageRequest?'изображение':website?{site:'сайт',app:'приложение',game:'игра'}[previewKind]:action.nativeProject?'проект с кодом':null;
 if(automaticAction&&!approved){
  const notice=imageRequest?IMAGE_COST_NOTICE:'Focus отправит запрос модели для подготовки результата.';
  confirm('Распознано действие: '+automaticAction,notice,()=>{
   queueMicrotask(()=>void requestAnswer(c,true));
  },'Запустить');
  return;
 }
 const researchPlan=lastUser?.researchPlan;
 const background=!!account&&researchPlan?.background;
 const withSearch=!action.splitActions&&!action.locals&&(!!lastUser?.webSearch||explicitSearch||researchPlan?.sources==='web')&&researchPlan?.sources!=='files'&&!localSkill&&!imageRequest&&!website;
 generation={chatId:c.id,controller,text:'',phase:imageRequest?'imaging':withSearch?'searching':'answering',forge:!!forge};
 const refresh=()=>{if(ui.view==='chat'&&state.activeChat===c.id){render();const scroll=el('main-scroll');if(scroll)scroll.scrollTop=scroll.scrollHeight}};
 refresh();
 try{
  if(action.splitActions){
   c.messages.push({id:uid(),role:'assistant',content:SPLIT_ACTIONS,model:'local-focus-info',at:Date.now()});
   c.updated=Date.now();
   return;
  }
  if(projectQuery!==null){
   const files=projectTextFiles(c.project).sort((a,b)=>a.path.localeCompare(b.path,'ru'));
   const {results,scanned,limited}=await searchProjectFiles(files,projectQuery,readProjectText,controller.signal);
   const summary=(results.length?'Совпадений: '+results.length+'.':'Совпадений не найдено.')+
    ' Проверено файлов: '+scanned+'.'+(limited?' Показан результат в пределах лимита поиска.':'');
   const details=results.map(match=>match.path+':'+match.line+' — '+match.snippet);
   c.messages.push({id:uid(),role:'assistant',content:[summary,...details].join('\n'),model:'local-project-search',
    projectSearch:{query:projectQuery,summary,results},at:Date.now()});
   c.updated=Date.now();
   return;
  }
  let searchId;
  if(withSearch&&!background){
   const query=researchPlan?.question||(explicitSearch?searchQuery([{role:'user',content:action.input}]):searchQuery(c.messages));
   if(!query)throw new Error('Для поиска добавьте текст вопроса.');
   generation.query=query;
   const response=await fetch('/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,...(researchPlan?{queries:researchPlan.queries}:{})}),signal:controller.signal});
   if(response.status===401&&account){location.replace('/login');return;}
   let research;try{research=await response.json()}catch{throw new Error('Не удалось прочитать результаты поиска.')}
   if(!response.ok)throw new Error(research.error||'Поиск не выполнен. Попробуйте позже.');
   searchId=research.searchId;
   c.pendingSearch={query:research.query,sources:research.sources,searchedAt:research.searchedAt,queries:research.queries,failedQueries:research.failedQueries};
   generation.sources=research.sources;generation.phase='answering';persist();refresh();
  }
  const projectFiles=localSkill||action.locals||imageRequest?[]:projectTextFiles(c.project).filter(file=>file.size<100000);
  let reference;
  if(imageRequest?.mode==='edit'){
   const file=state.files.find(f=>f.id===previousImage?.imageFile&&!f.deleted);
   const blob=file?await getBlob(file.id):null;
   if(!blob)throw new Error('Последнее изображение недоступно. Создайте новое изображение в этом диалоге.');
   reference=await imageReference(blob);
  }
  const messages=(localSkill||imageRequest)
   ?[{role:'user',content:lastUser.content,...(lastUser.quote?{quote:lastUser.quote}:{}),...(fileSkill?{attachments:await attachmentPayload(lastUser.files||[])}:{})}]
   :await buildChatContext(c.messages,projectFiles,attachmentPayload,
    updating?{name:'Текущая версия предпросмотра — '+priorWebsite.filename,text:priorWebsite.code}:null);
  const instructions=state.projects.find(item=>item.id===c.project)?.instructions;
  if(instructions&&!localSkill&&!imageRequest)messages.at(-1).projectInstructions=instructions;
  if(researchPlan?.sources==='files'&&!messages.at(-1)?.attachments?.length){
   throw new Error('Добавь материалы в проект для исследования по файлам.');
  }
  const codeTargets=codeMode?await Promise.all((messages.at(-1)?.attachments||[])
   .filter(file=>lastUser.files?.includes(file.id)&&typeof file.text==='string')
   .map(async file=>({id:file.id,name:file.name,hash:file.truncated?null:await codeHash(file.text)}))):[];
  const input={messages,...(website?{sitePreview:true,previewKind}:{}),...(codeFollowUp?{codeContext:true}:{}),...(forge?{forgeMode:true,forgeKind:forge.kind}:{}),...(reference?{imageReference:reference}:{}),effort:state.settings.effort,...(searchId?{searchId}:{})};
  let data;
  if(background){
   const jobId=uid();
   c.backgroundJob=jobId;
   generation.backgroundJob=jobId;
   persist();
   try{
    await workspaceAPI('jobs',{action:'start',id:jobId,input,
     ...(withSearch?{research:{query:researchPlan.question,queries:researchPlan.queries}}:{})});
   }catch(error){delete c.backgroundJob;throw error;}
   data=await pollJob(jobId,controller.signal);
   delete c.backgroundJob;
   if(data.error)throw new Error(data.error);
  }else{
   const headers={'content-type':'application/json',...(!website&&!imageRequest&&!localSkill?{accept:'text/event-stream'}:{})};
  const response=await fetch('/api/chat',{method:'POST',headers,body:JSON.stringify(input),signal:controller.signal});
  if(response.status===401&&account){location.replace('/login');return;}
  if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){
   for await(const event of eventStream(response.body)){
    const value=JSON.parse(event);
    if(value.error)throw new Error(value.error);
    if(value.result)data=value.result;
    if(value.delta){
     generation.text+=value.delta;
     const node=el('stream-text'),scroll=el('main-scroll');
     const follow=scroll&&scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<120;
     if(node)node.textContent=generation.text;
     if(follow)scroll.scrollTop=scroll.scrollHeight;
    }
   }
   if(!data)throw new Error('Поток завершился без ответа.');
  }else{
   try{data=await response.json()}catch{throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')}
  }
  if(!response.ok)throw new Error(data.error||'Не удалось получить ответ');
  }
  if(!data.text)throw new Error('Получен пустой ответ');
  const imageFile=data.image?await saveGeneratedImage(data.image,c.project):null;
  const answer={id:uid(),role:'assistant',...(website?{siteMode:true,previewKind}:{}),...(taskMode?{taskMode}:{}),...(codeMode?{codeMode,codeTargets}:{}),...(imageFile?{imageFile}:{}),content:data.text,at:Date.now(),model:data.model||apiStatus.model||'Модель',usage:data.usage,truncated:!!data.truncated,...(data.search?{search:data.search}:{})};
  const nextPreview=findWebsite(answer);
  if(forge){
   answer.forge=forgeReport(data.text,{kind:forge.kind,truncated:!!data.truncated,previewReady:!!nextPreview});
  }
  c.messages.push(answer);
  if(nextPreview){c.preview=null;c.siteVersion=nextPreview.messageId;}
  c.pendingSearch=null;c.updated=Date.now();if(data.provider!=='local'&&data.provider!=='image')apiStatus.configured=true;
 }catch(err){c.error=err.name==='AbortError'?'Запрос остановлен. Его можно повторить.':err.message||'Не удалось получить ответ';}
 finally{
  generation=null;persist();refresh();
  if(ui.view==='sites')render();
  if(ui.view==='images')refreshImageStudio();
 }
}
async function boot(){
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});
  if(response.status!==404){
   if(!response.ok)throw new Error();
   const session=await response.json();
   if(session.enabled&&!session.user){location.replace('/login');return;}
   account=session.user;
  }
  selectStorageScope(account?.id);
  state=await readState();
  if(account)try{
   cloudRevision=Number(localStorage.getItem('focus.cloud-revision.'+account.id))||null;
   cloudAuto=localStorage.getItem('focus.cloud-auto.'+account.id)==='1';
  }catch{}
  ready=true;
  ui.view=studioRoute()||'chat';
  render();
  if(account)for(const chat of state.chats.filter(item=>item.backgroundJob&&!item.deleted))void recoverJob(chat);
  fetch('/api/status').then(r=>r.json()).then(d=>{apiStatus=d;render()}).catch(()=>{});
  const oldImageCode=account?savedImagePass():null;
  if(oldImageCode)void updateAccount('subscription',{code:oldImageCode}).then(()=>{
   sessionStorage.removeItem(imagePassKey());
   refreshImageStudio();
  }).catch(()=>{});
 }catch{
  app.innerHTML='<section class="welcome"><div class="welcome-inner"><h1>Не удалось открыть Focus</h1><p class="welcome-sub">Проверь подключение и обнови страницу.</p></div></section>';
 }
}
window.addEventListener('storage',event=>{if(event.key===AUTH_EVENT_KEY)location.reload();});
window.addEventListener('pageshow',event=>{if(event.persisted&&account)location.reload();});



function tablesView(){
 return `<section class="studio">
  <header class="studio-hero"><h1>Сверка таблиц</h1><p>Сравни две выгрузки CSV или первые листы XLSX по общему столбцу.</p></header>
  <form class="studio-panel studio-form focus-form" id="tables-form">
   <div class="form-field"><label for="table-before">Исходная выгрузка</label><input id="table-before" name="before" type="file" accept=".csv,.xlsx" required></div>
   <div class="form-field"><label for="table-after">Новая выгрузка</label><input id="table-after" name="after" type="file" accept=".csv,.xlsx" required></div>
   <div class="form-field"><label for="table-key">Ключевой столбец</label><input id="table-key" name="key" value="id" maxlength="100" required></div>
   <button class="studio-primary" type="submit">Сравнить</button>
  </form>
  <section class="studio-section" id="table-result" aria-live="polite"></section>
 </section>`;
}
async function compareUploads(form){
 const submit=form.querySelector('button[type="submit"]');
 const result=el('table-result');
 submit.disabled=true;
 result.textContent='Читаю таблицы…';
 try{
  const values=new FormData(form);
  const [before,after]=await Promise.all([openTable(values.get('before')),openTable(values.get('after'))]);
  const comparison=compareTables(before,after,String(values.get('key')).trim());
  result.innerHTML=`<div class="studio-panel"><h2>Результат сверки</h2>
   <dl class="table-totals">
    <div><dt>Добавлено</dt><dd>${comparison.added}</dd></div>
    <div><dt>Удалено</dt><dd>${comparison.removed}</dd></div>
    <div><dt>Изменено</dt><dd>${comparison.modified}</dd></div>
    <div><dt>Совпало</dt><dd>${comparison.matched}</dd></div>
   </dl><button class="studio-primary" type="button">Скачать XLSX</button></div>`;
  result.querySelector('button').onclick=()=>{
   try{download(createWorkbook(comparison.sheets),'focus-сверка.xlsx');}catch(error){toast(error.message);}
  };
 }catch(error){result.textContent=error.message;}
 finally{submit.disabled=false;}
}

async function showSiteVersions(id){
 const chat=state.chats.find(item=>item.id===id&&!item.deleted);
 if(!chat)return;
 const versions=chat.messages.filter(message=>findWebsite(message));
 let pages=[];
 if(account){
  try{({pages}=await workspaceAPI('publications'));}
  catch(error){toast(error.message);}
 }
 modal('Версии сайта',versions.length?`<ul class="version-list">${versions.map((message,index)=>{
  const page=pages.find(item=>item.chatId===id&&item.version===message.id);
  return `<li><div><strong>Версия ${index+1}</strong><small>${e(date(message.at))} · ${e(time(message.at))}${chat.siteVersion===message.id?' · Текущая':''}</small></div>
   <div class="version-actions">${button('site-version-open','Открыть','',`data-id="${e(id)}" data-version="${e(message.id)}"`)}${index?button('site-version-diff','Что изменилось','ghost',`data-id="${e(id)}" data-version="${e(message.id)}"`):''}
   ${page?`<a class="btn" href="/p/${e(page.id)}" target="_blank" rel="noopener noreferrer">Публичная ссылка</a>
    ${button('site-unpublish','Снять с публикации','ghost',`data-id="${e(page.id)}" data-chat="${e(id)}"`)}`
    :account?button('site-publish','Опубликовать','ghost',`data-id="${e(id)}" data-version="${e(message.id)}"`):''}</div></li>`;
 }).reverse().join('')}</ul>`:'<p>Пока нет готовых версий.</p>',{wide:true});
}
async function publishVersion(id,version){
 const chat=state.chats.find(item=>item.id===id&&!item.deleted);
 const selection=findWebsite(chat?.messages.find(item=>item.id===version));
 const artifact=selection&&previewArtifact(chat,selection);
 if(!artifact)return;
 confirm('Опубликовать эту версию?','Сайт сможет открыть любой человек со ссылкой.',async()=>{
  try{
   const {path}=await workspaceAPI('publications',{action:'create',chatId:id,version,title:chat.title.slice(0,120),html:artifact.code});
   const url=new URL(path,location.origin);
   setTimeout(()=>modal('Версия опубликована',`<p class="dialog-description">Ссылка на выбранную версию</p><a href="${e(url.href)}" target="_blank" rel="noopener noreferrer">${e(url.href)}</a>`),0);
  }catch(error){toast(error.message);}
 },'Опубликовать');
}
function removePublication(id){
 confirm('Снять версию с публикации?','По этой ссылке сайт больше не откроется.',async()=>{
  try{await workspaceAPI('publications',{action:'remove',id});toast('Публикация снята');}
  catch(error){toast(error.message);}
 },'Снять');
}
function officeExport(id){
 const chat=activeChat();
 const message=chat?.messages.find(item=>item.id===id&&item.role==='assistant');
 if(!message)return;
 const title=chat.title.replace(/[\\/:*?"<>|]/g,'').slice(0,70)||'Focus';
 const dialog=modal('Экспорт ответа',`<div class="version-actions"><button class="btn" type="button" data-format="docx">Документ Word</button>
  <button class="btn" type="button" data-format="pptx">Презентация PowerPoint</button></div>`);
 for(const control of dialog.querySelectorAll('[data-format]'))control.onclick=()=>{
  try{
   const format=control.dataset.format;
   download(format==='docx'?createDocument(title,answerMarkdown(message)):createSlides(title,answerMarkdown(message)),title+'.'+format);
  }catch(error){toast(error.message);}
 };
}
function researchDialog(){
 modal('Исследовать тему',`<form class="focus-form">
  <div class="form-field"><label for="research-topic">Вопрос исследования</label><textarea id="research-topic" name="topic" maxlength="400" required>${e(ui.draft)}</textarea></div>
  <div class="form-field"><label for="research-sources">Источники</label><select id="research-sources" name="sources">
   <option value="web">Интернет и файлы проекта</option><option value="files">Только файлы проекта</option>
  </select></div>
  <div class="form-field"><label for="research-queries">Дополнительные запросы, до двух</label>
   <textarea id="research-queries" name="queries" maxlength="900" rows="2" placeholder="По одному на строку. Можно оставить пустым"></textarea>
  </div>
  ${account?'<label><input name="background" type="checkbox" checked> Продолжать в фоне после закрытия вкладки</label>':''}
  <button class="btn primary" type="submit">Начать исследование</button>
 </form>`,{onSubmit(data){
  if(generation){toast('Дождитесь текущего ответа');return;}
  const question=String(data.get('topic')).trim();
  const sources=data.get('sources');
  if(!question)return;
  if(sources==='web'&&!apiStatus.searchConfigured){toast('Веб-поиск ещё не подключён');return;}
  const custom=String(data.get('queries')).split(/\n/u).map(value=>value.trim()).filter(Boolean).slice(0,2);
  const additional=custom.length?custom:[question+' первоисточники',question+' ограничения и противоречия'];
  pendingResearch={question,sources,queries:additional,background:data.has('background')};
  ui.draft='/evidence '+question;
  closeModal();
  send();
 }});
}

async function cloudWorkspace(){
 if(!account)return;
 if(generation||studio.imageController){toast('Дождитесь завершения текущей задачи');return;}
 try{
  const remote=await workspaceAPI('workspace');
  const stale=remote.revision>0&&cloudRevision!==remote.revision;
  const panel=modal('Синхронизация пространства',`<p class="dialog-description">${remote.revision
   ?'Копия в аккаунте обновлена '+date(remote.updated)+'.'
   :'В аккаунте пока нет копии. Можно перенести в него проекты из этого браузера.'}</p>
   ${stale?'<p class="settings-note">Сначала загрузите актуальную копию. Локальную историю можно сохранить кнопкой резервного копирования.</p>':''}
   <p><label><input id="workspace-auto" type="checkbox" ${cloudAuto?'checked':''} ${stale?'disabled':''}> Автоматически сохранять изменения с этого устройства</label></p>
   <div class="version-actions"><button class="btn" type="button" id="workspace-backup">Скачать резервную копию</button>
   ${remote.revision?'<button class="btn" type="button" id="workspace-pull">Загрузить из аккаунта</button>':''}
   <button class="btn primary" type="button" id="workspace-push" ${stale?'disabled':''}>Сохранить в аккаунт</button></div>`);
  panel.querySelector('#workspace-backup').onclick=exportBackup;
  panel.querySelector('#workspace-auto').onchange=event=>{
   setCloudAuto(event.currentTarget.checked);
   if(cloudAuto)scheduleCloudSave();
  };
  panel.querySelector('#workspace-push').onclick=async event=>{
   const control=event.currentTarget;
   control.disabled=true;
   clearTimeout(cloudTimer);
   if(cloudSaving){control.disabled=false;toast('Сохранение уже выполняется');return;}
   cloudSaving=true;
   try{
    const snapshot=await snapshotWorkspace(state,getBlob);
    const saved=await workspaceAPI('workspace',{revision:cloudRevision??remote.revision,snapshot});
    setCloudRevision(saved.revision);
    toast('Пространство сохранено в аккаунте');
    closeModal();
   }catch(error){toast(error.message);}
   finally{cloudSaving=false;control.disabled=false;}
  };
  const pull=panel.querySelector('#workspace-pull');
  if(pull)pull.onclick=()=>confirm('Загрузить пространство из аккаунта?','Диалоги и файлы в этом браузере будут заменены сохранённой копией.',async()=>{
   try{
    const latest=await workspaceAPI('workspace');
    if(!validBackup(latest.snapshot))throw new Error('Копия недоступна.');
    const {state:restored,blobs}=decodeWorkspace(latest.snapshot);
    const next={...fresh(),...restored,settings:{...fresh().settings,...restored.settings}};
    await replaceWorkspace(next,blobs);
    state=next;
    setCloudRevision(latest.revision);
    Object.assign(ui,{view:'chat',draft:'',quote:null,attachments:[],folder:null});
    render();
    toast('Пространство загружено');
   }catch(error){toast(error.message);}
  },'Загрузить');
 }catch(error){toast(error.message);}
}

function setCloudRevision(revision){
 cloudRevision=revision;
 try{localStorage.setItem('focus.cloud-revision.'+account.id,String(revision));}catch{}
}
async function pollJob(id,signal){
 for(let attempt=0;attempt<100;attempt++){
  signal?.throwIfAborted();
  const job=await workspaceAPI('jobs?id='+encodeURIComponent(id));
  if(job.state==='done')return job.result;
  if(job.state==='failed')return job.result||{error:'Фоновая задача завершилась ошибкой.'};
  if(job.state==='cancelled')return {error:'Исследование остановлено.'};
  if(job.state==='interrupted')return {error:'Сервер перезапустился. Запусти исследование ещё раз.'};
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw new Error('Задача ещё выполняется. Можно проверить результат позже.');
}
const recoveringJobs=new Set();
async function recoverJob(chat){
 const id=chat.backgroundJob;
 if(!id||recoveringJobs.has(id)||generation?.backgroundJob===id)return;
 recoveringJobs.add(id);
 try{
  const result=await pollJob(id);
  if(chat.backgroundJob!==id)return;
  if(result.text)chat.messages.push({id,role:'assistant',content:result.text,at:Date.now(),model:result.model,
   truncated:!!result.truncated,...(result.search?{search:result.search}:{})});
  else chat.error=result.error;
  delete chat.backgroundJob;
  chat.updated=Date.now();
  persist();
  if(ui.view==='chat'&&activeChat()?.id===chat.id)render();
 }catch(error){
  if(error.status===404){delete chat.backgroundJob;chat.error=error.message;persist();if(activeChat()?.id===chat.id)render();}
  else if(activeChat()?.id===chat.id)toast(error.message);
 }finally{recoveringJobs.delete(id);}
}

boot();

function showSiteDiff(id,version){
 const chat=state.chats.find(item=>item.id===id&&!item.deleted);
 const versions=chat?.messages.filter(message=>findWebsite(message))||[];
 const index=versions.findIndex(message=>message.id===version);
 if(index<=0)return;
 const previous=previewArtifact(chat,findWebsite(versions[index-1]));
 const current=previewArtifact(chat,findWebsite(versions[index]));
 try{
  const diff=compareText(previous.code,current.code,80);
  modal('Что изменилось',`<p class="dialog-description">Добавлено строк ${diff.added} · Удалено строк ${diff.removed}</p>
   <pre class="version-diff">${e(diff.changes.map(change=>(change.type==='added'?'+ ':'− ')+change.line+' '+change.text).join('\n')||'Версии совпадают')}</pre>`,{wide:true});
 }catch(error){toast(error.message);}
}

function setCloudAuto(enabled){
 cloudAuto=enabled;
 if(!enabled)clearTimeout(cloudTimer);
 try{localStorage.setItem('focus.cloud-auto.'+account.id,enabled?'1':'0');}catch{}
}
function scheduleCloudSave(){
 if(!cloudAuto||!account)return;
 clearTimeout(cloudTimer);
 cloudTimer=setTimeout(async()=>{
  if(!cloudAuto||!account)return;
  if(cloudSaving){scheduleCloudSave();return;}
  cloudSaving=true;
  const revision=localRevision;
  const expected=cloudRevision??0;
  try{
   const snapshot=await snapshotWorkspace(state,getBlob);
   if(revision!==localRevision||!cloudAuto)return;
   const saved=await workspaceAPI('workspace',{revision:expected,snapshot});
   setCloudRevision(saved.revision);
  }catch(error){
   setCloudAuto(false);
   toast(error.status===409?'Изменения есть на другом устройстве. Откройте синхронизацию в настройках.':error.message);
  }finally{cloudSaving=false;}
 },1800);
}
