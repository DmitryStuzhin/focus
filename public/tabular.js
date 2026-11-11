function readCSV(input,separator,preserveSpaces=false){
 const rows=[];
 let row=[],field='',quoted=false,closed=false;
 const text=input.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n');
 const finishField=()=>{
  row.push(preserveSpaces?field:field.trim());
  field='';
  closed=false;
  if(row.length>64)throw new Error('CSV должен содержать до 64 столбцов.');
 };
 const finishRow=()=>{
  finishField();
  if(row.some(Boolean)||row.length>1)rows.push(row);
  row=[];
  if(rows.length>5001)throw new Error('CSV должен содержать до 5000 строк данных.');
 };
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c!=='"')field+=c;
   else if(text[i+1]==='"'){field+='"';i++;}
   else{quoted=false;closed=true;}
  }else if(c===separator)finishField();
  else if(c==='\n')finishRow();
  else if(c==='"'&&!field&&!closed)quoted=true;
  else if(closed||c==='"')throw new Error('Проверьте кавычки в CSV.');
  else field+=c;
 }
 if(quoted)throw new Error('В CSV есть незакрытые кавычки.');
 if(field||row.length||closed)finishRow();
 return rows;
}
export function csvTable(text,option,preserveSpaces=false){
 const delimiters=option?[{'запятая':',','точка-с-запятой':';','табуляция':'\t',',':',',';':';'}[option]]:[';',',','\t'];
 if(!delimiters[0])throw new Error('Укажите разделитель: /csv ; или /csv , или /csv табуляция.');
 let rows,problem;
 for(const separator of delimiters){
  try{
   const candidate=readCSV(text,separator,preserveSpaces);
   if(candidate.length&&candidate.every(row=>row.length===candidate[0].length)&&(!rows||candidate[0].length>rows[0].length))rows=candidate;
  }catch(error){problem=error;}
 }
 if(!rows||rows[0].length<2&&!option)throw new Error(rows||!problem?'Не удалось определить разделитель. Попробуйте /csv ; или /csv ,':problem.message);
 return rows;
}

function indexRows(rows,key,label){
 const [header,...records]=rows;
 const columns=header?.map(value=>value.trim())||[];
 if(!columns.length||columns.some(value=>!value)||new Set(columns).size!==columns.length){
  throw new Error(label+' — заполни уникальные названия столбцов.');
 }
 const position=columns.indexOf(key);
 if(position<0)throw new Error(label+' — столбец «'+key+'» отсутствует.');
 const entries=new Map();
 for(const [index,row] of records.entries()){
  const id=row[position]??'';
  if(!id.trim()||entries.has(id))throw new Error(label+' — пустой или повторный ключ в записи '+(index+1)+'.');
  entries.set(id,{row,number:index+1});
 }
 return {columns,entries};
}

export function compareTables(before,after,key){
 const old=indexRows(before,key,'Первый файл');
 const next=indexRows(after,key,'Второй файл');
 const added=[],removed=[],changed=[];
 const shared=old.columns.flatMap((name,index)=>{
  const newIndex=next.columns.indexOf(name);
  return newIndex<0||name===key?[]:[{name,index,newIndex}];
 });
 let modified=0;
 for(const [id,{row,number}] of old.entries){
  const match=next.entries.get(id);
  if(!match){removed.push([id,number,...old.columns.map((_,index)=>row[index]??'')]);continue;}
  const changes=shared.filter(({index,newIndex})=>(row[index]??'')!==(match.row[newIndex]??''));
  if(changes.length)modified++;
  for(const {name,index,newIndex} of changes)changed.push([id,number,match.number,name,row[index]??'',match.row[newIndex]??'']);
 }
 for(const [id,{row,number}] of next.entries){
  if(!old.entries.has(id))added.push([id,number,...next.columns.map((_,index)=>row[index]??'')]);
 }
 return {added:added.length,removed:removed.length,modified,matched:next.entries.size-added.length-modified,
  sheets:[
   {name:'Добавлено',rows:[['Ключ','Запись',...next.columns],...added]},
   {name:'Удалено',rows:[['Ключ','Запись',...old.columns],...removed]},
   {name:'Изменено',rows:[['Ключ','Старая запись','Новая запись','Столбец','Было','Стало'],...changed]},
   {name:'Столбцы',rows:[['Действие','Имя'],...next.columns.filter(name=>!old.columns.includes(name)).map(name=>['Добавлен',name]),...old.columns.filter(name=>!next.columns.includes(name)).map(name=>['Удалён',name])]}
  ]
 };
}
