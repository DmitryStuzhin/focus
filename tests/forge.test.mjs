import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forgeIntent,forgeReport,namedCodeFiles} from '../public/forge.js';

test('Forge starts for build and coding work without a slash command',()=>{
 assert.equal(forgeIntent('Сделай залипательную игру на телефон',{previewKind:'game'}).kind,'game');
 assert.equal(forgeIntent('Почини этот код',{taskMode:'code'}).kind,'code');
 assert.equal(forgeIntent('/code Focus Forge — собери готовый проект',{taskMode:'code'}).kind,'project');
 assert.equal(forgeIntent('Собери готовый проект бота для Telegram').kind,'project');
 assert.equal(forgeIntent('Расскажи про архитектуру нейросетей'),null);
});

test('Forge extracts only safe, explicitly named project files',()=>{
 const files=namedCodeFiles('```javascript src/app.js\nconsole.log(1)\n```\n```text ../secret\nno\n```');
 assert.deepEqual(files.map(file=>file.name),['src/app.js']);
});

test('Forge evidence distinguishes a ready preview from an incomplete answer',()=>{
 const html='```html index.html\n<!doctype html><html><body><button id="go">Старт</button><script>go.addEventListener("click",()=>{})</script></body></html>\n```';
 const ready=forgeReport(html,{kind:'app',previewReady:true,checkpoint:{id:'checkpoint',count:1}});
 assert.equal(ready.status,'ready');
 assert.ok(ready.checks.every(item=>item.status!=='fail'));
 assert.equal(ready.files[0],'index.html');
 const broken=forgeReport('Продолжение следует',{kind:'site',truncated:true,previewReady:false});
 assert.equal(broken.status,'needs_work');
 assert.ok(broken.checks.some(item=>item.status==='fail'));
});
