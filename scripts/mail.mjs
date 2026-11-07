import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function message({from,to,code}) {
 const subject = Buffer.from('Код входа в Focus').toString('base64');
 const text = [
  'Твой код входа в Focus: '+code,
  '',
  'Код действует 10 минут и используется один раз.',
  'Если ты не запрашивал код, просто проигнорируй это письмо.',
 ].join('\r\n');
 const body = Buffer.from(text).toString('base64').match(/.{1,76}/gu).join('\r\n');
 return [
  'From: Focus <'+from+'>', 'To: <'+to+'>', 'Subject: =?UTF-8?B?'+subject+'?=',
  'Date: '+new Date().toUTCString(), 'Message-ID: <'+randomUUID()+'@'+from.split('@')[1]+'>',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: base64', '', body, '',
 ].join('\r\n');
}

export async function sendLoginCode({from,to,code,password}) {
 if(typeof password!=='string'||!password||/[\r\n\0]/u.test(password))throw new Error('Invalid SMTP configuration.');
 const folder = await mkdtemp(join(tmpdir(),'focus-mail-'));
 try{
  const file = join(folder,'mail.eml');
  await writeFile(file,message({from,to,code}),{mode:0o600});
  await new Promise((resolve,reject)=>{
   const args = ['--disable','--config','-','--url','smtps://smtp.timeweb.ru:465','--ssl-reqd',
    '--silent','--show-error','--connect-timeout','5','--max-time','12',
    '--mail-from',from,'--mail-rcpt',to,'--upload-file',file];
   const child = execFile('/usr/bin/curl',args,{env:{PATH:'/usr/bin:/bin'},timeout:15_000},err=>{
    if(err)reject(new Error('SMTP delivery failed.'));
    else resolve();
   });
   const credentials = (from+':'+password).replace(/["\\]/gu,'\\$&');
   child.stdin.on('error',()=>{});
   child.stdin.end('user = "'+credentials+'"\n');
  });
 }finally{await rm(folder,{recursive:true,force:true});}
}
