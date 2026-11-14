import {compareTables,csvTable} from './tabular.js';
import {createDocument} from './office.js';
import {runLocalSkill} from './local-skills.js';

const source='id;сумма\n101;1200\n102;900\n103;500';
const updated='id;сумма\n103;500\n101;1500\n104;250';
const documentSource='Поставщик: ООО «Пример»\nПокупатель: ООО «Маяк»\nСрок оплаты: 10 рабочих дней после подписания акта';

export function exampleResult(kind){
 if(kind==='tables'){
  const {modified,added,removed,matched,sheets}=compareTables(csvTable(source,';',true),csvTable(updated,';',true),'id');
  const changes=sheets.find(sheet=>sheet.name==='Изменено').rows.slice(1)
   .map(([key,,,column,before,after])=>`Запись ${key}, ${column}: ${before} → ${after}`);
  return {title:'Результат сверки',summary:`Изменено: ${modified}. Добавлено: ${added}. Удалено: ${removed}. Совпало: ${matched}.`,
   output:[...changes,'Добавлена запись 104.','Удалена запись 102.'].join('\n')};
 }
 if(kind==='document'){
  const [supplier,buyer,deadline]=documentSource.split('\n').map(line=>line.slice(line.indexOf(':')+2));
  return {title:'Письмо об условиях поставки',summary:'Черновик заполнен по встроенному примеру файла.',
   output:`Для ${buyer}\n\n${supplier} подтверждает условия поставки. Срок оплаты — ${deadline}.\n\nС уважением,\n${supplier}`,download:true};
 }
 if(kind==='calculate'){
  const expression='(125 + 18) * 1,2';
  return {title:'Сумма с надбавкой 20%',summary:'Сначала складываем суммы. Затем умножаем итог на коэффициент 1,2.',
   output:runLocalSkill({mode:'calc',details:expression}).text.replaceAll('**','')};
 }
 return null;
}

if(typeof document!=='undefined'){
 let current;
 const result=document.querySelector('#example-result');
 const download=document.querySelector('#example-download');
 for(const button of document.querySelectorAll('[data-example]')){
  button.addEventListener('click',()=>{
   current=exampleResult(button.dataset.example);
   for(const control of document.querySelectorAll('[data-example]')){
    control.setAttribute('aria-pressed',String(control===button));
   }
   document.querySelector('#example-title').textContent=current.title;
   document.querySelector('#example-summary').textContent=current.summary;
   document.querySelector('#example-output').textContent=current.output;
   download.hidden=!current.download;
   result.hidden=false;
  });
 }
 download.addEventListener('click',()=>{
  const url=URL.createObjectURL(createDocument(current.title,current.output));
  const link=document.createElement('a');
  link.href=url;
  link.download='focus-example.docx';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
