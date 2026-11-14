export function citationFiles(attachments=[]){
 return attachments.filter(file=>typeof file.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/u.test(file.id)&&
  typeof file.text==='string'&&!file.truncated&&file.text.length<=60_000&&file.text.split(/\r\n?|\n/u).length<=1500)
  .map(file=>({id:file.id,name:file.name,lines:file.text.split(/\r\n?|\n/u).length}));
}

export function fileCitations(text,sources){
 const byId=new Map(sources.map(source=>[source.id,source]));
 const found=new Map();
 for(const match of text.matchAll(/\[файл:([A-Za-z0-9_-]{1,80}):L([1-9]\d{0,3})(?:-L?([1-9]\d{0,3}))?\]/giu)){
  const [,id,first,last]=match;
  const source=byId.get(id),start=Number(first),end=Number(last??first);
  if(!source||end<start||end>source.lines||end-start>20)continue;
  found.set(id+':'+start+':'+end,{id,name:source.name,start,end});
  if(found.size>=24)break;
 }
 return [...found.values()];
}
