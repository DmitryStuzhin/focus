import {imageIntent,latestImage,imageReference} from './image-intent.js';
import {buildChatContext,searchQuery} from './chat-context.js';
import {sourcePills,sourcesDialog,linkCitations} from './search-ui.js';
import {icon,mark} from './icons.js';
import {uid,readState,writeState,fresh,putBlob,getBlob,deleteBlob,validBackup} from './store.js';
const app=document.querySelector('#app');
const MODEL_LABEL='Guzan 1.1';
let state=readState();
let ui={view:'chat',archive:false,filesTab:'files',folder:null,collapsed:new Set(),sidebarClosed:false,mobileNav:false,mobileFiles:false,draft:'',attachments:[],menu:null,sort:'name'};
let toastTimer,uploadAttach=false,objectURLs=[],generation=null,apiStatus={configured:false,model:'',label:MODEL_LABEL};
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById(id);
const activeProject=()=>state.projects.find(p=>p.id===state.activeProject&&!p.deleted)||state.projects.find(p=>!p.deleted);
const activeChat=()=>state.chats.find(c=>c.id===state.activeChat&&!c.deleted);
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
function persist(){try{writeState(state);return true}catch(err){toast('Не удалось сохранить изменения: хранилище браузера заполнено');return false}}
function log(text,project=activeProject()?.id){state.changes.unshift({id:uid(),text,project,at:Date.now()});state.changes=state.changes.slice(0,400)}
function toast(text){clearTimeout(toastTimer);const t=el('toast');t.textContent=text;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),4200)}
let generatedURLs=[];
function render(){
 generatedURLs.forEach(url=>URL.revokeObjectURL(url));generatedURLs=[];
 applyTheme();
 const p=activeProject();if(p)state.activeProject=p.id;
 const showFiles=state.settings.showFiles&&ui.view==='chat';
 app.innerHTML=`<div class="shell ${showFiles?'':'no-files'} ${ui.sidebarClosed?'sidebar-collapsed':''}">
 ${sidebar()}<button class="sidebar-shade" aria-label="Закрыть навигацию" data-action="close-nav"></button>
 <main class="main" ${ui.mobileNav||ui.mobileFiles?'inert':''}>${header()}<div class="main-scroll" id="main-scroll">${ui.view==='chat'?chatView():ui.view==='workspace'?workspaceView():collectionView()}</div>${ui.view==='chat'?composer():''}</main>
 ${ui.view==='chat'?filesPanel(showFiles):''}</div>`;
 for(const img of app.querySelectorAll('[data-generated-file]')){
  getBlob(img.dataset.generatedFile).then(blob=>{
   if(!blob||!img.isConnected)return;
   const url=URL.createObjectURL(blob);generatedURLs.push(url);img.src=url;
  }).catch(()=>{img.alt='Изображение недоступно на этом устройстве'});
 }
 if(ui.view==='chat')resizeComposer();
}
function sidebar(){
 return `<aside class="sidebar ${ui.mobileNav?'mobile-open':''}" aria-label="Навигация" ${(innerWidth<640&&!ui.mobileNav)||(innerWidth>=640&&ui.sidebarClosed)?'inert':''}><div class="brand-row"><button class="brand" data-action="workspace" aria-label="Focus — рабочее пространство">Focus</button>${ib('toggle-sidebar','panel','Свернуть навигацию')}</div>
 <nav class="nav-group"><button class="nav-row new-chat" data-action="new-chat">${icon('compose')}<span>Новый диалог</span><kbd class="keycap">⌘ N</kbd></button><button class="nav-row" data-action="search">${icon('search')}<span>Поиск</span><kbd class="keycap">⌘ K</kbd></button><button class="nav-row ${ui.view==='workspace'?'active':''}" data-action="workspace">${icon('grid')}<span>Рабочее пространство</span></button></nav>
 <div class="projects-heading"><span>Проекты</span>${ib('create-project','plus','Создать проект')}</div>
 <div class="sidebar-tabs" role="tablist" aria-label="Состояние диалогов"><button class="tab ${!ui.archive?'active':''}" role="tab" aria-selected="${!ui.archive}" data-action="tab-dialogs">Диалоги</button><button class="tab ${ui.archive?'active':''}" role="tab" aria-selected="${ui.archive}" data-action="tab-archive">Архив</button></div>
 <nav class="project-tree" aria-label="Проекты и диалоги">${liveProjects().map(p=>{const chats=state.chats.filter(c=>c.project===p.id&&!c.deleted&&!!c.archived===ui.archive).sort((a,b)=>b.updated-a.updated);return `<div class="project-row ${p.id===state.activeProject?'active':''}"><button class="project-link" data-action="select-project" data-id="${p.id}">${icon('chevron',`caret ${ui.collapsed.has(p.id)?'':'open'}`)}${icon('folder')}<span class="truncate">${e(p.name)}</span></button><button class="icon-btn row-more" data-action="project-menu" data-id="${p.id}" aria-label="Действия с проектом ${e(p.name)}">${icon('more')}</button></div>${ui.collapsed.has(p.id)?'':`<div class="chat-list">${chats.map(c=>`<div class="chat-row ${c.id===state.activeChat&&ui.view==='chat'?'active':''}"><button class="chat-link truncate" data-action="select-chat" data-id="${c.id}">${e(c.title)}</button><button class="icon-btn row-more" data-action="chat-menu" data-id="${c.id}" aria-label="Действия с диалогом ${e(c.title)}">${icon('more')}</button></div>`).join('')}</div>`}`}).join('')}${liveProjects().length?'':`<p class="empty-nav">Создайте проект, чтобы начать</p>`}</nav>
 <div class="sidebar-footer"><button class="nav-row ${ui.view==='trash'?'active':''}" data-action="trash">${icon('trash')}<span>Корзина</span>${trashCount()?`<span style="margin-left:auto;font-size:11px">${trashCount()}</span>`:''}</button><button class="profile" data-action="settings"><span class="avatar">${e((state.settings.name||'М')[0].toUpperCase())}</span><span class="profile-label"><strong class="truncate">${e(state.settings.name)}</strong><small>Личное пространство</small></span>${icon('settings')}</button></div></aside>`;
}
function header(){let title=ui.view==='workspace'?'Рабочее пространство':ui.view==='trash'?'Корзина':ui.view==='archive'?'Архив':activeProject()?.name||'Новый диалог';return `<header class="topbar"><div class="topbar-title">${ib('toggle-sidebar','menu','Открыть навигацию',ui.sidebarClosed?'':`class="mobile-only"`)}<span class="truncate">${e(title)}</span>${ui.view==='chat'&&activeChat()?`<span class="top-divider desktop-only"></span><span class="truncate desktop-only" style="color:var(--muted);font-size:12px;font-weight:400">${e(activeChat().title)}</span>`:''}</div><div class="topbar-actions">${themeButton()}${ui.view==='chat'?`<button class="status" data-action="model-info" title="Статус подключения"><span class="status-dot"></span>${apiStatus.configured?e(MODEL_LABEL):'Не подключено'}</button><span class="top-divider"></span>${activeChat()?ib('current-chat-menu','more','Действия с диалогом'):''}${ib('toggle-files','panel','Показать или скрыть файлы',`aria-pressed="${state.settings.showFiles}"`)}`:button('new-chat',`${icon('plus')} Новый диалог`,'ghost')}</div></header>`}
function chatView(){const c=activeChat();if(!c||!c.messages.length)return `<section class="welcome"><div class="welcome-inner">${mark}<h1>Над чем поработаем?</h1><p class="welcome-sub">От первой мысли до готового результата</p><div class="suggestions"><button class="suggestion" data-action="prompt" data-prompt="/image ">${icon('image')}Создать изображение</button><button class="suggestion" data-action="prompt" data-prompt="/design ">${icon('poster')}Постер или обложка</button><button class="suggestion" data-action="prompt" data-prompt="/code ">${icon('code')}Написать код</button><button class="suggestion" data-action="prompt" data-prompt="Подготовь документ на тему: ">${icon('file')}Создать документ</button><button class="suggestion" data-action="prompt" data-prompt="Собери презентацию на 8 слайдов о ">${icon('slides')}Собрать презентацию</button><button class="suggestion" data-action="prompt" data-prompt="Создай таблицу для ">${icon('table')}Сделать таблицу</button><button class="suggestion" data-action="prompt" data-prompt="Помоги составить пошаговый план для ">${icon('plan')}Продумать план</button></div></div></section>`;
 return `<section class="messages" aria-label="Сообщения диалога">${c.messages.map(m=>m.role==='assistant'?`<article class="assistant-message"><div class="assistant-label">Focus <span>${e(m.model==='local-calculator'?'Калькулятор':m.model==='local-statistics'?'Статистика':m.model==='local-conversion'?'Конвертер':m.model==='local-csv'?'Анализ CSV':m.model==='local-diff'?'Сравнение файлов':MODEL_LABEL)}</span></div>${sourcePills({...m.search,owner:m.id})}<div class="markdown">${m.model==='local-diff'?'<div class="code-block"><pre><code>'+e(m.content)+'</code></pre></div>':linkCitations(markdown(m.content,m),m.search)}</div>${m.imageFile&&state.files.some(f=>f.id===m.imageFile&&!f.deleted)?'<figure class="generated-image"><img data-generated-file="'+e(m.imageFile)+'" alt="Сгенерированное изображение" /><button class="btn" data-action="download-file" data-id="'+e(m.imageFile)+'">Скачать изображение</button></figure>':''}<div class="assistant-actions">${ib('copy-message','copy','Скопировать ответ',`data-id="${m.id}"`)}${ib('save-answer','file','Сохранить ответ в файл',`data-id="${m.id}"`)}${ib('download-answer','download','Скачать ответ',`data-id="${m.id}"`)}${ib('retry-answer','refresh','Повторить ответ')}${m.truncated?'<small>Достигнута максимальная длина ответа</small>':''}</div></article>`:`<article class="message">${m.files?.length?`<div class="message-files">${m.files.map(id=>{const f=state.files.find(x=>x.id===id&&!x.deleted);return f?`<button class="message-file" data-action="preview-file" data-id="${f.id}">${icon(fileIcon(f))}<span class="truncate">${e(f.name)}</span></button>`:''}).join('')}</div>`:''}<div class="message-bubble">${e(m.content)}</div><div class="message-time"><span>${time(m.at)}</span>${ib('copy-message','copy','Скопировать сообщение',`data-id="${m.id}"`)}${ib('edit-message','rename','Изменить сообщение',`data-id="${m.id}"`)}${ib('delete-message','trash','Удалить сообщение',`data-id="${m.id}"`)}</div></article>`).join('')}${generation?.chatId===c.id?`<div class="assistant-message" role="status"><div class="assistant-label">Focus</div>${generation.sources?.length?sourcePills({sources:generation.sources,query:generation.query,owner:'pending'}):''}<div class="generating ${generation.phase==='searching'?'web-searching':''}">${generation.phase==='searching'?'Ищу в интернете':generation.phase==='imaging'?'Создаю изображение':'Готовлю ответ'}<span class="typing-dots"><i></i><i></i><i></i></span></div></div>`:c.error?`<div class="request-error" role="alert">${icon('info')}<div>${c.pendingSearch?.sources?.length?sourcePills({...c.pendingSearch,owner:'pending'}):''}<p>${e(c.error)}</p><button class="inline-link" data-action="retry-answer">Повторить запрос</button></div></div>`:c.messages.at(-1)?.role==='user'?`<div class="pending-note">${icon('info')}<span>${apiStatus.configured?'Ответ не получен. Вы можете повторить запрос.':'Запрос сохранён. Модель ещё не подключена.'} <button class="inline-link" data-action="retry-answer">Повторить</button></span></div>`:''}</section>`}

function composer(){return `<div class="composer-area"><div class="composer-wrap"><form class="composer" id="composer-form"><div class="attachment-list" ${ui.attachments.length?'':'hidden'}>${ui.attachments.map(id=>{const f=state.files.find(x=>x.id===id);return f?`<span class="attachment-chip">${icon(fileIcon(f))}<span class="truncate">${e(f.name)}</span>${ib('remove-attachment','close','Убрать вложение',`data-id="${id}"`)}</span>`:''}).join('')}</div><textarea id="composer-input" rows="2" placeholder="Задача, вопрос или идея…" aria-label="Сообщение" maxlength="100000">${e(ui.draft)}</textarea><div class="composer-bottom"><div class="composer-left">${ib('attach','attach','Прикрепить файлы')}<button class="web-search-toggle ${state.settings.webSearch?'active':''}" type="button" data-action="toggle-web-search" aria-label="Поиск в интернете" aria-pressed="${!!state.settings.webSearch}" title="${apiStatus.searchConfigured?'Искать источники перед ответом':'Поиск ещё не подключён на сервере'}" ${generation?'disabled':''}>${icon('globe')}<span>Поиск</span></button><button class="composer-select" type="button" data-action="model-menu" aria-label="Выбрать модель">${e(MODEL_LABEL)}${icon('down')}</button><button class="composer-select" type="button" data-action="effort-menu" aria-label="Режим ответа">${apiStatus.provider==='openrouter'?'Обычный ответ':effortLabel()}${icon('down')}</button><button class="composer-select project-context" type="button" data-action="context-menu" aria-label="Контекст проекта">${icon('folder')}<span class="truncate">Файлы проекта</span>${icon('down')}</button></div><button class="send" id="send-button" type="${generation?'button':'submit'}" ${generation?'data-action="stop-generation"':''} aria-label="${generation?'Остановить ответ':'Отправить сообщение'}" ${generation||ui.draft.trim()||ui.attachments.length?'':'disabled'}>${generation?'<span class="stop-square"></span>':icon('arrow')}</button></div></form><div class="composer-hint"><span>История сохраняется в этом браузере</span><span class="enter-hint">· ${state.settings.sendOnEnter?'Enter — отправить, Shift + Enter — новая строка':'Ctrl + Enter — отправить'}</span></div></div></div>`}
function effortLabel(){return {fast:'Быстро',balanced:'Вдумчиво',deep:'Подробно'}[state.settings.effort]||'Вдумчиво'}
function filesPanel(show){const files=visibleFiles();const current=state.files.find(f=>f.id===ui.folder);const rows=files.filter(f=>(f.parent||null)===ui.folder).sort((a,b)=>(a.kind==='folder'?-1:1)-(b.kind==='folder'?-1:1)||(ui.sort==='date'?b.updated-a.updated:a.name.localeCompare(b.name,'ru')));const size=files.reduce((n,f)=>n+(f.size||0),0);return `<aside class="files-panel ${ui.mobileFiles?'mobile-open':''}" aria-label="Файлы проекта" ${show||ui.mobileFiles?'':'hidden'}><div class="files-header"><div class="files-tabs" role="tablist" aria-label="Панель проекта"><button class="tab ${ui.filesTab==='files'?'active':''}" role="tab" aria-selected="${ui.filesTab==='files'}" data-action="files-tab">Файлы</button><button class="tab ${ui.filesTab==='changes'?'active':''}" role="tab" aria-selected="${ui.filesTab==='changes'}" data-action="changes-tab">Изменения</button></div><div style="display:flex">${ib('refresh-files','refresh','Обновить список файлов')}${ib('close-files','close','Закрыть файлы',`class="mobile-only"`)}</div></div>${ui.filesTab==='files'?`<div class="files-toolbar"><div class="file-path">${ib('folder-up','arrow','На уровень выше',!ui.folder?'disabled':'')}<span class="truncate" title="${e(current?.name||'Корень проекта')}">${e(current?.name||'/')}</span></div><div class="file-actions">${ib('create-file','plus','Создать файл')}${ib('create-folder','folder','Создать папку')}${ib('upload','upload','Загрузить файлы')}</div></div><div class="files-body" id="files-dropzone">${rows.length?rows.map(f=>`<div class="file-row">${icon(fileIcon(f))}<button class="file-open" data-action="${f.kind==='folder'?'open-folder':'preview-file'}" data-id="${f.id}"><strong class="truncate">${e(f.name)}</strong><small>${f.kind==='folder'?'Папка':humanSize(f.size||0)}</small></button><button class="icon-btn row-more" data-action="file-menu" data-id="${f.id}" aria-label="Действия с файлом ${e(f.name)}">${icon('more')}</button></div>`).join(''):`<div class="files-empty">${icon('folder','empty-file-icon')}<span>Здесь пока пусто</span><small>Добавьте материалы для работы</small><button data-action="upload">Выбрать файлы</button></div>`}</div><footer class="files-foot"><span>${files.filter(f=>f.kind!=='folder').length} ${plural(files.filter(f=>f.kind!=='folder').length,'файл','файла','файлов')} · ${humanSize(size)}</span><button data-action="sort-files" style="font-size:10px;padding:0;color:var(--muted)">${ui.sort==='name'?'По имени':'По дате'}</button></footer>`:`<div class="files-body"><div class="change-list">${state.changes.filter(c=>c.project===activeProject()?.id).length?`<p class="change-day">История проекта</p>${state.changes.filter(c=>c.project===activeProject()?.id).slice(0,50).map(c=>`<div class="change-item">${e(c.text)}<small>${date(c.at)}, ${time(c.at)}</small></div>`).join('')}`:`<div class="files-empty">${icon('clock')}<span>Изменений пока нет</span><small>Здесь появятся действия с проектом и файлами</small></div>`}</div></div>`}</aside>`}
function workspaceView(){return `<section class="workspace"><h1>Ваше пространство</h1><p class="workspace-intro">Диалоги, материалы и проекты — в одном месте</p><div class="section-heading"><h2>Проекты</h2>${button('create-project',`${icon('plus')} Создать проект`,'ghost')}</div>${liveProjects().map(p=>`<article class="workspace-card"><div class="workspace-symbol">${icon('folder')}</div><div class="workspace-details"><h3>${e(p.name)}</h3><p>${e(p.description)||`${state.chats.filter(c=>c.project===p.id&&!c.deleted).length} ${plural(state.chats.filter(c=>c.project===p.id&&!c.deleted).length,'диалог','диалога','диалогов')} · ${state.files.filter(f=>f.project===p.id&&!f.deleted&&f.kind!=='folder').length} ${plural(state.files.filter(f=>f.project===p.id&&!f.deleted&&f.kind!=='folder').length,'файл','файла','файлов')}`}</p></div>${button('open-workspace',`Открыть ${icon('chevron')}`,'primary',`data-id="${p.id}"`)}${ib('project-menu','more','Действия с проектом',`data-id="${p.id}"`)}</article>`).join('')||`<div class="list-empty">${icon('folder')}<h2>Начните с проекта</h2><p>Соберите диалоги и материалы по одной задаче</p>${button('create-project','Создать проект','primary')}</div>`}<p class="settings-note" style="margin-top:32px">Сейчас пространство хранится на этом устройстве. Резервную копию можно скачать в настройках.</p></section>`}
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
function selectProject(id,toggle=false){const p=state.projects.find(p=>p.id===id&&!p.deleted);if(!p)return;const same=id===state.activeProject;if(same&&toggle){ui.collapsed.has(id)?ui.collapsed.delete(id):ui.collapsed.add(id)}else{state.activeProject=id;state.activeChat=null;ui.folder=null;ui.draft='';ui.attachments=[];ui.collapsed.delete(id)}ui.view='chat';ui.mobileNav=false;persist();render()}
function newChat(){if(!activeProject()){projectDialog();return}state.activeChat=null;ui.draft='';ui.attachments=[];ui.archive=false;ui.view='chat';ui.mobileNav=false;persist();render();el('composer-input')?.focus()}
function selectChat(id){const c=state.chats.find(c=>c.id===id&&!c.deleted);if(!c)return;state.activeChat=id;state.activeProject=c.project;ui.archive=!!c.archived;ui.folder=null;ui.draft='';ui.attachments=[];ui.view='chat';ui.mobileNav=false;persist();render();el('main-scroll').scrollTop=el('main-scroll').scrollHeight}
function send(){if(generation){toast('Дождитесь ответа или остановите запрос');return}const content=ui.draft.trim();if(!content&&!ui.attachments.length)return;if(!activeProject()){projectDialog();return}let c=activeChat();if(!c){c={id:uid(),title:(content||'Диалог с файлами').replace(/\s+/g,' ').slice(0,48),project:activeProject().id,created:Date.now(),updated:Date.now(),messages:[],archived:false,deleted:false};state.chats.unshift(c);state.activeChat=c.id;log(`Создан диалог «${c.title}»`)}c.messages.push({id:uid(),content,files:[...ui.attachments],at:Date.now(),role:'user',webSearch:!!state.settings.webSearch});c.updated=Date.now();ui.draft='';ui.attachments=[];persist();render();el('main-scroll').scrollTop=el('main-scroll').scrollHeight;el('composer-input')?.focus();requestAnswer(c)}
function closeMenu(){document.querySelector('.menu-popup')?.remove();ui.menu=null}
function menu(anchor,options){closeMenu();const div=document.createElement('div');div.className='menu-popup';div.role='menu';div.innerHTML=options.map(o=>o.separator?'<div class="menu-separator"></div>':o.label?`<div class="menu-label">${e(o.label)}</div>`:`<button class="menu-option ${o.danger?'danger':''}" role="menuitem" data-action="${o.action}" ${o.id?`data-id="${e(o.id)}"`:''} ${o.type?`data-type="${e(o.type)}"`:''} ${o.value?`data-value="${e(o.value)}"`:''}>${o.icon?icon(o.icon):''}<span>${e(o.text)}</span>${o.checked?icon('check','check'):''}</button>`).join('');document.body.append(div);const r=anchor.getBoundingClientRect(),d=div.getBoundingClientRect();div.style.left=Math.max(8,Math.min(r.left,innerWidth-d.width-8))+'px';div.style.top=(r.bottom+d.height+8>innerHeight?Math.max(8,r.top-d.height-8):r.bottom+8)+'px';ui.menu=div;div.querySelector('button')?.focus()}
function closeModal(){const d=document.querySelector('dialog');if(d){d.close();d.remove()}for(const u of objectURLs)URL.revokeObjectURL(u);objectURLs=[]}
function modal(title,body,{wide=false,onSubmit=null}={}){closeModal();closeMenu();const d=document.createElement('dialog');d.className=`dialog ${wide?'wide':''}`;d.setAttribute('aria-label',title);d.innerHTML=`<div class="dialog-header"><h2>${e(title)}</h2>${ib('close-modal','close','Закрыть')}</div><div class="dialog-body">${body}</div>`;el('overlay-root').append(d);d.showModal();d.addEventListener('click',ev=>{if(ev.target===d)closeModal()});d.addEventListener('cancel',()=>{setTimeout(closeModal,0)});if(onSubmit)d.querySelector('form')?.addEventListener('submit',ev=>{ev.preventDefault();onSubmit(new FormData(ev.target),ev.target)});return d}
function projectDialog(id){const p=state.projects.find(p=>p.id===id);modal(p?'Настройки проекта':'Новый проект',`<form><p class="dialog-description">Объедините диалоги и файлы по одной задаче</p><div class="form-field"><label for="project-name">Название</label><input id="project-name" name="name" placeholder="Например, запуск продукта" value="${e(p?.name||'')}" maxlength="70" required autofocus /></div><div class="form-field"><label for="project-description">Описание <span style="color:var(--muted);font-weight:400">· необязательно</span></label><textarea id="project-description" name="description" rows="3" placeholder="Для чего этот проект" maxlength="300">${e(p?.description||'')}</textarea></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">${p?'Сохранить':'Создать проект'}</button></div></form>`,{onSubmit:(data)=>{const name=data.get('name').trim();if(!name)return;if(liveProjects().some(x=>x.name.toLowerCase()===name.toLowerCase()&&x.id!==id)){el('form-error').textContent='Проект с таким названием уже существует';el('form-error').hidden=false;return}if(p){p.name=name;p.description=data.get('description').trim();log(`Обновлён проект «${name}»`,p.id)}else{const np={id:uid(),name,description:data.get('description').trim(),created:Date.now(),deleted:false};state.projects.push(np);state.activeProject=np.id;state.activeChat=null;ui.folder=null;ui.draft='';ui.attachments=[];ui.view='chat';ui.archive=false;ui.mobileNav=false;log(`Создан проект «${name}»`,np.id)}persist();closeModal();render();toast(p?'Проект обновлён':'Проект создан')}})}
function renameDialog(type,id){const item=type==='chat'?state.chats.find(x=>x.id===id):state.files.find(x=>x.id===id);if(!item)return;const old=type==='chat'?item.title:item.name;modal('Переименовать',`<form><div class="form-field"><label for="rename-name">Название</label><input id="rename-name" name="name" value="${e(old)}" maxlength="120" required autofocus /></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:data=>{const name=data.get('name').trim();if(!name)return;if(type==='file'&&state.files.some(f=>f.id!==id&&f.project===item.project&&(f.parent||null)===(item.parent||null)&&!f.deleted&&f.name===name)){el('form-error').textContent='В этой папке уже есть элемент с таким названием';el('form-error').hidden=false;return}item[type==='chat'?'title':'name']=name;item.updated=Date.now();log(`Переименован ${type==='chat'?'диалог':'файл'} «${old}»`,item.project);persist();closeModal();render()}})}
function confirm(title,text,action,label='Подтвердить',danger=false){modal(title,`<p class="dialog-description">${e(text)}</p><div class="dialog-footer">${button('close-modal','Отмена','ghost')}<button id="confirm-button" class="btn ${danger?'danger':'primary'}">${e(label)}</button></div>`);el('confirm-button').onclick=async()=>{try{await action();closeModal();persist();render()}catch(err){toast('Не удалось выполнить действие. Попробуйте ещё раз.')}}}
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
async function previewFile(id){const f=state.files.find(x=>x.id===id&&!x.deleted);if(!f)return;const blob=await getBlob(id);if(!blob){toast('Файл недоступен на этом устройстве');return}const text=isText(f)&&blob.size<=2*1048576?await blob.text():null;let content;if(text!==null)content=`<pre>${e(text)||'Файл пуст'}</pre>`;else if(f.type?.startsWith('image/')){const url=URL.createObjectURL(blob);content=`<img src="${url}" alt="${e(f.name)}" />`}else content=`<div class="list-empty">${icon(fileIcon(f))}<h2>${e(f.name)}</h2><p>Скачайте файл, чтобы открыть его в подходящем приложении</p></div>`;
 const urlToKeep=content.match(/src="(blob:[^"]+)"/)?.[1];modal(f.name,`<div class="file-preview-header"><span class="file-preview-meta">${humanSize(f.size)} · ${date(f.updated)}</span><div style="display:flex;gap:8px">${text!==null?button('edit-file',`${icon('rename')} Изменить`,'',`data-id="${id}"`):''}${button('download-file',`${icon('download')} Скачать`,'',`data-id="${id}"`)}</div></div><div class="file-preview-content">${content}</div>`,{wide:true});if(urlToKeep)objectURLs.push(urlToKeep)}
async function editFile(id){const f=state.files.find(x=>x.id===id),blob=await getBlob(id);if(!f||!blob)return;const text=await blob.text();modal(f.name,`<form><div class="form-field"><label for="editor-text">Содержимое файла</label><textarea id="editor-text" class="file-editor" name="content" maxlength="2000000" spellcheck="false">${e(text)}</textarea></div><p class="error-text" id="form-error" hidden></p><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить изменения</button></div></form>`,{wide:true,onSubmit:async(data,form)=>{form.querySelector('[type=submit]').disabled=true;try{const b=new Blob([data.get('content')],{type:f.type||'text/plain'});await putBlob(id,b);f.size=b.size;f.updated=Date.now();log(`Изменён файл «${f.name}»`,f.project);persist();closeModal();render();toast('Изменения сохранены')}catch{form.querySelector('[type=submit]').disabled=false;el('form-error').textContent='Не удалось сохранить файл';el('form-error').hidden=false}}})}
function searchDialog(){modal('Поиск по пространству',`<div class="search-input-wrap">${icon('search')}<input id="search-input" aria-label="Поиск диалогов и проектов" placeholder="Название проекта или текст диалога" autocomplete="off" autofocus /></div><div class="search-results" id="search-results"></div>`);searchResults('');el('search-input').oninput=ev=>searchResults(ev.target.value)}
function searchResults(q){q=q.toLocaleLowerCase('ru').trim();const projects=liveProjects().filter(p=>!q||p.name.toLocaleLowerCase('ru').includes(q));const chats=state.chats.filter(c=>!c.deleted&&!state.projects.find(p=>p.id===c.project)?.deleted&&(!q||[c.title,...c.messages.map(m=>m.content)].join(' ').toLocaleLowerCase('ru').includes(q)));const rows=[...projects.map(p=>({id:p.id,action:'search-project',title:p.name,sub:'Проект',ico:'folder'})),...chats.map(c=>({id:c.id,action:'search-chat',title:c.title,sub:`${projectName(c.project)}${c.archived?' · Архив':''}`,ico:'chat'}))].slice(0,30);el('search-results').innerHTML=rows.map(r=>`<button class="search-result" data-action="${r.action}" data-id="${r.id}">${icon(r.ico)}<span><strong class="truncate">${e(r.title)}</strong><small class="truncate">${e(r.sub)}</small></span></button>`).join('')||'<div class="search-empty">Ничего не найдено. Попробуйте другое слово.</div>'}
function settingsDialog(){modal('Настройки',`<form id="settings-form"><div class="settings-section"><h3>Ваше пространство</h3><div class="form-field"><label for="settings-name">Название</label><input id="settings-name" name="name" value="${e(state.settings.name)}" maxlength="60" required /></div><div class="form-field" style="margin-bottom:0"><label for="settings-theme">Оформление</label><select name="theme" id="settings-theme">${[['light','Светлое'],['dark','Тёмное'],['system','Как на устройстве']].map(([v,l])=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="setting-row"><div>Отправлять по Enter<p>Shift + Enter добавляет новую строку</p></div><button class="switch" type="button" role="switch" aria-label="Отправлять по Enter" aria-checked="${state.settings.sendOnEnter}" data-action="toggle-enter"></button></div></div><div class="settings-section"><h3>Данные</h3><p class="settings-note" style="margin-bottom:16px">История и файлы сохраняются только в этом браузере. Для переноса на другое устройство скачайте резервную копию.</p><div class="settings-buttons">${button('export-backup',`${icon('download')} Скачать копию`,'','type="button"')}${button('import-backup',`${icon('upload')} Восстановить`,'','type="button"')}</div></div><div class="settings-section"><h3>Подключение модели</h3><p class="settings-note">${e(MODEL_LABEL)} · ${apiStatus.configured?'подключена':'не настроена'}. Запросы проходят через сервер приложения. Ключ API не хранится в браузере. Текст диалога и поддерживаемые вложения передаются провайдеру модели для ответа. В бесплатном режиме режимы глубины ответа не применяются.</p></div><p class="settings-note">Focus · первая версия<br>Дизайн по референсам и <a href="https://github.com/heydamir/unslop" target="_blank" rel="noopener noreferrer">Unslop</a> — Damir Sokolovsky, CC BY 4.0</p><div class="dialog-footer" style="margin-top:24px">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:(data)=>{state.settings.name=data.get('name').trim()||'Моё пространство';state.settings.theme=data.get('theme');state.settings.sendOnEnter=document.querySelector('[data-action=toggle-enter]')?.getAttribute('aria-checked')==='true';persist();closeModal();render();toast('Настройки сохранены')}})}
function imageSubscriptionDialog(){
 if(!isSecureContext){toast('Введите код подписки на защищённой странице HTTPS');return}
 modal('GPT Image по подписке',`<form><div class="form-field"><label for="image-pass">Код подписки</label><input id="image-pass" name="pass" type="password" autocomplete="off" maxlength="64" pattern="[a-f0-9]{64}" /></div><p class="settings-note">Вставьте код, полученный после оплаты. Пустое поле включает бесплатную генерацию.</p><div class="dialog-footer"><button class="btn primary" type="submit">Применить</button></div></form>`,{onSubmit:data=>{
  const pass=String(data.get('pass')||'').trim();
  if(pass)sessionStorage.setItem('focus-image-pass',pass);
  else sessionStorage.removeItem('focus-image-pass');
  closeModal();
  toast(pass?'Код сохранён для этой вкладки':'Включена бесплатная генерация');
 }});
}
async function exportBackup(){toast('Подготавливаю резервную копию');try{const blobs={};for(const f of state.files.filter(f=>f.kind!=='folder')){const b=await getBlob(f.id);if(b)blobs[f.id]=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(b)})}download(new Blob([JSON.stringify({...state,blobs},null,2)],{type:'application/json'}),`focus-backup-${new Date().toISOString().slice(0,10)}.json`);toast('Резервная копия скачана')}catch{toast('Не удалось создать копию')}}
async function importBackup(file){if(!file)return;if(file.size>150*1048576){toast('Резервная копия слишком большая: максимум 150 МБ');return}let d;try{d=JSON.parse(await file.text());if(!validBackup(d))throw new Error();for(const [id,value]of Object.entries(d.blobs||{}))if(typeof value!=='string'||!/^data:[^,]*;base64,[A-Za-z0-9+/=\r\n]*$/.test(value)||!d.files.some(f=>f.id===id))throw new Error()}catch{toast('Это не резервная копия Focus или файл повреждён');return}confirm('Восстановить пространство?','Текущая история будет заменена данными из резервной копии. Сначала можно скачать текущую копию в настройках.',async()=>{for(const [id,value]of Object.entries(d.blobs||{})){const comma=value.indexOf(','),raw=atob(value.slice(comma+1)),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));await putBlob(id,new Blob([bytes],{type:value.slice(5,value.indexOf(';'))}))}const {blobs,...rest}=d;state={...fresh(),...rest,settings:{...fresh().settings,...rest.settings}};ui.draft='';ui.attachments=[];ui.folder=null;ui.view='chat';toast('Пространство восстановлено')},'Восстановить')}
function exportChat(id){const c=state.chats.find(x=>x.id===id);if(!c)return;const text=`# ${c.title}\n\nПроект: ${projectName(c.project)}\n\n`+c.messages.map(m=>`## ${m.role==='assistant'?'Focus':'Вы'} · ${date(m.at)}, ${time(m.at)}\n\n${m.content}${m.search?.sources?.length?'\n\nИсточники:\n'+m.search.sources.map(x=>`[${x.id}] ${x.title} — ${x.url}`).join('\n'):''}${m.files?.length?'\n\nВложения: '+m.files.map(id=>state.files.find(f=>f.id===id)?.name||'Удалённый файл').join(', '):''}`).join('\n\n---\n\n');download(new Blob([text],{type:'text/markdown;charset=utf-8'}),`${c.title.replace(/[\\/:*?"<>|]/g,'').slice(0,60)||'Диалог'}.md`)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Скопировано')}catch{toast('Не удалось скопировать. Выделите текст вручную.')}}
async function handleAction(a,t){const id=t.dataset.id;switch(a){
case 'new-chat':newChat();break;
case 'workspace':setView('workspace');break;
case 'trash':setView('trash');break;
case 'close-nav':ui.mobileNav=false;render();break;
case 'toggle-sidebar':if(innerWidth<640){ui.mobileNav=!ui.mobileNav}else ui.sidebarClosed=!ui.sidebarClosed;render();break;
case 'select-project':selectProject(id,true);break;
case 'open-workspace':selectProject(id);break;
case 'select-chat':selectChat(id);break;
case 'search':searchDialog();break;
case 'search-project':closeModal();selectProject(id);break;
case 'search-chat':closeModal();selectChat(id);break;
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
case 'model-menu':menu(t,[{label:'Подключённая модель'},{text:MODEL_LABEL,action:'set-model',value:apiStatus.provider||'default',checked:true},{separator:true},{text:'GPT Image по подписке',action:'image-subscription'},{text:'О подключении',action:'model-info',icon:'info'}]);break;
case 'image-subscription':imageSubscriptionDialog();break;
case 'set-model':state.settings.model=t.dataset.value;persist();render();break;
case 'effort-menu':if(apiStatus.provider==='openrouter'){toast('В бесплатном режиме параметры ответа выбирает провайдер');break;}menu(t,[{text:'Быстро',action:'set-effort',value:'fast',checked:state.settings.effort==='fast'},{text:'Вдумчиво',action:'set-effort',value:'balanced',checked:state.settings.effort==='balanced'},{text:'Подробно',action:'set-effort',value:'deep',checked:state.settings.effort==='deep'}]);break;
case 'set-effort':state.settings.effort=t.dataset.value;persist();render();break;
case 'context-menu':menu(t,[{label:'Работать в проекте'},...liveProjects().map(p=>({text:p.name,action:'switch-context',id:p.id,checked:p.id===state.activeProject,icon:'folder'}))]);break;
case 'switch-context':{const d=ui.draft;selectProject(id);ui.draft=d;render();break;}
case 'model-info':modal('Подключение модели',`<p class="dialog-description">${e(MODEL_LABEL)} ${apiStatus.configured?'подключена через сервер приложения.':'ещё не настроена на этом сервере.'}</p><p class="settings-note">История хранится в браузере. Для ответа текст диалога и прикреплённые поддерживаемые файлы передаются провайдеру модели. Guzan 1.1 — название модели в Focus. В бесплатном режиме ответы обрабатывает внешний провайдер, базовая модель может меняться. Ключ API хранится на сервере и не передаётся в браузер.</p><p class="settings-note">Встроенные команды работают без ключа. Попробуйте <code>/calc (125 + 18) * 1,2</code>, <code>/stats 12; 18; 21; 24</code> или <code>/convert 2,5 км в м</code>.</p><p class="settings-note">Прикрепите CSV и напишите <code>/csv</code> для статистики. Для сравнения двух текстовых файлов прикрепите старую и новую версии и напишите <code>/diff</code>.</p><div class="dialog-footer" style="margin-top:24px">${button('close-modal','Понятно','primary')}</div>`);break;
case 'toggle-web-search':if(!apiStatus.searchConfigured){toast('Поиск ещё не подключён на сервере');break;}state.settings.webSearch=!state.settings.webSearch;persist();render();el('composer-input')?.focus();break;
case 'search-sources':{const owner=t.dataset.searchOwner;const search=owner==='pending'?(generation?.sources?{sources:generation.sources,query:generation.query}:activeChat()?.pendingSearch):activeChat()?.messages.find(m=>m.id===owner)?.search;if(search)modal('Источники поиска',sourcesDialog(search));break;}
case 'toggle-files':if(innerWidth<960){ui.mobileFiles=!ui.mobileFiles}else state.settings.showFiles=!state.settings.showFiles;persist();render();break;
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
case 'download-file':await downloadFile(id);break;
case 'edit-file':await editFile(id);break;
case 'settings':settingsDialog();break;
case 'toggle-theme':state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme();persist();break;
case 'toggle-enter':t.setAttribute('aria-checked',t.getAttribute('aria-checked')!=='true');break;
case 'export-backup':await exportBackup();break;
case 'import-backup':el('import-input').value='';el('import-input').click();break;
case 'close-modal':closeModal();break;
case 'stop-generation':if(generation){generation.controller.abort()}break;
case 'retry-answer':{const c=activeChat();if(c&&!generation){const lastUser=c.messages.findLastIndex(m=>m.role==='user');if(lastUser>=0){c.messages=c.messages.slice(0,lastUser+1);persist();requestAnswer(c)}}break;}
case 'save-answer':{const m=activeChat()?.messages.find(x=>x.id===id);if(m){const fId=uid(),blob=new Blob([answerMarkdown(m)],{type:'text/markdown;charset=utf-8'});await putBlob(fId,blob);let name=(activeChat().title.slice(0,40).replace(/[\\/:*?"<>|]/g,'')||'Ответ')+'.md',n=1;while(fileExists(name))name='Ответ ('+(n++)+').md';state.files.push({id:fId,project:state.activeProject,parent:ui.folder,name,kind:'file',type:'text/markdown',size:blob.size,created:Date.now(),updated:Date.now(),deleted:false});log(`Сохранён ответ «${name}»`);persist();render();toast('Ответ сохранён в файлы проекта')}break;}
case 'copy-code':{const block=codeBlockAction(t);if(block)await copy(block.code);break;}
case 'download-code':{const block=codeBlockAction(t);if(block)download(new Blob([block.code],{type:'text/plain;charset=utf-8'}),block.filename||'code.txt');break;}
case 'review-code':await reviewCodeFile(codeBlockAction(t));break;
case 'download-answer':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)download(new Blob([answerMarkdown(m)],{type:'text/markdown;charset=utf-8'}),'Ответ.md');break;}
case 'copy-message':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)await copy(m.content);break;}
case 'edit-message':{const m=activeChat()?.messages.find(x=>x.id===id);if(m)modal('Изменить сообщение',`<form><div class="form-field"><textarea name="content" aria-label="Текст сообщения" rows="6" required autofocus>${e(m.content)}</textarea></div><div class="dialog-footer">${button('close-modal','Отмена','ghost','type="button"')}<button class="btn primary" type="submit">Сохранить</button></div></form>`,{onSubmit:data=>{m.content=data.get('content').trim();activeChat().updated=Date.now();persist();closeModal();render()}});break;}
case 'delete-message':{const c=activeChat();if(c){c.messages=c.messages.filter(m=>m.id!==id);c.updated=Date.now();persist();render()}break;}
}}
document.addEventListener('click',ev=>{const t=ev.target.closest('[data-action]');if(t){ev.preventDefault();const a=t.dataset.action;if(a==='current-chat-menu'){t.dataset.id=state.activeChat;handleAction('chat-menu',t).catch(()=>toast('Не удалось выполнить действие'));return}if(!t.closest('.menu-popup'))closeMenu();else closeMenu();handleAction(a,t).catch(()=>toast('Не удалось выполнить действие'))}else if(!ev.target.closest('.menu-popup'))closeMenu()});
document.addEventListener('submit',ev=>{if(ev.target.id==='composer-form'){ev.preventDefault();send()}});
document.addEventListener('input',ev=>{if(ev.target.id==='composer-input'){ui.draft=ev.target.value;el('send-button').disabled=!generation&&!ui.draft.trim()&&!ui.attachments.length;resizeComposer()}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){closeMenu();if(ui.mobileNav||ui.mobileFiles){ui.mobileNav=false;ui.mobileFiles=false;render()}}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();searchDialog()}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='n'){ev.preventDefault();closeModal();newChat()}if(ev.target.id==='composer-input'&&ev.key==='Enter'&&!ev.isComposing){if((state.settings.sendOnEnter&&!ev.shiftKey&&!ev.altKey)||(ev.ctrlKey||ev.metaKey)){ev.preventDefault();send()}}if(ui.menu&&(ev.key==='ArrowDown'||ev.key==='ArrowUp')){ev.preventDefault();const buttons=[...ui.menu.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);buttons[(i+(ev.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}});
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
  if(!target&&rootEntry())throw Error('Файл уже существует. Прикрепите его к запросу /code для безопасной замены.');
  const original=target?await getOriginal():null;
  modal(filename,`<form>
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
function markdown(text,message){
 const blocks=splitCodeBlocks(text);let out='';
 const inline=str=>e(str).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
 for(let i=0;i<blocks.length;i+=3){const lines=blocks[i].split('\n');let list=false;for(let j=0;j<lines.length;j++){const line=lines[j];if(/^\s*\|/.test(line)&&j+1<lines.length&&/^\s*\|?[\s:|-]+\|/.test(lines[j+1])){if(list){out+='</ul>';list=false}const cells=line.trim().replace(/^\||\|$/g,'').split('|');out+='<div class="table-wrap"><table><thead><tr>'+cells.map(c=>'<th>'+inline(c.trim())+'</th>').join('')+'</tr></thead><tbody>';j++;while(j+1<lines.length&&/^\s*\|/.test(lines[j+1])){j++;out+='<tr>'+lines[j].trim().replace(/^\||\|$/g,'').split('|').map(c=>'<td>'+inline(c.trim())+'</td>').join('')+'</tr>'}out+='</tbody></table></div>';continue}const li=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);if(li){if(!list){out+='<ul>';list=true}out+='<li>'+inline(li[1])+'</li>';continue}if(list){out+='</ul>';list=false}const h=line.match(/^(#{1,4})\s+(.+)/);if(h)out+=`<h${h[1].length+1}>${inline(h[2])}</h${h[1].length+1}>`;else if(/^\s*---+\s*$/.test(line))out+='<hr>';else if(line.trim())out+='<p>'+inline(line)+'</p>'}if(list)out+='</ul>';if(i+2<blocks.length){
 const info=codeBlockInfo(blocks[i+1]);
 const attrs=message?`data-id="${e(message.id)}" data-block="${i/3}" type="button"`:'';
 const actions=message?`<span class="code-actions">${button('copy-code','Копировать','ghost',attrs)}${button('download-code','Скачать','ghost',attrs)}${message.codeMode&&info.filename&&!message.truncated?button('review-code','Сохранить в проект','ghost',attrs):''}</span>`:'';
 out+=`<div class="code-block"><div class="code-toolbar"><small>${e(info.filename||info.language||'Код')}</small>${actions}</div><pre><code>${e(blocks[i+2])}</code></pre></div>`;
}}return out;
}
async function attachmentPayload(ids){const result=[];let bytes=0;for(const id of [...new Set(ids)]){const f=state.files.find(f=>f.id===id&&!f.deleted&&f.kind!=='folder');if(!f)continue;const blob=await getBlob(id);if(!blob)continue;if(isText(f)&&blob.size<500000){result.push({id,name:f.name,text:await blob.text()})}else if(['image/png','image/jpeg','image/webp','application/pdf'].includes(f.type)&&blob.size<5*1048576&&bytes+blob.size<6*1048576){bytes+=blob.size;const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob)});result.push({name:f.name,mimeType:f.type,data})}else if(ids.includes(id)){toast(`«${f.name}» сохранён, но не передан модели: используйте текст, PDF или изображение до 5 МБ`)}}return result}
async function requestAnswer(c){
 if(generation)return;
 c.error=null;c.pendingSearch=null;
 const controller=new AbortController();const lastUser=c.messages.findLast(m=>m.role==='user');
 const localSkill=/^\/(?:calc|stats|convert|csv|diff)(?=\s|$)/i.test(lastUser?.content.trim()||'');
 const fileSkill=/^\/(?:csv|diff)(?=\s|$)/i.test(lastUser?.content.trim()||'');
 const codeMode=/^\s*\/code(?=\s|$)/iu.test(lastUser?.content||'');
 const previousImage=latestImage(c.messages);
 const imageRequest=imageIntent(lastUser?.content,!!previousImage);
 const explicitSearch=/^\s*(?:пожалуйста[ ,]+)?(?:найди|поищи|проверь)\s+(?:в интернете|в сети)(?=\s|[,:]|$)/iu.test(lastUser?.content||'');
 const withSearch=(!!lastUser?.webSearch||explicitSearch)&&!localSkill&&!imageRequest;
 generation={chatId:c.id,controller,phase:imageRequest?'imaging':withSearch?'searching':'answering'};
 const refresh=()=>{if(ui.view==='chat'&&state.activeChat===c.id){render();const scroll=el('main-scroll');if(scroll)scroll.scrollTop=scroll.scrollHeight}};
 refresh();
 try{
  let searchId;
  if(withSearch){
   const query=searchQuery(c.messages);
   if(!query)throw new Error('Для поиска добавьте текст вопроса.');
   generation.query=query;
   const response=await fetch('/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query}),signal:controller.signal});
   let research;try{research=await response.json()}catch{throw new Error('Не удалось прочитать результаты поиска.')}
   if(!response.ok)throw new Error(research.error||'Поиск не выполнен. Попробуйте позже.');
   searchId=research.searchId;
   c.pendingSearch={query:research.query,sources:research.sources,searchedAt:research.searchedAt};
   generation.sources=research.sources;generation.phase='answering';persist();refresh();
  }
  const projectFiles=state.files.filter(f=>f.project===c.project&&!f.deleted&&f.kind!=='folder'&&isText(f)&&f.size<100000);
  let reference;
  if(imageRequest?.mode==='edit'){
   const file=state.files.find(f=>f.id===previousImage?.imageFile&&!f.deleted);
   const blob=file?await getBlob(file.id):null;
   if(!blob)throw new Error('Последнее изображение недоступно. Создайте новое изображение в этом диалоге.');
   reference=await imageReference(blob);
  }
  const messages=(localSkill||imageRequest)
   ?[{role:'user',content:lastUser.content,...(fileSkill?{attachments:await attachmentPayload(lastUser.files||[])}:{})}]
   :await buildChatContext(c.messages,projectFiles,attachmentPayload);
  const codeTargets=codeMode?await Promise.all((messages.at(-1)?.attachments||[])
   .filter(file=>lastUser.files?.includes(file.id)&&typeof file.text==='string')
   .map(async file=>({id:file.id,name:file.name,hash:await codeHash(file.text)}))):[];
  const pass=imageRequest&&isSecureContext?sessionStorage.getItem('focus-image-pass'):null;
  const headers={'content-type':'application/json',...(pass?{'x-focus-image-pass':pass}:{})};
  const response=await fetch('/api/chat',{method:'POST',headers,body:JSON.stringify({messages,...(reference?{imageReference:reference}:{}),effort:state.settings.effort,...(searchId?{searchId}:{})}),signal:controller.signal});
  let data;try{data=await response.json()}catch{throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')}
  if(!response.ok)throw new Error(data.error||'Не удалось получить ответ');
  if(!data.text)throw new Error('Получен пустой ответ');
  let imageFile;
  if(data.image){
   const binary=atob(data.image.data),blob=new Blob([Uint8Array.from(binary,ch=>ch.charCodeAt(0))],{type:data.image.mimeType});
   imageFile=uid();
   await putBlob(imageFile,blob);
   const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];
   state.files.push({id:imageFile,project:c.project,parent:null,name:'Guzan-'+imageFile.slice(0,8)+'.'+extension,kind:'file',type:blob.type,size:blob.size,created:Date.now(),updated:Date.now(),deleted:false});
  }
  c.messages.push({id:uid(),role:'assistant',...(codeMode?{codeMode,codeTargets}:{}),...(imageFile?{imageFile}:{}),content:data.text,at:Date.now(),model:data.model||apiStatus.model||'Модель',usage:data.usage,truncated:!!data.truncated,...(data.search?{search:data.search}:{})});
  c.pendingSearch=null;c.updated=Date.now();if(data.provider!=='local'&&data.provider!=='image')apiStatus.configured=true;
 }catch(err){c.error=err.name==='AbortError'?'Запрос остановлен. Его можно повторить.':err.message||'Не удалось получить ответ';}
 finally{generation=null;persist();refresh()}
}
render();
fetch('/api/status').then(r=>r.json()).then(d=>{apiStatus=d;render()}).catch(()=>{});

