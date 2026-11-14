import {cleanTable} from './table-cleaning.js';
import {showTableProfile} from './table-profile-ui.js';
import {runLocalSkill} from './local-skills.js';
import {openTable,createWorkbook} from './office.js';
import {compareTables,tableKeys} from './tabular.js';

const localForm=document.querySelector('#local-form');
const toolExamples={calc:'(125 + 18) * 1,2',stats:'12; 18; 21; 24',convert:'2,5 км в м',json:'{"сумма":1200}'};
localForm.elements.mode.addEventListener('change',()=>{
 localForm.elements.input.placeholder='Например, '+toolExamples[localForm.elements.mode.value];
});
localForm.addEventListener('submit',event=>{
 event.preventDefault();
 const data=new FormData(localForm);
 const result=runLocalSkill({mode:data.get('mode'),details:data.get('input').trim()});
 document.querySelector('#local-result').textContent=result.error??result.text.replaceAll('**','');
});

const compareForm=document.querySelector('#compare-form');
const download=document.querySelector('#download-report');
let report;
compareForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const data=new FormData(compareForm),button=event.submitter;
 const output=document.querySelector('#compare-result');
 button.disabled=true;
 download.hidden=true;
 output.textContent='Читаем таблицы…';
 try{
  const [before,after]=await Promise.all([openTable(data.get('before')),openTable(data.get('after'))]);
  report=compareTables(before,after,tableKeys(data.get('key')));
  output.textContent=`Изменено: ${report.modified} · Добавлено: ${report.added} · Удалено: ${report.removed} · Совпало: ${report.matched}`;
  download.hidden=false;
 }catch(error){output.textContent=error.message;}
 finally{button.disabled=false;}
});
download.addEventListener('click',()=>{
 try{
  const url=URL.createObjectURL(createWorkbook(report.sheets));
  const link=document.createElement('a');
  link.href=url;
  link.download='focus-сверка.xlsx';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){document.querySelector('#compare-result').textContent=error.message;}
});

const profileForm=document.querySelector('#profile-form');
profileForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const button=event.submitter,summary=document.querySelector('#profile-summary');
 const result=document.querySelector('#profile-result');
 button.disabled=true;
 result.replaceChildren();
 summary.textContent='Читаем таблицу…';
 try{
  showTableProfile(await openTable(new FormData(profileForm).get('table')),summary,result);
 }catch(error){summary.textContent=error.message;}
 finally{button.disabled=false;}
});

const cleanForm=document.querySelector('#clean-form');
const cleanDownload=document.querySelector('#download-clean');
const cleanResult=document.querySelector('#clean-result');
let cleanedRows,cleanRevision=0;
cleanForm.addEventListener('input',()=>{cleanRevision++;cleanedRows=null;cleanDownload.hidden=true;cleanResult.textContent='';});
cleanForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const button=event.submitter;
 button.disabled=true;
 cleanDownload.hidden=true;
 cleanedRows=null;
 const data=new FormData(cleanForm),revision=++cleanRevision;
 try{
  const source=await openTable(data.get('table'));
  if(revision!==cleanRevision)return;
  const column=source[0].map(name=>name.trim()).reduce((positions,name,index)=>{
   if(name===data.get('column').trim())positions.push(index);
   return positions;
  },[]);
  if(column.length!==1)throw new Error('В таблице должен быть один столбец с указанным именем.');
  const report=cleanTable(source,column[0],data.get('mode'),{deduplicate:data.has('deduplicate')});
  cleanedRows=report.rows;
  cleanResult.textContent=[
   `Изменённых ячеек: ${report.changes.length}. Удаляемых дублей: ${report.removed}.`,
   ...report.changes.slice(0,25).map(change=>`Строка ${change.row}: ${change.before} → ${change.after}`),
   ...(report.changes.length>25?['Показаны первые 25 изменений.']:[]),
  ].join('\n');
  cleanDownload.hidden=false;
 }catch(error){cleanResult.textContent=error.message;}
 finally{button.disabled=false;}
});
cleanDownload.addEventListener('click',()=>{
 if(!cleanedRows)return;
 try{
  const url=URL.createObjectURL(createWorkbook([{name:'Очищенные данные',rows:cleanedRows}]));
  const link=document.createElement('a');
  link.href=url;link.download='focus-clean.xlsx';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){cleanResult.textContent=error.message;}
});
