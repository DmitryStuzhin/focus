export const STORAGE_KEY='focus.workspace.v1';
let scope='';
const scoped=key=>scope?key+'.'+scope:key;
export const selectStorageScope=id=>{scope=id||'';};
export const AUTH_EVENT_KEY='focus.auth.changed';
export const uid=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
export const fresh=()=>({version:1,projects:[{id:'personal',name:'Личное пространство',description:'',created:Date.now(),deleted:false}],chats:[],files:[],changes:[],settings:{name:'Моё пространство',model:'flash',effort:'balanced',theme:'system',textSize:'normal',density:'normal',sendOnEnter:true,showFiles:true,webSearch:false},activeProject:'personal',activeChat:null});
function normalizeState(data){
 if(data?.version!==1||!['projects','chats','files'].every(key=>Array.isArray(data[key])))return fresh();
 const defaults=fresh();
 return {...defaults,...data,settings:{...defaults.settings,...data.settings}};
}
export async function readState(){
 const key=scoped(STORAGE_KEY),db=await fileDB();
 const saved=await transact('workspace','readonly',store=>store.get('state'),db);
 if(saved!==undefined)return normalizeState(saved);
 let legacy;
 try{legacy=localStorage.getItem(key);}catch{}
 if(legacy===null||legacy===undefined)return fresh();
 let data;
 try{data=normalizeState(JSON.parse(legacy));}catch{return fresh();}
 try{
  // add protects data written by another tab during migration.
  await transact('workspace','readwrite',store=>store.add(data,'state'),db);
 }catch(error){
  if(error.name!=='ConstraintError')throw error;
  return normalizeState(await transact('workspace','readonly',store=>store.get('state'),db));
 }
 try{if(localStorage.getItem(key)===legacy)localStorage.removeItem(key);}catch{}
 return data;
}
export function writeState(state){
 const snapshot=structuredClone(state);
 return transact('workspace','readwrite',store=>store.put(snapshot,'state'));
}
const fileDatabases=new Map();
export async function fileDB(){
 const key=scoped('focus.files.v1');
 if(!fileDatabases.has(key)){
  const db=new Promise((resolve,reject)=>{
   const request=indexedDB.open(key,2);
   request.onupgradeneeded=()=>{
    if(!request.result.objectStoreNames.contains('blobs'))request.result.createObjectStore('blobs');
    if(!request.result.objectStoreNames.contains('workspace'))request.result.createObjectStore('workspace');
   };
   request.onsuccess=()=>{
    request.result.onversionchange=()=>{request.result.close();fileDatabases.delete(key);};
    resolve(request.result);
   };
   request.onerror=()=>reject(request.error);
  });
  fileDatabases.set(key,db);
  db.catch(()=>fileDatabases.delete(key));
 }
 return fileDatabases.get(key);
}
async function transact(name,mode,operation,database){
 const db=database??await fileDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(name,mode);
  let request;
  try{request=operation(tx.objectStore(name));}catch(error){tx.abort();reject(error);return;}
  tx.oncomplete=()=>resolve(request?.result);
  tx.onerror=()=>reject(request?.error||tx.error);
  tx.onabort=()=>reject(request?.error||tx.error||new Error('Не удалось сохранить данные'));
 });
}
export const putBlob=(id,blob)=>transact('blobs','readwrite',store=>store.put(blob,id));
export const getBlob=id=>transact('blobs','readonly',store=>store.get(id));
export const deleteBlob=id=>transact('blobs','readwrite',store=>store.delete(id));
export async function replaceWorkspace(state,blobs){
 const db=await fileDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['workspace','blobs'],'readwrite');
  const files=tx.objectStore('blobs');
  tx.oncomplete=resolve;
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||new Error('Не удалось восстановить данные'));
  try{
   files.clear();
   for(const [id,blob] of blobs)files.put(blob,id);
   tx.objectStore('workspace').put(state,'state');
  }catch(error){tx.abort();reject(error);}
 });
}
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const text=max=>value=>typeof value==='string'&&value.length<=max;
const number=value=>Number.isSafeInteger(value)&&value>=0;
const bool=value=>typeof value==='boolean';
const optional=check=>value=>value==null||check(value);
const list=(check,max)=>value=>Array.isArray(value)&&value.length<=max&&value.every(check);
const object=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).every(key=>Object.hasOwn(fields,key))&&
 Object.entries(fields).every(([key,check])=>check(value[key]));
const shape=fields=>value=>object(value,fields);
const short=optional(text(256)),date=optional(number),flag=optional(bool),id=optional(safeId);
const path=optional(text(512));
const strings=optional(list(text(600),10));
const search=optional(shape({
 query:text(600),sources:list(shape({
  id:number,url:value=>typeof value==='string'&&value.length<=4096&&/^https?:\/\//u.test(value),
  domain:text(255),title:text(200),snippet:text(1800),
 }),24),searchedAt:short,queries:strings,failedQueries:strings,
}));
function metric(value,depth=0){
 if(value===null||Number.isFinite(value)||bool(value)||text(80)(value))return true;
 if(depth>=3||!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.length<=16&&value.every(item=>metric(item,depth+1));
 return Object.keys(value).length<=32&&Object.entries(value).every(([key,item])=>
  /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(key)&&metric(item,depth+1));
}
const usage=optional(metric);
const projectSearch=optional(shape({
 query:text(600),summary:text(1000),
 results:list(shape({fileId:safeId,path:text(512),line:number,snippet:text(2000)}),100),
}));
const selection=optional(shape({messageId:safeId,block:number}));
const report=optional(shape({
 version:number,kind:text(30),status:text(30),limitation:text(600),
 files:list(text(200),200),
 checks:list(shape({id:safeId,label:text(120),status:text(30),detail:text(5000)}),20),
 checkpoint:optional(shape({id:safeId,count:number,name:text(120)})),
}));
const message=shape({
 id:safeId,content:text(500000),role:optional(value=>['user','assistant'].includes(value)),
 at:date,files:optional(list(safeId,1000)),quote:optional(text(4000)),webSearch:flag,
 model:short,siteMode:flag,previewKind:short,taskMode:short,codeMode:flag,imageFile:id,
 codeTargets:optional(list(shape({id:safeId,name:text(512),hash:short}),20)),
 usage,truncated:flag,search,forge:report,projectSearch,rating:optional(value=>value==='helpful'),
 researchPlan:optional(shape({question:text(600),queries:strings,sources:text(30),background:flag})),
});
const project=shape({id:safeId,name:text(120),description:optional(text(10000)),
 created:date,updated:date,deleted:flag,deletedAt:date,instructions:optional(text(10000))});
const chat=shape({id:safeId,project:safeId,title:text(512),created:date,updated:date,deletedAt:date,
 deleted:flag,archived:flag,messages:list(message,10000),preview:selection,siteVersion:id,
 backgroundJob:id,pendingSearch:search,error:optional(text(4000))});
const file=shape({id:safeId,project:safeId,parent:id,name:text(512),type:short,size:date,
 kind:value=>['file','folder'].includes(value),created:date,updated:date,deleted:flag,deletedAt:date,
 forgeManaged:flag,sourcePath:path,imagePrompt:optional(text(150000)),favorite:flag});
const settings=shape({name:text(512),theme:value=>['light','dark','system'].includes(value),
 textSize:optional(value=>['normal','large'].includes(value)),density:optional(value=>['normal','compact'].includes(value)),
 model:short,effort:short,sendOnEnter:flag,showFiles:flag,webSearch:flag});
const blobs=value=>value==null||value&&typeof value==='object'&&!Array.isArray(value);
const backup=shape({version:value=>value===1,projects:list(project,2000),chats:list(chat,5000),
 files:list(file,10000),changes:list(shape({id:safeId,text:text(5000),project:safeId,at:date}),400),
 settings,activeProject:id,activeChat:id,blobs});

export function validBackup(value){
 if(!backup(value))return false;
 const unique=items=>new Map(items.map(item=>[item.id,item]));
 const projects=unique(value.projects),chats=unique(value.chats),files=unique(value.files);
 if(projects.size!==value.projects.length||chats.size!==value.chats.length||files.size!==value.files.length)return false;
 if(value.activeProject&&!projects.has(value.activeProject)||value.activeChat&&!chats.has(value.activeChat))return false;
 if(value.chats.some(item=>!projects.has(item.project))||value.files.some(item=>!projects.has(item.project)))return false;
 for(const item of value.files){
  const seen=new Set([item.id]);
  for(let parent=item.parent;parent;){
   const entry=files.get(parent);
   if(!entry||entry.kind!=='folder'||entry.project!==item.project||seen.has(parent)||seen.size>64)return false;
   seen.add(parent);
   parent=entry.parent;
  }
 }
 for(const [key,encoded] of Object.entries(value.blobs||{})){
  if(files.get(key)?.kind!=='file'||typeof encoded!=='string'||encoded.length>36_000_000)return false;
  const parts=/^data:([a-z0-9.+/-]*(?:;charset=[a-z0-9-]+)?);base64,([A-Za-z0-9+/]*={0,2})$/iu.exec(encoded);
  if(!parts||parts[2].length%4!==0||parts[2].length/4*3-(parts[2].endsWith('==')?2:parts[2].endsWith('=')?1:0)>25*1048576)return false;
 }
 return true;
}
