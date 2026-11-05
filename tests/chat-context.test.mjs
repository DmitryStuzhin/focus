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
