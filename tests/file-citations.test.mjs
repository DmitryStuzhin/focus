import {test} from 'node:test';
import assert from 'node:assert/strict';
import {citationFiles,fileCitations} from '../public/file-citations.js';

test('file quote controls require an included file and a valid line range',()=>{
 const sources=citationFiles([{id:'contract',name:'Условия',text:'A\nB\nC'},{id:'clipped',name:'Часть',text:'A',truncated:true}]);
 const line='[файл:contract:L2-L3] [файл:clipped:L1] [файл:other:L1] [файл:contract:L4] [файл:contract:L2-L3]';
 assert.deepEqual(fileCitations(line,sources),[{id:'contract',name:'Условия',start:2,end:3}]);
});
