function normalizeDate(value){
 const match=/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./](\d{1,2})[./](\d{4}))$/u.exec(value);
 if(!match)return value;
 const [,y,m,d,day,month,year]=match;
 const yyyy=y??year,mm=(m??month).padStart(2,'0'),dd=(d??day).padStart(2,'0');
 const iso=yyyy+'-'+mm+'-'+dd,date=new Date(iso+'T00:00:00Z');
 return Number.isFinite(+date)&&date.toISOString().slice(0,10)===iso?iso:value;
}
const normalizers={
 date:normalizeDate,
 phone:value=>{
  const digits=value.replace(/[^0-9]/gu,'');
  return /^[+\d\s()-]+$/u.test(value)&&/^[78]\d{10}$/u.test(digits)?'+7'+digits.slice(1):value;
 },
 inn:value=>{
  const digits=value.replace(/[\s-]/gu,'');
  return /^(?:\d{10}|\d{12})$/u.test(digits)?digits:value;
 },
 name:value=>value.trim().replace(/\s+/gu,' '),
};

export function cleanTable([header,...rows],column,mode,{deduplicate=false}={}){
 if(!header?.length||!Number.isInteger(column)||column<0||column>=header.length||!Object.hasOwn(normalizers,mode)){
  throw new Error('Выберите столбец и правило обработки.');
 }
 const cleaned=[header.slice()],changes=[],seen=new Set();
 let removed=0;
 for(const [index,original] of rows.entries()){
  const row=original.slice(),value=String(row[column]??'');
  row[column]=normalizers[mode](value);
  if(row[column]!==value)changes.push({row:index+2,before:value,after:row[column]});
  const key=JSON.stringify(row);
  if(deduplicate&&seen.has(key)){removed++;continue;}
  seen.add(key);cleaned.push(row);
 }
 return {rows:cleaned,changes,removed};
}
