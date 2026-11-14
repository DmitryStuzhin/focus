import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exampleResult,exampleProject} from '../public/examples.js';

test('all three onboarding examples produce concrete results without a provider',()=>{
 assert.match(exampleResult('tables').output,/101, сумма: 1200 → 1500/u);
 assert.match(exampleResult('document').output,/10 рабочих дней/u);
 assert.equal(exampleResult('document').download,true);
 assert.match(exampleResult('calculate').output,/171,6/u);
});

test('public examples have copyable projects with known local fixtures',()=>{
 for(const kind of ['tables','document','calculate']){
  const example=exampleProject(kind);
  assert.ok(example.name);
  assert.ok(example.files.some(file=>file.name==='Задание.md'));
 }
 assert.equal(exampleProject('other'),null);
 assert.match(exampleProject('tables').files[0].text,/101;1200/u);
});
