import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareTables,tableKeys} from '../public/tabular.js';

test('exact composite keys keep repeated individual fields and separators unambiguous',()=>{
 const before=[['account','order','sum'],['a','b;c','1'],['a;b','c','2'],['a','next','3']];
 const after=[before[0],['a','next','3'],['a;b','c','4'],['a','b;c','1']];
 const result=compareTables(before,after,tableKeys('account; order'));
 assert.deepEqual([result.matched,result.modified,result.added,result.removed],[2,1,0,0]);
 assert.throws(()=>compareTables(before,after,['account']),/повторный ключ/u);
 assert.throws(()=>compareTables(before,after,tableKeys('account;')),/ключевых столбцов/u);
});
