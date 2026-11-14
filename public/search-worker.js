const entries=new Map();

self.onmessage=async({data})=>{
 const {id,removed,changed,query,scope}=data;
 try{
  for(const key of removed)entries.delete(key);
  for(const entry of changed){
   const content=[entry.title,...(entry.messages||[])].join('\n');
   const file=entry.blob?await entry.blob.text():'';
   entries.set(entry.key,{...entry,messages:undefined,blob:undefined,
    index:(content+'\n'+file).toLocaleLowerCase('ru')});
  }
  const match=query.trim().toLocaleLowerCase('ru');
  const rows=[];
  for(const {index,key,...entry} of entries.values()){
   if((!scope||entry.project===scope)&&(!match||index.includes(match)))rows.push(entry);
   if(rows.length===30)break;
  }
  self.postMessage({id,rows});
 }catch{
  self.postMessage({id,error:'Не удалось построить индекс поиска.'});
 }
};
