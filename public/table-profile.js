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
