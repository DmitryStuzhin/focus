import {csvTable} from './tabular.js';
import {compareText} from './text-diff.js';
// Rational arithmetic keeps decimal inputs and statistics exact.
function fraction(n,d=1n){
 if(!d)throw new Error('Деление на ноль.');
 if(d<0n){n=-n;d=-d}
 let a=n<0n?-n:n,b=d;
 while(b)[a,b]=[b,a%b];
 n/=a;d/=a;
 if(n.toString().length>180||d.toString().length>180)throw new Error('Промежуточное число слишком большое.');
 return [n,d];
}
function decimal(value){
 if(!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)||value.length>40)throw new Error('Ожидается число длиной до 40 символов.');
 const [whole,tail='']=value.replace(/^[+-]/,'').split(/[.,]/);
 return fraction((value.startsWith('-')?-1n:1n)*BigInt(whole+tail),10n**BigInt(tail.length));
}
function calculatePair(op,[a,b],[c,d]){
 switch(op){
  case '+':return fraction(a*d+b*c,b*d);
  case '-':return fraction(a*d-b*c,b*d);
  case '*':return fraction(a*c,b*d);
  case '/':return fraction(a*d,b*c);
  case '^':{
   if(d!==1n||c>20n||c< -20n)throw new Error('Степень должна быть целым числом от −20 до 20.');
   return c<0n?fraction(b**-c,a**-c):fraction(a**c,b**c);
  }
 }
}
function formatFraction([n,d]){
 const abs=n<0n?-n:n;
 let rest=abs%d, digits='';
 while(rest&&digits.length<12){
  rest*=10n;
  digits+=String(rest/d);
  rest%=d;
 }
 if(rest)return n+'/'+d;
 return (n<0n?'−':'')+String(abs/d)+(digits?','+digits:'');
}
function calculate(expression){
 if(!expression||expression.length>180)throw new Error('Введите выражение длиной до 180 символов. Пример: /calc (125 + 18) * 1,2');
 const input=expression.replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-');
 const tokens=input.match(/\d+(?:[.,]\d+)?|[.,]\d+|[-+*/^%()]|\S/gu)||[];
 const precedence={'+':1,'-':1,'*':2,'/':2,'^':3};
 let index=0;
 function read(min=1){
  const token=tokens[index++];
  let value;
  if(token==='('){
   value=read();
   if(tokens[index++]!==')')throw new Error('Проверьте скобки в выражении.');
  }else if(token==='+'||token==='-'){
   const [n,d]=read(3);
   value=[token==='-'?-n:n,d];
  }else{
   value=decimal(token||'');
  }
  if(tokens[index]==='%'){
   index++;
   value=fraction(value[0],value[1]*100n);
  }
  while(precedence[tokens[index]]>=min){
   const op=tokens[index++];
   value=calculatePair(op,value,read(precedence[op]+(op==='^'?0:1)));
  }
  return value;
 }
 const value=read();
 if(index!==tokens.length)throw new Error('Проверьте знаки и скобки в выражении.');
 return '**Результат** '+formatFraction(value);
}
function summarizeNumbers(input){
 if(!input||input.length>2200)throw new Error('Введите числа через пробел, точку с запятой или новую строку. Пример: /stats 12; 18; 21; 24');
 const tokens=input.split(/[\s;]+/u).filter(Boolean);
 if(!tokens.length||tokens.length>100)throw new Error('Введите от 1 до 100 чисел.');
 const values=tokens.map(decimal).sort(([a,b],[c,d])=>a*d<c*b?-1:a*d>c*b?1:0);
 const count=values.length, middle=Math.floor(count/2);
 const sum=values.reduce((total,value)=>calculatePair('+',total,value),[0n,1n]);
 const mean=calculatePair('/',sum,[BigInt(count),1n]);
 const median=count%2?values[middle]:calculatePair('/',calculatePair('+',values[middle-1],values[middle]),[2n,1n]);
 return ['| Показатель | Значение |','| --- | --- |','| Количество | '+count+' |',
  ...[['Сумма',sum],['Среднее',mean],['Медиана',median],['Минимум',values[0]],['Максимум',values.at(-1)]]
   .map(([label,value])=>'| '+label+' | '+formatFraction(value)+' |')].join('\n');
}
const unitFactors=new Map([
 ['мм',['length','0.001']],['см',['length','0.01']],['м',['length','1']],['км',['length','1000']],
 ['мг',['mass','0.001']],['г',['mass','1']],['кг',['mass','1000']],['т',['mass','1000000']],
 ['с',['time','1']],['мин',['time','60']],['ч',['time','3600']],['д',['time','86400']],
 ['мл',['volume','0.001']],['л',['volume','1']],
]);
function convertUnits(input){
 const match=/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*([а-я]+)\s*(?:в|->|→)\s*([а-я]+)$/iu.exec(input);
 const example='Пример: /convert 2,5 км в м.';
 if(!match)throw new Error('Введите число и две единицы. '+example);
 const [,value,from,to]=match;
 const source=unitFactors.get(from.toLowerCase()),target=unitFactors.get(to.toLowerCase());
 if(!source||!target||source[0]!==target[0])throw new Error('Выберите единицы одной величины: длина, масса, время или объём. '+example);
 const base=calculatePair('*',decimal(value),decimal(source[1]));
 return '**Результат** '+formatFraction(calculatePair('/',base,decimal(target[1])))+' '+to.toLowerCase();
}
const tableCell=value=>String(value).slice(0,160).replace(/[\r\n]+/gu,' ').replace(/[|\\`*_~<>[\]]/gu,' ');
function analyzeCSV(text,option){
 const [head,...data]=csvTable(text,option);
 const result=['**Строк данных:** '+data.length+' · **Столбцов:** '+head.length,'','| Столбец | Пустых | Мин. | Макс. | Сумма | Среднее |','| --- | ---: | ---: | ---: | ---: | ---: |'];
 for(const [index,name] of head.entries()){
  const filled=data.map(row=>row[index]).filter(Boolean);
  let stats=['—','—','—','—'];
  if(filled.length&&filled.every(value=>value.length<=40&&/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value))){
   const values=filled.map(decimal);
   const compare=([a,b],[c,d])=>a*d<c*b?-1:a*d>c*b?1:0;
   let low=values[0],high=low,sum=[0n,1n];
   for(const value of values){
    if(compare(value,low)<0)low=value;
    if(compare(value,high)>0)high=value;
    sum=calculatePair('+',sum,value);
   }
   stats=[low,high,sum,calculatePair('/',sum,[BigInt(values.length),1n])].map(formatFraction);
  }
  result.push('| '+(tableCell(name)||'Столбец '+(index+1))+' | '+(data.length-filled.length)+' | '+stats.join(' | ')+' |');
 }
 return result.join('\n');
}
function indexCSV(text,key,label){
 const [rawHeader,...records]=csvTable(text,'',true);
 const header=rawHeader.map(cell=>cell.trim());
 if(header.some(name=>!name)||new Set(header).size!==header.length){
  throw new Error(label+': названия столбцов должны быть заполнены и уникальны.');
 }
 const keyIndex=header.indexOf(key);
 if(keyIndex<0)throw new Error(label+': нет столбца «'+key+'». Укажите общий ключ с точным названием, например: «Сравни CSV по столбцу id».');
 const rows=new Map();
 for(const [index,row] of records.entries()){
  const id=row[keyIndex],number=index+1;
  if(!id.trim())throw new Error(label+': пустой ключ в записи №'+number+'.');
  if(rows.has(id))throw new Error(label+': повтор ключа в записях №'+rows.get(id).number+' и №'+number+'.');
  rows.set(id,{row,number});
 }
 return {header,rows};
}
function compareCSV(before,after,option){
 const key=option.trim().replace(/^(?:«([^»]+)»|"([^"]+)"|`([^`]+)`)$/u,(_match,ru,en,code)=>ru??en??code)||'id';
 if(key.length>100||/[\r\n]/u.test(key))throw new Error('Укажите название одного ключевого столбца до 100 символов.');
 const old=indexCSV(before,key,'Первый файл'),fresh=indexCSV(after,key,'Второй файл');
 const addedColumns=fresh.header.filter(column=>!old.header.includes(column));
 const removedColumns=old.header.filter(column=>!fresh.header.includes(column));
 const shared=old.header.flatMap((column,from)=>{
  const to=fresh.header.indexOf(column);
  return to<0||column===key?[]:[{column,from,to}];
 });
 const changes=[];
 let added=0,removed=0,modified=0;
 const show=value=>tableCell(value)||'∅';
 const report=(kind,id,from,to,detail)=>{
  if(changes.length<20)changes.push('| '+[kind,show(id),from||'—',to||'—',detail||'—'].join(' | ')+' |');
 };
 for(const [id,previous] of old.rows){
  const next=fresh.rows.get(id);
  if(!next){
   removed++;
   report('Удалена',id,previous.number,null);
   continue;
  }
  const changed=shared.filter(({from,to})=>previous.row[from]!==next.row[to]);
  if(!changed.length)continue;
  modified++;
  const details=changed.slice(0,4).map(({column,from,to})=>show(column)+': «'+show(previous.row[from])+'» → «'+show(next.row[to])+'»');
  if(changed.length>4)details.push('ещё '+(changed.length-4));
  report('Изменена',id,previous.number,next.number,details.join(' · '));
 }
 for(const [id,next] of fresh.rows){
  if(old.rows.has(id))continue;
  added++;
  report('Добавлена',id,null,next.number);
 }
 const total=added+removed+modified;
 return [
  'Сверка по столбцу **'+show(key)+'**. Добавлено: '+added+' · Удалено: '+removed+' · Изменено: '+modified+
   ' · Совпало по общим столбцам: '+(fresh.rows.size-added-modified)+'.',
  ...(addedColumns.length?['Добавлены столбцы: '+addedColumns.map(show).join(', ')+'.']:[]),
  ...(removedColumns.length?['Удалены столбцы: '+removedColumns.map(show).join(', ')+'.']:[]),
  ...(changes.length?['','| Статус | Ключ | Запись в первом файле | Запись во втором файле | Изменения |',
   '| --- | --- | ---: | ---: | --- |',...changes]:[]),
  ...(total>changes.length?['','Показаны первые '+changes.length+' из '+total+' изменений.']:[]),
 ].join('\n');
}
function compareFiles(before,after){
 const {added,removed,changes}=compareText(before,after);
 if(!removed&&!added)return 'Содержимое файлов совпадает.';
 return ['Добавлено строк: '+added+' · Удалено: '+removed,'',
  ...changes.map(({type,line,text})=>(type==='removed'?'Удалено':'Добавлено')+' | '+line+' | '+(text.length>240?text.slice(0,240)+'…':text||'∅')),
  ...(added+removed>changes.length?['','Показаны первые '+changes.length+' изменений.']:[])].join('\n');
}
function formatJSON(source){
 const text=source.trim().replace(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/iu,'$1').trim();
 if(!text||text.length>60000)throw new Error('Вставьте JSON или прикрепите один JSON-файл до 60 000 символов.');
 try{JSON.parse(text)}catch(error){
  const position=/\bposition (\d+)/iu.exec(error.message)?.[1];
  const lines=position===undefined?null:text.slice(0,Number(position)).split(/\r\n?|\n/u);
  const location=lines?' Строка '+lines.length+', столбец '+(lines.at(-1).length+1)+'.':'';
  throw new Error('Синтаксическая ошибка в JSON.'+location);
 }
 // Change whitespace only. Parsing and serializing would round large numbers and remove duplicate keys.
 const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/gu);
 let depth=0,formatted='';
 const newline=()=>'\n'+'  '.repeat(Math.min(depth,40));
 for(const [index,token] of tokens.entries()){
  const next=tokens[index+1],previous=tokens[index-1];
  if(token==='{'||token==='['){
   depth++;
   formatted+=token+(next==='}'||next===']'?'':newline());
  }else if(token==='}'||token===']'){
   depth--;
   formatted+=(previous==='{'||previous==='['?'':newline())+token;
  }else if(token===',')formatted+=token+newline();
  else formatted+=token+(token===':'?' ':'');
  if(formatted.length>100000)throw new Error('Форматированный JSON слишком большой. Разделите его на части.');
 }
 return 'JSON корректен.\n\n```json data.json\n'+formatted+'\n```';
}
export function runLocalSkill(intent,attachments=[]){
 if(!intent)return null;
 const skill=intent.mode;
 const files=attachments.filter(file=>typeof file?.text==='string');
 const [solve,model]={
  calc:[calculate,'local-calculator'],
  stats:[summarizeNumbers,'local-statistics'],
  convert:[convertUnits,'local-conversion'],
  csv:[option=>{
   if(files.length!==1||attachments.length!==1)throw new Error('Прикрепите один CSV-файл к сообщению «Проанализируй CSV».');
   return analyzeCSV(files[0].text,option);
  },'local-csv'],
  csvdiff:[key=>{
   if(files.length!==2||attachments.length!==2||files.some(file=>file.truncated)){
    throw new Error('Прикрепите два CSV-файла целиком: сначала старый, затем новый.');
   }
   return compareCSV(files[0].text,files[1].text,key);
  },'local-csv-diff'],
  json:[source=>{
   if(!attachments.length)return formatJSON(source);
   if(source||attachments.length!==1||files.length!==1)throw new Error('Вставьте JSON в сообщение или прикрепите один текстовый JSON-файл.');
   return formatJSON(files[0].text);
  },'local-json'],
  diff:[()=>{
   if(files.length!==2||attachments.length!==2)throw new Error('Прикрепите два текстовых файла: сначала старую версию, затем новую.');
   return compareFiles(files[0].text,files[1].text);
  },'local-diff'],
 }[skill];
 try{
  const text=solve(intent.details);
  return {text,model,provider:'local',search:null,usage:null,truncated:false};
 }catch(error){
  return {error:error.message,code:'skill_input'};
 }
}
