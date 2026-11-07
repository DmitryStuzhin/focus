const escapePageText=value=>value.replace(/[&<>"'`]/gu,char=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;',
})[char]);

export function createSiteDraft(prompt){
 const brief=prompt.replace(/^\s*\/(?:site|code)\s*/iu,'').trim();
 const dental=/(?:стоматолог|дантист|dental|dentist)/iu.test(brief);
 const customName=brief.match(/(?:под названием|с названием|назови|название\s*:|called)\s*[«"“]([^»"”\n]{1,80})[»"”]/iu)?.[1];
 const subject=brief.match(/(?:сайт|лендинг|страницу)\s+(?:для|про|о)\s+([^.!?\n]{1,75})/iu)?.[1]?.trim();
 const name=escapePageText(customName||(dental?'Стоматология':subject?subject[0].toUpperCase()+subject.slice(1):'Новый сайт'));
 const dark=/(?:т[её]мн\p{L}*\s+(?:тем|фон)|dark theme)/iu.test(brief);
 const colors=dark
  ?{bg:'#121b19',ink:'#e6eee9',muted:'#a2b5ab',line:'#32443c',card:'#1d2d26',accent:'#a4d6bd',button:'#132b20'}
  :{bg:'#f7f6f0',ink:'#18372d',muted:'#526760',line:'#dce4d9',card:'#e5eee3',accent:'#24614a',button:'#fff'};
 const content=dental?{
  category:'СТОМАТОЛОГИЧЕСКАЯ КЛИНИКА',headline:'Забота о вашей улыбке',
  intro:'Начните с консультации. Обсудите, что вас беспокоит, и узнайте, какие варианты лечения вам подходят.',
  sections:[['Консультация','Осмотр и обсуждение индивидуального плана лечения.'],['Профилактика','Профессиональная гигиена и рекомендации по уходу за зубами.'],['Лечение','Восстановление зубов и обсуждение дальнейшего ухода.']],
  faq:[['Как подготовиться к консультации?','Возьмите результаты предыдущих обследований, если они есть, и запишите вопросы врачу.'],['Как записаться?','Здесь можно добавить телефон клиники или ссылку на форму записи.']],
 }:{
  category:'ПРЕДСТАВЛЕНИЕ ПРОЕКТА',headline:name,
  intro:'Расскажите посетителям о проекте и помогите им выбрать следующий шаг.',
  sections:[['О проекте','Объясните, какую задачу решает ваш проект.'],['Что мы предлагаем','Опишите основные услуги или возможности.'],['Как начать','Подскажите посетителю, что сделать дальше.']],
  faq:[['Где узнать подробности?','Добавьте здесь ответ на частый вопрос о проекте.'],['Как связаться?','Добавьте актуальный способ связи в раздел «Контакты».']],
 };
 const mark=dental
  ?'<path d="M60 23c-13-9-29-2-29 13 0 10 5 18 9 28 4 11 4 24 12 24 7 0 6-22 13-22s6 22 13 22c8 0 8-13 12-24 4-10 9-18 9-28 0-15-16-22-29-13l-5 3z"/>'
  :'<path d="M31 73l34-38 34 38M43 73h44M65 35v38"/>';
 return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title><style>
:root{color-scheme:${dark?'dark':'light'};--bg:${colors.bg};--ink:${colors.ink};--muted:${colors.muted};--line:${colors.line};--card:${colors.card};--accent:${colors.accent};--button:${colors.button}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:var(--bg);font:15px/1.65 system-ui,sans-serif}a{color:inherit}a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.wrap{width:min(1050px,calc(100% - 40px));margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 0;border-bottom:1px solid var(--line)}.brand{font-weight:700;text-decoration:none}.nav{display:flex;flex-wrap:wrap;gap:14px;font-size:13px}.nav a{text-decoration:none}
.hero{display:grid;grid-template-columns:1.25fr 1fr;align-items:center;gap:clamp(16px,5vw,64px);padding:clamp(42px,9vw,100px) 0}.eyebrow{letter-spacing:.15em;font-weight:700;font-size:10px;color:var(--accent)}h1,h2{font-family:Georgia,serif;line-height:1.07;font-weight:normal;overflow-wrap:anywhere}h1{font-size:clamp(36px,7vw,76px);margin:12px 0 18px}h2{font-size:clamp(29px,5vw,46px);margin:0 0 18px}p{color:var(--muted);margin:0 0 16px}.cta{display:inline-block;padding:12px 20px;background:var(--accent);color:var(--button);border-radius:999px;text-decoration:none;font-weight:650}.visual{min-height:245px;border-radius:48% 48% 16px 16px;background:radial-gradient(circle at 50% 30%,var(--bg),var(--card));border:1px solid var(--line);display:grid;place-items:center}.visual svg{width:65%;max-width:230px;color:var(--accent)}
.section{padding:36px 0;border-top:1px solid var(--line)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.card{padding:19px;background:var(--card);border-radius:12px}.card small{font-size:11px;color:var(--accent)}.card h3{font-size:17px;margin:8px 0}.card p{font-size:14px;margin:0}details{border-bottom:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:650}details p{margin:8px 0 0}.footer{border-top:1px solid var(--line);padding:20px 0;color:var(--muted);font-size:13px}
@media(max-width:620px){.hero,.grid{grid-template-columns:1fr}.visual{min-height:160px}.visual svg{width:120px}.top{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><div class="wrap">
<header class="top"><a class="brand" href="#home">${name}</a><nav class="nav" aria-label="Навигация"><a href="#services">Услуги</a><a href="#faq">Вопросы</a><a href="#contacts">Контакты</a></nav></header>
<main id="home">
<section class="hero"><div><div class="eyebrow">${content.category}</div><h1>${content.headline}</h1><p>${content.intro}</p><a class="cta" href="#contacts">${dental?'Узнать, как записаться':'Связаться'}</a></div>
<div class="visual" aria-hidden="true"><svg viewBox="0 0 130 112" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="65" cy="56" r="53" opacity=".25"/>${mark}</svg></div></section>
<section id="services" class="section"><h2>${dental?'Услуги клиники':'О проекте'}</h2><div class="grid">${content.sections.map(([title,desc],i)=>`<article class="card"><small>0${i+1}</small><h3>${title}</h3><p>${desc}</p></article>`).join('')}</div></section>
<section id="faq" class="section"><h2>Частые вопросы</h2>${content.faq.map(([question,answer])=>`<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</section>
<section id="contacts" class="section"><h2>Контакты</h2><p>${dental?'Укажите адрес клиники, телефон и часы приёма.':'Укажите адрес, телефон или электронную почту.'}</p></section>
</main><footer class="footer">${name}</footer></div></body></html>`;
}

export function createGameDraft(){
 return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Поймай импульс</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#12121c;color:#faf7ff;font:16px/1.45 system-ui,sans-serif;padding:16px}main{width:min(100%,420px)}h1{font-size:clamp(25px,7vw,42px);margin:0}p{margin:8px 0 16px;color:#d3cce2}button{border:0;cursor:pointer;font:inherit;touch-action:manipulation}button:focus-visible{outline:3px solid white;outline-offset:3px}.stats{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0;color:#ded7eb}.board{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.cell{min-height:44px;aspect-ratio:1;border:1px solid #48425d;border-radius:14px;background:#282539;color:#c4bad7}.cell[data-target]{background:#ddfc82;border-color:#ddfc82;color:#272f10;font-weight:800}.cell:disabled{cursor:default}.start{width:100%;margin-top:14px;min-height:46px;border-radius:12px;background:#ddfc82;color:#272f10;font-weight:800}.start:disabled{opacity:.55;cursor:default}#status{min-height:2.8em;margin:8px 0 0}
</style></head>
<body><main>
<h1>Поймай импульс</h1>
<p>Нажимай на светящуюся клетку или её цифру. Каждые три попадания ускоряют игру.</p>
<div class="stats"><span>Счёт <output id="score">0</output></span><span>Время <output id="time">20</output> с</span><span>Рекорд <output id="best">0</output></span></div>
<div class="board" aria-label="Игровое поле"></div>
<button class="start" id="start" type="button">Играть</button>
<p id="status" role="status"></p>
</main><script>
const board=document.querySelector('.board');
const score=document.querySelector('#score'), time=document.querySelector('#time');
const best=document.querySelector('#best'), start=document.querySelector('#start');
const status=document.querySelector('#status');
const cells=Array.from({length:9},(_,index)=>{
 const cell=document.createElement('button');
 cell.type='button';
 cell.className='cell';
 cell.textContent=String(index+1);
 cell.disabled=true;
 cell.addEventListener('click',()=>hit(index));
 board.append(cell);
 return cell;
});
let points=0, record=0, target=-1, deadline=0, moveTimer, clockTimer;
function moveTarget(){
 if(!deadline)return;
 if(performance.now()>=deadline){finish();return;}
 if(target>=0)cells[target].removeAttribute('data-target');
 const offset=1+Math.floor(Math.random()*8);
 target=(target+offset)%cells.length;
 cells[target].setAttribute('data-target','');
 clearTimeout(moveTimer);
 moveTimer=setTimeout(moveTarget,Math.max(240,900-85*Math.floor(points/3)));
}
function hit(index){
 if(!deadline)return;
 if(performance.now()>=deadline){finish();return;}
 if(index!==target)return;
 score.value=String(++points);
 moveTarget();
}
function finish(){
 deadline=0;
 clearTimeout(moveTimer);
 clearInterval(clockTimer);
 if(target>=0)cells[target].removeAttribute('data-target');
 target=-1;
 time.value='0';
 record=Math.max(record,points);
 best.value=String(record);
 for(const cell of cells)cell.disabled=true;
 start.disabled=false;
 start.textContent='Играть снова';
 status.textContent='Раунд завершён. Счёт: '+points+'.';
 start.focus();
}
start.addEventListener('click',()=>{
 points=0;
 score.value='0';
 time.value='20';
 status.textContent='';
 start.disabled=true;
 for(const cell of cells)cell.disabled=false;
 deadline=performance.now()+20000;
 moveTarget();
 clockTimer=setInterval(()=>{
  const remaining=Math.ceil((deadline-performance.now())/1000);
  if(remaining<=0)finish();
  else time.value=String(remaining);
 },100);
});
document.addEventListener('keydown',event=>{
 if(!event.repeat&&/^[1-9]$/.test(event.key))hit(Number(event.key)-1);
});
</script></body></html>`;
}
