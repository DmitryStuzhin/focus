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

const smtpUrls = {
 465: 'smtps://smtp.timeweb.ru:465',
 587: 'smtp://smtp.timeweb.ru:587',
};

function runCurl(args,credentials) {
 return new Promise(resolve=>{
  const child = execFile('/usr/bin/curl',args,{env:{PATH:'/usr/bin:/bin'},timeout:15_000},(error,stdout)=>{
   const metrics = /^(\d+(?:\.\d+)?) (\d+) (\d{3})$/u.exec(stdout.trim());
   resolve({
    exitCode:error?(Number.isInteger(error.code)?error.code:-1):0,
    connectTime:metrics?Number(metrics[1]):null,
    uploaded:metrics?Number(metrics[2]):null,
    reply:metrics?Number(metrics[3]):0,
   });
  });
  child.stdin.on('error',()=>{});
  child.stdin.end('user = "'+credentials+'"\n');
 });
}

function diagnose({exitCode,connectTime,uploaded,reply},port) {
 // A timeout after handing the message to the relay is ambiguous.
 const canRetry = exitCode===7||(exitCode===28&&uploaded===0)||exitCode===35;
 let detail;
 if(exitCode===67||reply===535||reply===534)detail='Timeweb rejected SMTP login. Check the mailbox and its password.';
 else if(exitCode===6)detail='The VPS could not resolve smtp.timeweb.ru.';
 else if(exitCode===7||exitCode===28&&connectTime===0)detail='The VPS could not open the SMTP connection.';
 else if(exitCode===35||exitCode===60||exitCode===64)detail='The SMTP TLS negotiation or certificate check failed.';
 else if(exitCode===28)detail='The SMTP exchange timed out after connecting. Check whether the message arrived before retrying.';
 else if(exitCode===-1)detail='The SMTP client could not complete its request.';
 else detail='Timeweb did not confirm the SMTP send.';
 const diagnostic='Port '+port+': '+detail+' (curl '+exitCode+(reply?', SMTP '+reply:'')+').';
 return {diagnostic,canRetry};
}

export async function sendLoginCode({from,to,code,password,port},{transport=runCurl}={}) {
 if(typeof password!=='string'||!password||/[\r\n\0]/u.test(password))throw new Error('Invalid SMTP configuration.');
 if(port!=null&&port!==''&&![465,587].includes(Number(port)))throw new Error('Invalid SMTP port. Use 465 or 587.');
 const preferred = port?Number(port):465;
 const ports = [preferred,preferred===465?587:465];
 const credentials = (from+':'+password).replace(/["\\]/gu,'\\$&');
 const folder = await mkdtemp(join(tmpdir(),'focus-mail-'));
 try{
  const file = join(folder,'mail.eml');
  await writeFile(file,message({from,to,code}),{mode:0o600});
  const errors = [];
  for(const port of ports){
   const args = ['--disable','--config','-','--url',smtpUrls[port],'--ssl-reqd',
    '--silent','--show-error','--connect-timeout','5','--max-time','12',
    '--write-out','%{time_connect} %{size_upload} %{response_code}',
    '--mail-from',from,'--mail-rcpt',to,'--upload-file',file];
   const result = await transport(args,credentials);
   if(result.exitCode===0)return port;
   const {diagnostic,canRetry} = diagnose(result,port);
   errors.push(diagnostic);
   if(!canRetry)break;
  }
  throw new Error(errors.join('\n'));
 }finally{await rm(folder,{recursive:true,force:true});}
}
