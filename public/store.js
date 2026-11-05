export const STORAGE_KEY='focus.workspace.v1';
export const uid=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
export const fresh=()=>({version:1,projects:[{id:'personal',name:'Личное пространство',description:'',created:Date.now(),deleted:false}],chats:[],files:[],changes:[],settings:{name:'Моё пространство',model:'flash',effort:'balanced',theme:'light',sendOnEnter:true,showFiles:true,webSearch:false},activeProject:'personal',activeChat:null});
export function readState(){try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY));if(d?.version===1&&Array.isArray(d.projects)&&Array.isArray(d.chats)&&Array.isArray(d.files)){return {...fresh(),...d,settings:{...fresh().settings,...d.settings}}}}catch{}return fresh()}
export function writeState(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
let db;
export async function fileDB(){if(db)return db;db=await new Promise((resolve,reject)=>{const r=indexedDB.open('focus.files.v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('blobs');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return db}
async function transact(mode,fn){const d=await fileDB();return new Promise((resolve,reject)=>{const tx=d.transaction('blobs',mode);let result;try{const r=fn(tx.objectStore('blobs'));if(r)r.onsuccess=()=>{result=r.result}}catch(e){reject(e);return}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Не удалось сохранить файл'))})}
export const putBlob=(id,blob)=>transact('readwrite',s=>s.put(blob,id));
export const getBlob=id=>transact('readonly',s=>s.get(id));
export const deleteBlob=id=>transact('readwrite',s=>s.delete(id));
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
export function validBackup(d){return d?.version===1&&Array.isArray(d.projects)&&d.projects.every(p=>safeId(p.id)&&typeof p.name==='string'&&p.name.length<=120)&&Array.isArray(d.chats)&&d.chats.every(c=>safeId(c.id)&&safeId(c.project)&&typeof c.title==='string'&&Array.isArray(c.messages)&&c.messages.every(m=>safeId(m.id)&&typeof m.content==='string'&&['user','assistant',undefined].includes(m.role)&&(!m.files||Array.isArray(m.files)&&m.files.every(safeId))))&&Array.isArray(d.files)&&d.files.every(f=>safeId(f.id)&&safeId(f.project)&&(!f.parent||safeId(f.parent))&&typeof f.name==='string'&&typeof f.type!=='number'&&(!f.type||typeof f.type==='string')&&['file','folder'].includes(f.kind))&&Array.isArray(d.changes)&&d.changes.every(c=>typeof c.text==='string'&&safeId(c.project))&&d.settings&&typeof d.settings==='object'&&typeof d.settings.name==='string'&&['light','dark','system'].includes(d.settings.theme)}

