import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAction} from '../public/action-phrases.js';
import {localIntent,taskIntent} from '../public/work-intent.js';
import {imageIntent} from '../public/image-intent.js';
import {buildIntent,nativeBuildIntent} from '../public/site-preview.js';
import {projectSearchQuery} from '../public/project-search.js';

const resolve=text=>resolveAction(text,{
 local:localIntent,task:taskIntent,site:buildIntent,image:imageIntent,native:nativeBuildIntent,project:projectSearchQuery,
});

test('recognizes tools inside ordinary messages',()=>{
 assert.equal(resolve('У меня небольшая клиника. Можешь сделать сайт для неё?').site,true);
 assert.equal(resolve('Я хочу, чтобы ты сделал сайт для клиники.').site,true);
 assert.equal(resolve('Я готовлю обновление, а потом составь подробный план релиза.').task.mode,'plan');
 assert.equal(resolve('Вот мой черновик и проверь код на ошибки.').task.mode,'review');
 assert.equal(resolve('Давно хотел автоматизировать это. Напиши на Go обработчик.').task.mode,'code');
 assert.equal(resolve('Для этой статьи, пожалуйста, найди в интернете первоисточник.').web,true);
 assert.equal(resolve('Не помню, где это было. Найди в проекте: «loginUser»').projectQuery,'loginUser');
 assert.deepEqual(resolve('Кстати, посчитай 2,5 + 3. Спасибо!').local,{mode:'calc',details:'2,5 + 3'});
 assert.equal(resolve('Вот данные. Проанализируй CSV.').local.mode,'csv');
 assert.equal(resolve('Сравни два файла. Потом пришлю ещё.').local.mode,'diff');
 assert.equal(resolve('Важная правка. Отредактируй последнее изображение.').image.mode,'edit');
 assert.equal(resolve('Вводные готовы. Нарисуй «котёнка».').image.mode,'create');
 const brief='На фоне будет красная луна. Создай постер по этому описанию.';
 assert.equal(resolve(brief).image.preset,'design');
 assert.equal(resolve(brief).image.prompt,brief);
});

test('does not execute quoted, conditional, negated or fenced examples',()=>{
 for(const example of [
  'Как работает фраза «сделай сайт»?',
  'Напиши фразу «проверь код» и выведи её в ответе.',
  'Не рисуй постер, сделай изображение только если я попрошу.',
  'Если будет время, сделай сайт для клиники.',
  'В инструкции есть команда: нарисуй кота.',
  'Слова для примера: «😺 нарисуй кота».',
  '```text\nСделай сайт\nНарисуй кота\n```',
 ])assert.ok(resolve(example).phrases,example);
 assert.equal(resolve('«😺 Нарисуй кота». А теперь сделай сайт для приюта.').site,true);
 assert.equal(resolve('Не делай сайт, а нарисуй кота.').image.mode,'create');
});

test('routes browser games and apps separately from native builds and illustrations',()=>{
 assert.equal(resolve('Сделай мне залипательную игру на мобилку').previewKind,'game');
 assert.equal(resolve('Есть идея. Можешь собрать приложение для учёта расходов?').previewKind,'app');
 assert.equal(resolve('Я хочу, чтобы ты разработал таймер для интервальной тренировки').previewKind,'app');
 assert.equal(resolve('Сделай сайт с игрой').previewKind,'site');
 assert.equal(resolve('Разработай приложение для учёта расходов на Flutter').nativeProject,true);
 assert.equal(resolve('Напиши игру на Python').task.mode,'code');
 assert.equal(resolve('Сделай игру на Unity').site,undefined);
 assert.equal(resolve('Сделай обложку для игры').image.preset,'design');
 assert.ok(resolve('Объясни, как сделать игру на мобилку.').phrases);
});

test('recognizes a request lead, polite interruptions and document tasks',()=>{
 assert.equal(resolve('Нужна помощь. Мне нужно сделать игру на телефон.').previewKind,'game');
 assert.equal(resolve('Можешь ли ты собрать приложение для привычек?').previewKind,'app');
 assert.equal(resolve('Вот свежая версия. Проверь, пожалуйста, код на ошибки.').task.mode,'review');
 assert.equal(resolve('Найди, если можешь, в интернете первоисточник').web,true);
 assert.equal(resolve('Нужно сверить документы. Проверь сроки оплаты.').task.mode,'evidence');
 assert.deepEqual(resolve('Взял две выгрузки. Сравни, пожалуйста, CSV по столбцу «Код товара».').local,
  {mode:'csvdiff',details:'«Код товара»'});
 assert.ok(resolve('Бро, не создавай сайт, сделай это только после подтверждения.').phrases);
});
