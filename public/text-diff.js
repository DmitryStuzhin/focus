export function compareText(before,after,limit=40){
 const lines=text=>text.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n').replace(/\n$/u,'').split('\n');
 const old=before?lines(before):[],next=after?lines(after):[];
 if(old.length>500||next.length>500)throw new Error('Для сравнения используйте файлы до 500 строк каждый.');
 const length=Array.from({length:old.length+1},()=>new Uint16Array(next.length+1));
 for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--){
  length[i][j]=old[i]===next[j]?1+length[i+1][j+1]:Math.max(length[i+1][j],length[i][j+1]);
 }
 const changes=[];
 let i=0,j=0,removed=0,added=0;
 while(i<old.length||j<next.length){
  if(i<old.length&&j<next.length&&old[i]===next[j]){i++;j++;}
  else if(i<old.length&&(j===next.length||length[i+1][j]>=length[i][j+1])){
   if(changes.length<limit)changes.push({type:'removed',line:i+1,text:old[i]});
   removed++;i++;
  }else{
   if(changes.length<limit)changes.push({type:'added',line:j+1,text:next[j]});
   added++;j++;
  }
 }
 return {added,removed,changes};
}
