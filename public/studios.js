import {icon} from './icons.js';

export const STUDIO_LABELS={code:'Focus Code',forge:'Focus Forge',sites:'Сайты',images:'Изображения',tables:'Таблицы',skills:'Скиллы'};
export const CODE_STARTERS=[
 {title:'Создать проект',icon:'plus',prompt:'Создай готовый многофайловый проект: '},
 {title:'Исправить ошибку',icon:'check',prompt:'Найди причину ошибки, исправь код и верни полные изменённые файлы: '},
 {title:'Провести ревью',icon:'search',prompt:'Проведи ревью кода, найди ошибки и предложи конкретные исправления: '},
];
export const FORGE_STARTERS=[
 {title:'Веб-приложение',icon:'globe',prompt:'Собери готовое веб-приложение с рабочим интерфейсом, обработкой ошибок, README и проверяемыми критериями: '},
 {title:'Мобильная игра',icon:'grid',prompt:'Собери готовую мобильную браузерную игру с управлением для телефона, прогрессом, перезапуском и инструкцией: '},
 {title:'Сервис или бот',icon:'command',prompt:'Собери готовый многофайловый сервис или бота, добавь конфигурацию, обработку ошибок, тесты и README: '},
];
export const SITE_STARTERS=[
 {title:'Лендинг',icon:'globe',prompt:'Лендинг для небольшого бренда. Первый экран с ясным предложением, блок преимуществ, отзывы и призыв к действию.'},
 {title:'Портфолио',icon:'grid',prompt:'Портфолио специалиста. Короткое вступление, сетка избранных работ, информация обо мне и контакты.'},
 {title:'Событие',icon:'clock',prompt:'Страница события. Дата и место, расписание, информация об участниках и кнопка регистрации.'},
];
export const IMAGE_STARTERS=[
 {title:'Иллюстрация',prompt:'Редакционная иллюстрация о работе в тишине: стол у окна, утренний свет, мягкая фактура бумаги, тёплые природные цвета.',style:'illustration'},
 {title:'Фотография',prompt:'Предметная фотография на светлом камне, мягкие тени, естественный свет из окна, приглушённые цвета, чистая композиция.',style:'photo'},
 {title:'Постер',prompt:'Типографический постер «Время создавать». Крупный заголовок, кремовый фон, красно-коричневые акценты, ясная композиция.',style:'poster'},
];

// Unmodified packages from anthropics/skills at 2c5958ecac7cee2b583967a2c4981d0f4a75c579.
// Each archive includes its upstream LICENSE.txt.
const SKILLS=[
 {title:'Дизайн сайтов',icon:'poster',description:'Визуальная концепция, типографика и адаптивные интерфейсы.',archive:'frontend-design'},
 {title:'Создание веб-интерфейсов',icon:'code',description:'Сборка интерактивных веб-страниц и компонентов.',archive:'web-artifacts-builder'},
 {title:'Проверка веб-приложений',icon:'check',description:'Тестирование сценариев в браузере, снимки экрана и диагностика интерфейса.',archive:'webapp-testing'},
];
export const TOOL_STARTERS=[
 {title:'Найти и сверить источники',icon:'globe',description:'Поиск с материалами, на которые можно сослаться.',prompt:'Найди в интернете '},
 {title:'Составить план работы',icon:'plan',description:'Разбивка задачи на шаги с чек-листом.',prompt:'Составь план для '},
 {title:'Проверить код',icon:'code',description:'Разбор ошибок и конкретные предложения по правкам.',prompt:'Проверь код: '},
];

function hero(title,description){
 return `<header class="studio-hero"><h1>${title}</h1><p>${description}</p></header>`;
}

export function renderFocusCode({e,brief,project,runs=[]}){
 return `<section class="studio">
  ${hero('Focus Code','Создание, исправление и ревью настоящих многофайловых проектов в отдельном режиме программирования.')}
  <form class="studio-panel studio-form" id="code-studio-form">
   <div class="studio-panel-head"><h2>Задача для Focus Code</h2>${project?`<span class="studio-tag">${icon('folder')}${e(project)}</span>`:''}</div>
   <label for="code-brief">Что нужно написать или исправить?</label>
   <textarea id="code-brief" name="brief" rows="5" maxlength="20000" required placeholder="Например, создай Telegram-бота на Python с базой данных, тестами и инструкцией запуска…">${e(brief)}</textarea>
   <div class="studio-form-bottom"><div class="studio-chips">${CODE_STARTERS.map((item,index)=>`<button type="button" data-action="code-starter" data-id="${index}">${icon(item.icon)}${item.title}</button>`).join('')}</div>
   <button class="studio-primary" type="submit">${icon('code')} Запустить Focus Code</button></div>
  </form>
  <section class="studio-section" aria-labelledby="focus-code-runs"><div class="studio-section-head"><h2 id="focus-code-runs">Последние задачи</h2><span>${runs.length}</span></div>
   ${runs.length?`<div class="studio-list">${runs.map(run=>`<article class="studio-card studio-tool-card"><span class="studio-tool-icon">${icon('code')}</span><div class="studio-tool-description"><h3>${e(run.title)}</h3><p>${e(run.project)} · ${e(run.updated)}</p></div><button class="studio-secondary" type="button" data-action="studio-open-chat" data-id="${e(run.id)}">Открыть ${icon('chevron')}</button></article>`).join('')}</div>`:`<div class="studio-empty">${icon('code')}<p>Здесь появятся задачи, выполненные через Focus Code.</p></div>`}
  </section>
 </section>`;
}

export function renderFocusForge({e,brief,project,checkpoints=[]}){
 return `<section class="studio">
  ${hero('Focus Forge','От идеи до собранного проекта: файлы, самопроверка, предпросмотр и отдельные контрольные точки.')}
  <form class="studio-panel studio-form" id="forge-studio-form">
   <div class="studio-panel-head"><h2>Новая сборка</h2>${project?`<span class="studio-tag">${icon('folder')}${e(project)}</span>`:''}</div>
   <label for="forge-brief">Какой готовый результат собрать?</label>
   <textarea id="forge-brief" name="brief" rows="5" maxlength="20000" required placeholder="Например, собери приложение учёта расходов с категориями, графиками, экспортом данных и мобильным интерфейсом…">${e(brief)}</textarea>
   <div class="studio-form-bottom"><div class="studio-chips">${FORGE_STARTERS.map((item,index)=>`<button type="button" data-action="forge-starter" data-id="${index}">${icon(item.icon)}${item.title}</button>`).join('')}</div>
   <button class="studio-primary" type="submit">${icon('check')} Собрать проект</button></div>
  </form>
  <section class="studio-section" aria-labelledby="focus-forge-checkpoints"><div class="studio-section-head"><h2 id="focus-forge-checkpoints">Контрольные точки</h2><span>${checkpoints.length}</span></div>
   ${checkpoints.length?`<div class="studio-list">${checkpoints.map(item=>`<article class="studio-card studio-tool-card"><span class="studio-tool-icon">${icon('folder')}</span><div class="studio-tool-description"><h3>${e(item.name)}</h3><p>${item.files} ${item.files===1?'файл':'файлов'} · ${e(item.updated)}</p></div><button class="studio-secondary" type="button" data-action="open-forge-checkpoint" data-id="${e(item.id)}">Открыть ${icon('chevron')}</button></article>`).join('')}</div>`:`<div class="studio-empty">${icon('folder')}<p>После первой сборки здесь появятся сохранённые версии проекта.</p></div>`}
  </section>
 </section>`;
}

export function renderSites({e,brief,project,sites,busy,canPublish}){
 return `<section class="studio">
  ${hero('Сайты','Опиши страницу, открой предпросмотр и продолжи правки в диалоге.')}
  <form class="studio-panel studio-form" id="site-studio-form">
   <div class="studio-panel-head"><h2>Новый сайт</h2>${project?`<span class="studio-tag">${icon('folder')}${e(project)}</span>`:''}</div>
   <label for="site-brief">Что должно быть на сайте?</label>
   <textarea id="site-brief" name="brief" rows="4" maxlength="10000" required placeholder="Например, сайт кофейни с меню, адресом и часами работы…">${e(brief)}</textarea>
   <div class="studio-form-bottom"><div class="studio-chips">${SITE_STARTERS.map((item,index)=>`<button type="button" data-action="site-starter" data-id="${index}">${icon(item.icon)}${item.title}</button>`).join('')}</div>
   <button class="studio-primary" type="submit" ${busy?'disabled':''}>${icon('plus')} Создать сайт</button></div>
  </form>
  <section class="studio-section" aria-labelledby="studio-sites-title">
   <div class="studio-section-head"><h2 id="studio-sites-title">Мои сайты</h2><span>${sites.length}</span></div>
   ${sites.length?`<div class="studio-grid studio-grid--sites">${sites.map(({id,title,project,updated})=>`<article class="studio-card">
    <div class="studio-card-body"><h3>${e(title)}</h3><small>${e(project)} · ${e(updated)}</small>
    <div class="studio-card-actions"><button type="button" data-action="studio-open-site" data-id="${e(id)}">Открыть ${icon('external')}</button><button type="button" data-action="studio-download-site" data-id="${e(id)}">${icon('download')} HTML</button><button type="button" data-action="site-versions" data-id="${e(id)}">${canPublish?'Версии и ссылки':'Версии'}</button></div></div>
   </article>`).join('')}</div>`:`<div class="studio-empty">${icon('globe')}<p>Здесь появятся сайты, созданные в Focus.</p></div>`}
  </section>
 </section>`;
}

export function renderImages({e,form,files,source,access,hasPass,subscriptionUntil,project,busy,error}){
 const paid=form.mode==='paid';
 const canEdit=!source||!paid||access?.paidEdits!==false;
 const canResize=!paid||access?.paidFormats!==false;
 const blocked=paid?access?.paid===false||!hasPass||!canEdit:access?.free===false;
 const gallery=form.favorites?files.filter(file=>file.favorite):files;
 return `<section class="studio">
  ${hero('Изображения','Создавай изображения по описанию, редактируй детали и собирай избранное.')}
  <form class="studio-panel studio-form" id="image-studio-form" aria-busy="${busy}">
   <div class="studio-panel-head"><h2>${source?'Редактирование':'Новое изображение'}</h2>${project?`<span class="studio-tag">${icon('folder')}${e(project)}</span>`:''}</div>
   <fieldset class="studio-models"><legend>Режим генерации</legend>
    <label class="studio-model"><input type="radio" name="image-mode" value="free" ${paid?'':'checked'}><span><strong>Базовый</strong><small>${access?.free===false?'Не подключён':'Бесплатная квота'}</small></span></label>
    <label class="studio-model"><input type="radio" name="image-mode" value="paid" ${paid?'checked':''}><span><strong>${e(access?.paidLabel||'Улучшенный')}</strong><small>${access?.paid===false?'Не подключён':'По подписке'}</small></span></label>
   </fieldset>
   ${paid?`<div class="studio-access"><span>${subscriptionUntil>Date.now()?'Подписка до '+new Date(subscriptionUntil).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):hasPass?'Код подписки сохранён для этой вкладки':'Для этого режима нужен код подписки.'}</span><button class="studio-text-button" type="button" data-action="image-subscription">${subscriptionUntil>Date.now()?'Активировать другой код':hasPass?'Управлять кодом':'Ввести код'}</button></div>`:''}
   ${source?`<div class="studio-reference">${icon('image')}<span>Исходное изображение · ${e(source.name)}</span><button class="studio-text-button" type="button" data-action="studio-clear-reference">Убрать</button></div>`:''}
   ${!canEdit?`<p class="studio-status">Для редактирования выбери базовый режим.</p>`:''}
   <label for="image-brief">${source?'Что изменить?':'Что создать?'}</label>
   <textarea id="image-brief" name="brief" rows="4" maxlength="${paid?4000:2048}" required placeholder="${source?'Например, замени фон на тёплый светло-серый…':'Опиши сюжет, стиль, свет и детали…'}">${e(form.brief)}</textarea>
   ${source?'':`<div class="studio-chips studio-image-presets">${IMAGE_STARTERS.map((item,index)=>`<button type="button" data-action="image-starter" data-id="${index}" aria-pressed="${form.style===item.style}">${item.title}</button>`).join('')}</div>`}
   <div class="studio-form-bottom">
    ${canResize?`<label class="studio-format" for="image-format">Формат
     <select id="image-format" name="ratio">
      ${source?`<option value="" ${form.ratio?'':'selected'}>Как у оригинала</option>`:''}
      ${[['1:1','Квадрат · 1:1'],['16:9','Горизонтальный · 16:9'],['9:16','Вертикальный · 9:16']].map(([id,label])=>`<option value="${id}" ${id===form.ratio?'selected':''}>${label}</option>`).join('')}
     </select>
    </label>`:'<span class="studio-status">Формат определяет модель</span>'}
    ${busy?`<button type="button" class="studio-secondary" data-action="studio-stop-image">Остановить</button>`:`<button class="studio-primary" type="submit" ${blocked?'disabled':''}>${icon('image')} ${source?'Применить правки':'Сгенерировать'}</button>`}
   </div>
   ${busy?`<p class="studio-status" role="status">Готовлю изображение…</p>`:''}
   ${error?`<p class="studio-status studio-error" role="alert">${e(error)}</p>`:''}
  </form>
  <section class="studio-section" aria-labelledby="studio-images-title">
   <div class="studio-section-head"><h2 id="studio-images-title">Мои изображения</h2><button class="studio-secondary" type="button" data-action="studio-favorites" aria-pressed="${form.favorites}">Избранное</button></div>
   ${gallery.length?`<div class="studio-grid studio-grid--images">${gallery.map(({id,name,prompt,favorite})=>`<article class="studio-card">
    <div class="studio-image-art"><img loading="lazy" data-generated-file="${e(id)}" alt="${e(prompt||name)}"><button type="button" class="studio-star" data-action="studio-image-favorite" data-id="${e(id)}" aria-pressed="${!!favorite}" aria-label="Избранное: ${e(name)}">${icon('star')}</button></div>
    <div class="studio-card-body"><h3 title="${e(prompt||name)}">${e(prompt||name)}</h3>
    <div class="studio-card-actions"><button type="button" data-action="studio-edit-image" data-id="${e(id)}">Редактировать</button><button type="button" data-action="download-file" data-id="${e(id)}">${icon('download')} Скачать</button></div></div>
   </article>`).join('')}</div>`:`<div class="studio-empty">${icon('image')}<p>${form.favorites?'Отметь изображение звёздочкой, чтобы добавить его сюда.':'Здесь появятся изображения из студии и диалогов.'}</p></div>`}
  </section>
 </section>`;
}

export function renderSkills(){
 return `<section class="studio">
  ${hero('Скиллы','Скачай инструкции для своего агента или открой инструмент Focus в диалоге.')}
  <section class="studio-section" aria-labelledby="studio-skills-title">
   <div class="studio-section-head"><h2 id="studio-skills-title">Скачать скилл</h2><span>ZIP</span></div>
   <div class="studio-list">${SKILLS.map(item=>`<article class="studio-card studio-tool-card">
    <span class="studio-tool-icon">${icon(item.icon)}</span><div class="studio-tool-description"><h3>${item.title}</h3><p>${item.description}</p></div>
    <a class="studio-secondary" href="/skill-${item.archive}.zip" download="${item.archive}.zip">${icon('download')} Скачать ZIP</a>
   </article>`).join('')}</div>
  </section>
  <section class="studio-section" aria-labelledby="studio-tools-title">
   <div class="studio-section-head"><h2 id="studio-tools-title">Инструменты Focus</h2><span>В чате</span></div>
   <div class="studio-list">${TOOL_STARTERS.map((item,index)=>`<article class="studio-card studio-tool-card">
    <span class="studio-tool-icon">${icon(item.icon)}</span><div class="studio-tool-description"><h3>${item.title}</h3><p>${item.description}</p></div>
    <button class="studio-secondary" type="button" data-action="studio-tool" data-id="${index}">Открыть в чате ${icon('chevron')}</button>
   </article>`).join('')}</div>
  </section>
 </section>`;
}
