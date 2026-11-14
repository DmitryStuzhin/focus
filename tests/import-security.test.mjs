import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,readZip} from '../public/office.js';
import {projectZip} from '../public/project-bundle.js';
import {fresh,validBackup} from '../public/store.js';
import {chat} from '../worker/api.js';

test('rejects invalid Office signatures, paths, and declared decompression sizes',async()=>{
 await assert.rejects(readZip(new Blob(['plain text'])),/не является/);
 await assert.rejects(readZip(projectZip([{name:'../note.xml',content:'<note/>'}])),/путь/);
 const zip=projectZip([{name:'safe.xml',content:'<note/>'}]);
 const bytes=await zip.arrayBuffer();
 const data=new DataView(bytes);
 const central=data.getUint32(bytes.byteLength-6,true);
 data.setUint32(central+24,50*1024*1024,true);
 await assert.rejects(readZip(new Blob([bytes])),/слишком большой/);
 const part=await readZip(createDocument('Документ','Текст'));
 assert.equal(typeof part,'function');
});

test('rejects XML declarations before creating a DOM parser',async()=>{
 const part=await readZip(projectZip([{name:'note.xml',content:'<!DOCTYPE note><note/>'}]));
 await assert.rejects(part('note.xml'),/недопустимое объявление/);
});

test('attachment type mismatch is rejected before provider access',async()=>{
 const request=new Request('https://focus.example/api/chat',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({messages:[{role:'user',content:'Read this',attachments:[{mimeType:'application/pdf',data:btoa('plain text')}]}]})});
 const response=await chat(request,{GOOGLE_API_KEY:'fixture'},()=>assert.fail('Provider must not be called'));
 assert.equal(response.status,400);
 assert.equal((await response.json()).code,'attachment_type_mismatch');
});

test('validates backup fields, file parent cycles and blob ownership',()=>{
 const state=fresh();
 const folder={id:'docs',kind:'folder',name:'Docs',project:'personal'};
 const file={id:'note',kind:'file',name:'note.txt',project:'personal',parent:'docs'};
 assert.ok(validBackup({...state,files:[folder,file],blobs:{note:'data:text/plain;base64,YQ=='}}));
 assert.equal(validBackup({...state,settings:{...state.settings,sendOnEnter:[]}}),false);
 assert.equal(validBackup({...state,files:[{...folder,parent:'docs'}]}),false);
 assert.equal(validBackup({...state,files:[folder],blobs:{docs:'data:text/plain;base64,YQ=='}}),false);
 assert.equal(validBackup({...state,files:[folder,file],blobs:{note:'data:text/plain;base64,==='}}),false);
});
