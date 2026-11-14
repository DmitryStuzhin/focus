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

import {profileTable,summarizeTable} from '../public/table-profile.js';
test('table profile counts missing values, duplicates and numeric outliers',()=>{
 const result=profileTable([['amount','kind'],['1','a'],['1','a'],['2',''],['2','b'],['100','b']]);
 assert.equal(result.duplicates,1);
 assert.equal(result.columns[0].outliers,1);
 assert.equal(result.columns[1].missing,1);
 assert.equal(result.columns[1].outliers,null);
});

import {cleanTable} from '../public/table-cleaning.js';
test('cleaning leaves source rows intact and keeps invalid dates for manual review',()=>{
 const source=[['date'],['1.2.2026'],['2026-02-01'],['31.02.2026']];
 const result=cleanTable(source,0,'date',{deduplicate:true});
 assert.deepEqual(result.rows,[['date'],['2026-02-01'],['31.02.2026']]);
 assert.equal(result.removed,1);
 assert.equal(source[1][0],'1.2.2026');
 assert.equal(cleanTable([['phone'],['8 (900) 123-45-67']],0,'phone').rows[1][0],'+79001234567');
});

test('grouped summaries count rows and keep decimal totals exact',()=>{
 const rows=[['магазин','сумма'],['А','0,1'],['Б','20'],['А','0.02'],['','-0,3'],['Б',''],['А','-0,12'],['А','9007199254740993']];
 assert.deepEqual(summarizeTable(rows,0,1),[
  {label:'А',count:4,total:'9007199254740993'},
  {label:'Б',count:2,total:'20'},
  {label:'',count:1,total:'−0,3'},
 ]);
 assert.deepEqual(summarizeTable([['тип','значение'],['А','текст']],0),[{label:'А',count:1}]);
 assert.throws(()=>summarizeTable([['тип','значение'],['А','текст']],0,1),/выберите столбец с числами/iu);
});
