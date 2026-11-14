import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDIO_LABELS,renderFocusCode,renderFocusForge} from '../public/studios.js';

const e=value=>String(value).replace(/[&<>"']/g,'');

test('Focus Code and Focus Forge are visible standalone studio tabs',()=>{
 assert.equal(STUDIO_LABELS.code,'Focus Code');
 assert.equal(STUDIO_LABELS.forge,'Focus Forge');
 const code=renderFocusCode({e,brief:'бот',project:'Работа',runs:[{id:'chat-1',title:'Telegram-бот',project:'Работа',updated:'сегодня'}]});
 assert.match(code,/id="code-studio-form"/);
 assert.match(code,/Запустить Focus Code/);
 assert.match(code,/data-action="studio-open-chat"/);
 const forge=renderFocusForge({e,brief:'игра',project:'Работа',checkpoints:[{id:'version-1',name:'Версия 1',files:4,updated:'сегодня'}]});
 assert.match(forge,/id="forge-studio-form"/);
 assert.match(forge,/Контрольные точки/);
 assert.match(forge,/data-action="open-forge-checkpoint"/);
});

test('Code and Forge live only in the top product switcher',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const workspaceTools=source.slice(source.indexOf('function workspaceTools'),source.indexOf('function workspaceView'));
 assert.doesNotMatch(workspaceTools,/Focus Code|Focus Forge/);
 assert.match(source,/case 'product-menu':menu/);
 assert.match(source,/text:'Focus Code'/);
 assert.match(source,/text:'Focus Forge'/);
 assert.match(source,/product-menu-popup/);
 assert.doesNotMatch(source,/focus-code-shortcut|>Написать код<|>Продумать план</);
});
