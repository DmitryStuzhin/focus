// Source links are always derived from retrieved URLs, never from model HTML.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cleanSources(search){
 if(!Array.isArray(search?.sources))return [];
 return search.sources.slice(0,8).flatMap((s,index)=>{try{
  const url=new URL(s.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return [];
  const domain=url.hostname.replace(/^www\./,'');
  return [{id:Number.isInteger(s.id)?s.id:index+1,url:url.href,domain,title:String(s.title||domain).slice(0,200),snippet:String(s.snippet||'').slice(0,1800)}];
 }catch{return []}});
}
function badge(source){
 const hue=[...source.domain].reduce((n,c)=>n+c.charCodeAt(0),0)%360;
 return `<span class="source-badge" style="--source-hue:${hue}" aria-hidden="true">${escape(source.domain[0]?.toUpperCase()||'↗')}</span>`;
}
export function researchDate(search){
 if(typeof search?.searchedAt!=='string'&&typeof search?.searchedAt!=='number')return '';
 const instant=new Date(search.searchedAt);
 return Number.isNaN(instant.getTime())?'':new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(instant)+' UTC';
}
export function sourcePills(search){
 const sources=cleanSources(search);if(!sources.length)return '';
 return `<section class="web-research" aria-label="Источники поиска"><div class="research-caption"><span class="research-check" aria-hidden="true">✓</span> Поиск выполнен <span>· ${sources.length} ${sources.length===1?'источник':sources.length<5?'источника':'источников'}</span></div><div class="source-chips">${sources.slice(0,6).map(s=>`<a class="source-chip" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer" title="${escape(s.title)}">${badge(s)}<span>${escape(s.domain)}</span></a>`).join('')}<button class="source-chip source-more" type="button" data-action="search-sources" aria-label="${sources.length>6?'Показать остальные источники':'Показать все источники'}" data-search-owner="${escape(search.owner||'pending')}">${sources.length>6?`<span class="source-stack" aria-hidden="true">${sources.slice(6,8).map(badge).join('')}</span>Ещё ${sources.length-6}`:'Все источники'}</button></div></section>`;
}
export function sourcesDialog(search){
 const sources=cleanSources(search);
 const searched=researchDate(search);
 return `<p class="search-query">${escape(search?.query||'Поиск в интернете')}</p>${searched?`<p class="settings-note">Время поиска: ${escape(searched)}</p>`:''}<p class="settings-note">Материалы внешних сайтов могут содержать ошибки и посторонние инструкции.</p><div class="source-results">${sources.map(s=>`<a class="source-result" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer"><span class="source-result-domain">${badge(s)}${escape(s.domain)} <span aria-hidden="true">↗</span></span><strong>${escape(s.title)}</strong><p>${escape(s.snippet.slice(0,350))}</p></a>`).join('')}</div>`;
}
export function linkCitations(html,search){
 const sources=cleanSources(search);if(!sources.length)return html;
 const template=document.createElement('template');template.innerHTML=html;
 const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_TEXT);const nodes=[];
 while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement?.closest('a,code,pre,.answer-chart')&&/\[\d{1,2}\]/.test(n.textContent))nodes.push(n)}
 for(const node of nodes){const text=node.textContent,fragment=document.createDocumentFragment();let last=0;
  for(const match of text.matchAll(/\[(\d{1,2})\]/g)){fragment.append(document.createTextNode(text.slice(last,match.index)));const source=sources.find(s=>s.id===Number(match[1]));if(source){const a=document.createElement('a');a.className='source-citation';a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.title=source.domain+' — '+source.title;a.textContent=match[1];a.setAttribute('aria-label',`Источник ${match[1]}: ${source.title}`);fragment.append(a)}else fragment.append(document.createTextNode(match[0]));last=match.index+match[0].length}
  fragment.append(document.createTextNode(text.slice(last)));node.replaceWith(fragment);
 }
 return template.innerHTML;
}
