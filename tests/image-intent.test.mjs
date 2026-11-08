import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageAspectRatio,imageIntent,latestImage} from '../public/image-intent.js';
test('natural image creation and command compatibility',()=>{
 for(const text of ['Нарисуй кота','Можешь создать изображение города','Сделай обложку для видео','draw a cat','/image a dog'])assert.equal(imageIntent(text,true)?.mode,'create',text);
});
test('follow-up edits need an image and do not steal text questions',()=>{
 for(const text of ['Теперь добавь закат','Пусть кот будет черным','Убери фон','Сделай изображение ярче','change the sky'])assert.equal(imageIntent(text,true)?.mode,'edit',text);
 for(const text of ['Как нарисовать кота?','Напиши промпт для картинки','Не рисуй кота','Измени ответ','Сделай код лучше','Почему небо синее?'])assert.equal(imageIntent(text,true),null,text);
 assert.equal(imageIntent('Добавь закат'),null);
});
test('reference follows the latest successful image inside this conversation only',()=>{
 const first={role:'assistant',imageFile:'one'},second={role:'assistant',imageFile:'two'};
 const messages=[{role:'user'},first,{role:'user'},second,{role:'user'}];
 assert.equal(latestImage(messages),second);
 assert.equal(latestImage(messages.slice(0,3)),first);
 assert.equal(latestImage([{role:'user'}]),null);
});

test('natural image formats map to provider aspect ratios',()=>{
 for(const [text,ratio] of [
  ['Нарисуй обои на телефон с космосом','9:16'],
  ['Создай горизонтальную обложку для YouTube','16:9'],
  ['Сделай аватарку робота','1:1'],
  ['Нарисуй кота',null],
 ])assert.equal(imageAspectRatio(text).ratio,ratio,text);
 assert.deepEqual(imageAspectRatio('кот --ar 9:16'),{ratio:'9:16',prompt:'кот'});
 assert.equal(imageAspectRatio('кот --ar 4:3').ratio,'4:3');
});

