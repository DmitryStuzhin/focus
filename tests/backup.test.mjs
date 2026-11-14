import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {backupAccounts} from '../scripts/backup.mjs';

test('SQLite backup restores committed WAL data while the source is open',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'focus-backup-'));
 const source=join(directory,'live.sqlite'),snapshot=join(directory,'snapshot.sqlite');
 const db=new DatabaseSync(source);
 t.after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
 db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('fixture');");
 await backupAccounts(source,snapshot);
 const restored=new DatabaseSync(snapshot,{readOnly:true});
 try{
  assert.equal(restored.prepare('SELECT id FROM users').get().id,'fixture');
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{restored.close();}
 await assert.rejects(backupAccounts(source,snapshot),{code:'EEXIST'});
});
