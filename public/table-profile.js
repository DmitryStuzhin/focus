const numberPattern=/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u;

function quantile(sorted,fraction){
 const index=(sorted.length-1)*fraction,low=Math.floor(index);
 return sorted[low]+(sorted[Math.ceil(index)]-sorted[low])*(index-low);
}

export function profileTable([header,...rows]){
 if(!header?.length)throw new Error('Таблица пуста.');
 const frequencies=new Map();
 for(const row of rows){
  const key=JSON.stringify(row);
  frequencies.set(key,(frequencies.get(key)||0)+1);
 }
 const columns=header.map((name,index)=>{
  const values=rows.map(row=>String(row[index]??'').trim()).filter(Boolean);
  const numbers=values.map(value=>numberPattern.test(value)?Number(value.replace(',','.')):NaN);
  const numeric=numbers.length>0&&numbers.every(value=>Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER);
  const distinct=new Set(values).size;
  let outliers=null,min=null,max=null;
  if(numeric){
   numbers.sort((a,b)=>a-b);
   [min,max]=[numbers[0],numbers.at(-1)];
   if(numbers.length>=4){
    const q1=quantile(numbers,.25),q3=quantile(numbers,.75),margin=1.5*(q3-q1);
    outliers=numbers.filter(value=>value<q1-margin||value>q3+margin).length;
   }
  }
  return {name:name||'Столбец '+(index+1),missing:rows.length-values.length,distinct,
   type:numeric?'Числовой':'Текстовый',outliers,min,max};
 });
 return {rows:rows.length,duplicates:[...frequencies.values()].reduce((sum,count)=>sum+count-1,0),columns};
}

// Aggregate decimal cells as integers at a shared scale so totals stay exact.
export function summarizeTable([header,...rows],groupIndex,valueIndex=null){
 if(!Number.isInteger(groupIndex)||groupIndex<0||groupIndex>=header.length)throw new Error('Выберите столбец для группировки.');
 const sum=valueIndex!==null;
 if(sum&&(!Number.isInteger(valueIndex)||valueIndex<0||valueIndex>=header.length))throw new Error('Выберите столбец для суммы.');
 const groups=new Map();
 let scale=0;
 for(const row of rows){
  const label=String(row[groupIndex]??'').trim();
  if(!groups.has(label))groups.set(label,{label,count:0,sum:0n});
  const group=groups.get(label);
  group.count++;
  if(!sum)continue;
  const value=String(row[valueIndex]??'').trim();
  if(!value)continue;
  if(value.length>40||!numberPattern.test(value))throw new Error('Для суммы выберите столбец с числами до 40 символов.');
  const [whole,part='']=value.replace(/^[+-]/u,'').split(/[.,]/u);
  if(part.length>scale){
   const factor=10n**BigInt(part.length-scale);
   for(const existing of groups.values())existing.sum*=factor;
   scale=part.length;
  }
  const units=BigInt(whole+part)*10n**BigInt(scale-part.length);
  group.sum+=value.startsWith('-')?-units:units;
 }
 return [...groups.values()]
  .sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ru'))
  .map(group=>{
   if(!sum)return {label:group.label,count:group.count};
   const absolute=(group.sum<0n?-group.sum:group.sum).toString().padStart(scale+1,'0');
   const whole=scale?absolute.slice(0,-scale):absolute;
   const part=scale?absolute.slice(-scale).replace(/0+$/u,''):'';
   return {label:group.label,count:group.count,total:(group.sum<0n?'−':'')+whole+(part?','+part:'')};
  });
}
