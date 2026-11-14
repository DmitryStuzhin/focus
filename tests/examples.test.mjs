import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exampleResult} from '../public/examples.js';

test('all three onboarding examples produce concrete results without a provider',()=>{
 assert.match(exampleResult('tables').output,/101, сумма: 1200 → 1500/u);
 assert.match(exampleResult('document').output,/10 рабочих дней/u);
 assert.equal(exampleResult('document').download,true);
 assert.match(exampleResult('calculate').output,/171,6/u);
});
