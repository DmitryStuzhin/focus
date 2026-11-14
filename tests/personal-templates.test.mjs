import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importTemplates,saveTemplate} from '../public/personal-templates.js';

test('templates validate JSON shape and reject ambiguous names',()=>{
 const item={title:' Сводка ',prompt:' Составьте сводку ',extra:true};
 assert.deepEqual(importTemplates({version:1,templates:[item]}),[{title:'Сводка',prompt:'Составьте сводку'}]);
 assert.throws(()=>importTemplates({version:1,templates:[item,{...item,title:'сводка'}]}),/отличаться/u);
 assert.throws(()=>importTemplates({version:1,templates:[{...item,prompt:'x'.repeat(5001)}]}),/название и текст/u);
 assert.throws(()=>importTemplates({version:2,templates:[item]}),/JSON-файл/u);
});

test('explicit template save updates a matching name',()=>{
 const original=[{title:'Сводка',prompt:'Первый текст'}];
 assert.deepEqual(saveTemplate(original,{title:'сводка',prompt:'Новый текст'}),[{title:'сводка',prompt:'Новый текст'}]);
 assert.equal(original[0].prompt,'Первый текст');
});
