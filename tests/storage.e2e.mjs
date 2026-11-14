import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from '../scripts/server.mjs';

const server=createServer({});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/privacy.html`);
 const result=await page.evaluate(async()=>{
  const {STORAGE_KEY,selectStorageScope,fresh,readState,writeState,replaceWorkspace,getBlob}=await import('/store.js');
  selectStorageScope('storage-test');
  const key=STORAGE_KEY+'.storage-test';
  const initial=fresh();
  initial.chats=Array.from({length:500},(_,i)=>({id:'chat-'+i,project:'personal',title:'Chat '+i,messages:[{
   id:'msg-'+i,role:'user',content:'a'.repeat(12000),
  }]}));
  initial.files=Array.from({length:200},(_,i)=>({id:'file-'+i,project:'personal',kind:'file',name:'File '+i}));
  localStorage.setItem(key,JSON.stringify({...fresh(),settings:{...fresh().settings,name:'Legacy'}}));
  const migrated=(await readState()).settings.name;
  await replaceWorkspace(initial,initial.files.map(file=>[file.id,new Blob([file.name])]));
  const state=await readState();
  try{await writeState({...state,unsupported:()=>{}});}catch{}
  return [migrated,localStorage.getItem(key),state.chats.length,state.files.length,
   await (await getBlob('file-199')).text(),(await readState()).chats.length];
 });
 assert.deepEqual(result,['Legacy',null,500,200,'File 199',500]);
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
