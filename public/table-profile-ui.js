import {profileTable,summarizeTable} from './table-profile.js';

function element(tag,text){
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
}

function table(caption,headings,rows){
 const node=element('table');
 node.createCaption().textContent=caption;
 const header=node.createTHead().insertRow();
 for(const heading of headings){
  const cell=element('th',heading);
  cell.scope='col';
  header.append(cell);
 }
 const body=node.createTBody();
 for(const values of rows){
  const row=body.insertRow();
  for(const value of values){
   const cell=row.insertCell();
   if(value instanceof Node)cell.append(value);
   else cell.textContent=value??'—';
  }
 }
 return node;
}

function choice(label,columns,empty){
 const field=element('label',label+' ');
 const select=element('select');
 if(empty)select.add(new Option(empty,''));
 columns.forEach((column,index)=>select.add(new Option(column.name,String(index))));
 field.append(select);
 return [field,select];
}

export function showTableProfile(rows,summary,result){
 const profile=profileTable(rows);
 summary.textContent=`Строк: ${profile.rows}. Повторных строк: ${profile.duplicates}. Выбросы рассчитаны по правилу 1,5 межквартильного размаха.`;
 const columns=profile.columns;
 const profileTableView=table('Профиль столбцов',['Столбец','Тип','Пропуски','Уникальных','Минимум','Максимум','Выбросы'],
  columns.map(({name,type,missing,distinct,min,max,outliers})=>[name,type,missing,distinct,min,max,outliers]));
 const grouping=element('div');
 const [groupField,group]=choice('Группировать по',columns,'Выберите столбец');
 const [valueField,value]=choice('Суммировать',columns,'Только количество строк');
 const status=element('p');
 status.setAttribute('role','status');
 const output=element('div');
 const refresh=()=>{
  output.replaceChildren();
  status.textContent='';
  if(group.value==='')return;
  try{
   const sum=value.value!=='';
   const groups=summarizeTable(rows,Number(group.value),sum?Number(value.value):null);
   if(!groups.length){status.textContent='В таблице нет строк для группировки.';return;}
   const label=item=>item.label||'Пустая ячейка';
   const shown=groups.slice(0,100);
   status.textContent=`Групп: ${groups.length}.`+(groups.length>shown.length?' В таблице показаны первые 100 по числу строк.':'');
   output.append(table('Сводная таблица',['Значение','Строки',...(sum?['Сумма']:[])],
    shown.map(item=>[label(item),item.count,...(sum?[item.total]:[])])));
   const bars=groups.slice(0,10).map(item=>{
    const bar=element('meter');
    bar.max=groups[0].count;
    bar.value=item.count;
    bar.setAttribute('aria-label',label(item));
    return [label(item),item.count,bar];
   });
   output.append(table('Диаграмма числа строк по группам',['Значение','Строки','Относительный размер'],bars));
  }catch(error){status.textContent=error.message;}
 };
 group.addEventListener('change',refresh);
 value.addEventListener('change',refresh);
 grouping.append(groupField,valueField,status,output);
 result.replaceChildren(profileTableView,grouping);
}
