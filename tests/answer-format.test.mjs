import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerChart,answerTable,inlineMarkdown} from '../public/answer-format.js';

test('renders common Markdown tables, including pipes inside a value',()=>{
 const input=['Тема | Баллы','--- | ---:','a\\|b | 10','`a|b` | 20','После таблицы'];
 const {html,end}=answerTable(input,0);
 assert.equal(end,4);
 assert.match(html,/<td class="cell-left">a\|b<\/td>/);
 assert.match(html,/<code>a\|b<\/code>/);
 assert.match(html,/<td class="cell-right">20<\/td>/);
 assert.equal(answerTable(['x | y','a | b'],0),null);
});

test('chart markup escapes text and rejects nonfinite or mismatched data',()=>{
 const spec={type:'bar',title:'<script>alert(1)</script>',unit:'₽',labels:['" январь','февраль'],values:[-100,50]};
 const html=answerChart(JSON.stringify(spec));
 assert.match(html,/<svg /);
 assert.equal((html.match(/<rect /g)||[]).length,2);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script/);
 assert.equal(answerChart(JSON.stringify({...spec,values:[100]})),null);
 assert.equal(answerChart(JSON.stringify({...spec,values:[100,50]}).replace('100','1e999')),null);
 assert.doesNotMatch(inlineMarkdown('[link](https://example.com/"onclick="alert(1))'),/ onclick=/u);
});
