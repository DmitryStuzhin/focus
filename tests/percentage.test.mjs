import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat} from '../worker/api.js';
import {localIntent} from '../public/work-intent.js';

test('natural percentages use exact arithmetic and require no provider',async()=>{
 const examples=[
  ['Посчитай 15% от 800','120'],
  ['Сколько будет 12,5 процентов от 240?','30'],
  ['Увеличь 1250 на 8%','1350'],
  ['Уменьши 100 на 12,5 процента','87,5'],
  ['Рассчитай цену 999,99 со скидкой 10%','899,991'],
 ];
 for(const [content,result] of examples){
  const request=new Request('https://focus.example/api/chat',{method:'POST',headers:{
   'content-type':'application/json','cf-connecting-ip':crypto.randomUUID(),
  },body:JSON.stringify({messages:[{role:'user',content}]})});
  const response=await chat(request,{},()=>assert.fail('arithmetic must not call a model'));
  assert.equal(response.status,200,content);
  const data=await response.json();
  assert.equal(data.model,'local-calculator');
  assert.equal(data.text,'**Результат** '+result,content);
 }
});
test('percentage routing leaves advice and incomplete questions to conversation',()=>{
 for(const content of ['Объясни, как посчитать 15% от 800','Посчитай 15% от','Увеличь продажи на 10%','Не уменьшай 100 на 10%']){
  assert.equal(localIntent(content),null,content);
 }
});
