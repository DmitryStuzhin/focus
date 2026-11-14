import {DatabaseSync,backup} from 'node:sqlite';
import {lstat,link,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function backupAccounts(source,destination){
 source=resolve(source);
 destination=resolve(destination);
 if(!(await lstat(source)).isFile())throw new Error('The source database must be a regular file.');
 const stage=await mkdtemp(join(dirname(destination),'.focus-backup-'));
 const snapshot=join(stage,'snapshot.sqlite');
 const db=new DatabaseSync(source,{readOnly:true});
 try{
  await backup(db,snapshot,{rate:100});
  const copy=new DatabaseSync(snapshot);
  try{
   if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite backup integrity check failed.');
   if(copy.prepare('PRAGMA foreign_key_check').get())throw new Error('SQLite backup contains invalid references.');
   copy.exec('PRAGMA journal_mode=DELETE');
  }finally{copy.close();}
  await link(snapshot,destination);
 }finally{
  db.close();
  await rm(stage,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.umask(0o077);
 if(process.argv.length!==4)throw new Error('Usage: node scripts/backup.mjs SOURCE DESTINATION');
 await backupAccounts(process.argv[2],process.argv[3]);
}
