import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildChatContext,rankProjectFiles,searchQuery} from '../public/chat-context.js';

const user = content => ({role:'user',content});
const assistant = content => ({role:'assistant',content});

test('search uses the current topic and carries context into short follow-ups',()=>{
 const dialog=[user('Какие тарифы на электричество во Франции?'),assistant('Ответ')];
 assert.equal(searchQuery([...dialog,user('Кто написал «Войну и мир»?')]),'Кто написал «Войну и мир»?');
 assert.equal(searchQuery([...dialog,user('А в Германии?')]),'А в Германии? Какие тарифы на электричество во Франции?');
 assert.equal(searchQuery([user('Проверь новости')]),'Проверь новости');
 assert.equal(searchQuery([user('x'.repeat(800))]).length,600);
});

test('project context ranks a named document above more recent unrelated files',()=>{
 const files=[{name:'Заметки.txt',updated:3},{name:'Бюджет_2026.csv',updated:1},{name:'Смета.md',updated:2}];
 assert.deepEqual(rankProjectFiles(files,'Проверь бюджет 2026').map(file=>file.name),
  ['Бюджет_2026.csv','Заметки.txt','Смета.md']);
});

test('large files share the text budget and the current request stays intact',async()=>{
 const read=async ids=>ids.map(name=>({name,text:'я'.repeat(130_000)}));
 const latest={...user('Сравни эти файлы'),files:['first','second']};
 const result=await buildChatContext([user('старый текст'),assistant('старый ответ'),latest],[],read);
 const current=result.at(-1);
 assert.equal(current.content,latest.content);
 assert.deepEqual(current.attachments.map(file=>file.name),latest.files);
 for(const file of current.attachments)assert.match(file.text,/Текст файла сокращён/);
 assert.ok(current.content.length+current.attachments.reduce((sum,file)=>sum+file.text.length,0)<=145_000);
 assert.notEqual(result[0].role,'assistant');
});

test('keeps recent turns and sends a project file only once across the context',async()=>{
 const file={id:'a',name:'Бюджет.csv'};
 const read=async ids=>ids.map(name=>({name,text:'Budget,1000'}));
 const messages=[user('x'.repeat(145_000)),assistant('Старый ответ'),
  {...user('Вот бюджет'),files:['a']},assistant('Получил'),user('Проверь бюджет ещё раз')];
 const result=await buildChatContext(messages,[file],read);
 assert.deepEqual(result.map(message=>message.content),['Вот бюджет','Получил','Проверь бюджет ещё раз']);
 assert.deepEqual(result.flatMap(message=>message.attachments).map(item=>item.name),['a']);
});

test('older binary attachments cannot exhaust the current request budget',async()=>{
 const read=async ids=>ids.map(name=>({name,mimeType:'image/png',data:'A'.repeat(7_000_000)}));
 const result=await buildChatContext([
  {...user('Old image'),files:['old']},assistant('Old reply'),{...user('New image'),files:['new']},
 ],[],read);
 assert.deepEqual(result.flatMap(message=>message.attachments).map(item=>item.name),['new']);
 assert.equal(result.length,3);
 assert.ok(new TextEncoder().encode(JSON.stringify({messages:result})).byteLength<12_000_000);
});

test('automatic excerpts retain relevant material near the end of a large project file',async()=>{
 const file={id:'policy',name:'Правила.txt'};
 const body='Общие положения. '.repeat(1500)+'\nПравило для командировки: лимит 20 000 рублей.\n'+'Приложение. '.repeat(600);
 const result=await buildChatContext([user('Какой лимит для командировки?')],[file],async ids=>ids.map(()=>({name:file.name,text:body})));
 const excerpt=result.at(-1).attachments[0].text;
 assert.ok(excerpt.length<=12_000);
 assert.match(excerpt,/лимит 20 000 рублей/);
 assert.match(excerpt,/Текст файла сокращён/);
});

test('a symbol in an older file outranks unrelated recent source files',async()=>{
 const files=Array.from({length:8},(_,i)=>({id:String(i),name:'module-'+i+'.js',updated:8-i}));
 const result=await buildChatContext([user('Проверь функцию resolveInvoice')],files,async ids=>ids.map(id=>({
  id,name:files[Number(id)].name,text:id==='7'?'export function resolveInvoice() {}':'export const enabled = true;',
 })));
 assert.equal(result.at(-1).attachments[0].id,'7');
 assert.ok(result.at(-1).attachments.length<=5);
});

test('ordinary questions never auto-attach zero-score project files',async()=>{
 const file={id:'notes',name:'notes.txt'};
 const result=await buildChatContext([user('Объясни фотосинтез')],[file],async ids=>ids.map(()=>({name:file.name,text:'Private project notes'})));
 assert.deepEqual(result.at(-1).attachments,[]);
});


test('large current attachments retain recent user constraints and answers',async()=>{
 const messages=[
  {role:'user',content:'Используй Python 3.12. Сохрани поддержку пустого ввода.'},
  {role:'assistant',content:'Предыдущая версия и объяснение.'},
  {role:'user',content:'Исправь ошибку в этом файле',files:['large']},
 ];
 const context=await buildChatContext(messages,[],async ids=>ids.map(id=>({id,name:'main.py',text:'x'.repeat(200000)})));
 assert.deepEqual(context.map(message=>message.content),messages.map(message=>message.content));
 assert.equal(context.at(-1).attachments[0].truncated,true);
 assert.ok(JSON.stringify(context).length<150000);
});

test('a short correction retrieves the file from the preceding topic',async()=>{
 const files=Array.from({length:8},(_,index)=>({id:String(index),name:'source'+index+'.txt',updated:index}));
 const context=await buildChatContext([
  {role:'user',content:'Найди проблему с billingRenewal в проекте'},
  {role:'assistant',content:'Ошибка возникает в обработчике подписки.'},
  {role:'user',content:'Исправь это'},
 ],files,async ids=>ids.map(id=>({id,name:'source'+id+'.txt',text:id==='0'?'billingRenewal fails here':'Other unrelated text'})));
 assert.equal(context.at(-1).attachments[0].id,'0');
 assert.equal(context.at(-1).content,'Исправь это');
});

test('BM25 retrieves a relevant file from 50 candidates and carries older dialogue context',async()=>{
 const files=Array.from({length:50},(_,i)=>({id:'file-'+i,name:'notes-'+i+'.txt',updated:i}));
 const history=Array.from({length:60},(_,i)=>user('История '+i));
 const context=await buildChatContext([...history,user('Найди ограничение heartbeatTimeout')],files,async ids=>ids.map(id=>({
  id,name:id+'.txt',text:id==='file-0'?'heartbeatTimeout timeout configured for workers':'General background information',
 })));
 assert.equal(context.at(-1).attachments[0].id,'file-0');
 assert.match(context.at(-1).historySummary,/История 0/u);
 assert.match(context.at(-1).historySummary,/История 20/u);
 assert.ok(context.length<=40);
});
