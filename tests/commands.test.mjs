import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchingCommands,commandUsed} from '../public/commands.js';

test('slash command suggestions filter by prefix and show recent tools first',()=>{
 assert.equal(matchingCommands('/').length,16);
 assert.deepEqual(matchingCommands('/csv').map(([id])=>id),['csv','csvdiff']);
 assert.equal(matchingCommands('/',commandUsed('/image cats',['calc']))[0][0],'image');
 assert.deepEqual(matchingCommands('/calc 1+1'),[]);
 assert.deepEqual(commandUsed('/unknown'),[]);
});
