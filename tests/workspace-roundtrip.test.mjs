import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fresh,validBackup} from '../public/store.js';
import {decodeWorkspace,snapshotWorkspace} from '../public/workspace-features.js';
import {compareTables,csvTable} from '../public/tabular.js';
import {compareText} from '../public/text-diff.js';
import {openTable} from '../public/office.js';

test('workspace snapshots export and restore both metadata and binary file bytes',async t=>{
 const previous=globalThis.FileReader;
 globalThis.FileReader=class {
  async readAsDataURL(blob){
   this.result='data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
   this.onload();
  }
 };
 t.after(()=>{if(previous)globalThis.FileReader=previous;else delete globalThis.FileReader;});
 const state=fresh();
 state.files.push({id:'fixture',kind:'file',name:'fixture.bin',project:'personal'});
 const original=new Blob([new Uint8Array([0,128,255])],{type:'application/octet-stream'});
 const copy=await snapshotWorkspace(state,async()=>original);
 assert.ok(validBackup(copy));
 const decoded=decodeWorkspace(JSON.parse(JSON.stringify(copy)));
 assert.deepEqual(decoded.state,state);
 assert.deepEqual(new Uint8Array(await decoded.blobs[0][1].arrayBuffer()),new Uint8Array([0,128,255]));
 await assert.rejects(snapshotWorkspace(state,async()=>original,1),/превышает/u);
});

test('CSV import retains identifiers and reports modified table rows',async()=>{
 const before=new File(['id;price\n001;10\n002;20'],'before.csv');
 const after=csvTable('id;price\n002;20\n001;11','',true);
 const rows=await openTable(before);
 assert.equal(rows[1][0],'001');
 const report=compareTables(rows,after,'id');
 assert.equal(report.modified,1);
 assert.equal(report.matched,1);
});

test('a one-line edit produces one addition and one removal',()=>{
 const change=compareText('header\nold\nfooter','header\nnew\nfooter',20);
 assert.deepEqual([change.added,change.removed],[1,1]);
 assert.ok(change.changes.some(item=>item.text==='new'&&item.type==='added'));
});
