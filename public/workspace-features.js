export async function workspaceAPI(path,body){
 const options=body===undefined?{cache:'no-store'}:{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 };
 const response=await fetch('/api/'+path,options);
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось выполнить действие.'),{status:response.status});
 return data;
}

export async function snapshotWorkspace(state,getBlob,limit=8*1024*1024){
 const snapshot=JSON.parse(JSON.stringify(state));
 const blobs={};
 let bytes=new TextEncoder().encode(JSON.stringify(snapshot)).length;
 for(const file of snapshot.files.filter(file=>file.kind==='file')){
  const blob=await getBlob(file.id);
  if(!blob)continue;
  bytes+=4*Math.ceil(blob.size/3)+200;
  if(bytes>limit)throw new Error('Пространство превышает лимит. Скачайте резервную копию в настройках.');
  blobs[file.id]=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(reader.result);
   reader.onerror=()=>reject(reader.error);
   reader.readAsDataURL(blob);
  });
 }
 return {...snapshot,blobs};
}

export async function restoreWorkspace(snapshot,putBlob){
 for(const [id,value] of Object.entries(snapshot.blobs||{})){
  const comma=value.indexOf(',');
  const bytes=Uint8Array.from(atob(value.slice(comma+1)),character=>character.charCodeAt(0));
  await putBlob(id,new Blob([bytes],{type:value.slice(5,value.indexOf(';'))}));
 }
 const {blobs,...state}=snapshot;
 return state;
}
