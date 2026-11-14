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
