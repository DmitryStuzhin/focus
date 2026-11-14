import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {inlineMarkdown} from '../public/answer-format.js';

test('Markdown renders HTML and unsafe link syntax as text',()=>{
 const html=inlineMarkdown('<script>demo</script> <img onerror="demo"> [example](javascript:demo) [safe](https://example.org)');
 assert.match(html,/&lt;script&gt;/u);
 assert.match(html,/&lt;img onerror=&quot;demo&quot;&gt;/u);
 assert.doesNotMatch(html,/<(?:script|img)|href="javascript:/iu);
 assert.match(html,/href="https:\/\/example\.org"/u);
});

test('the preview iframe lacks same-origin permission',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/<iframe title="Предпросмотр" sandbox="allow-scripts" referrerpolicy="no-referrer"/u);
});
