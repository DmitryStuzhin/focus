import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const expiry = 'Код действует 10 минут и используется один раз.';
const unsolicited = 'Если ты не запрашивал код, просто проигнорируй это письмо.';

export class MailDeliveryError extends Error {
 constructor(diagnostics,deliveryUncertain){
  super(diagnostics.join('\n'));
  this.deliveryUncertain=deliveryUncertain;
 }
}
export class SmtpDeliveryError extends MailDeliveryError {}

const subject = 'Код входа в Focus';
const loginEmailText = code => ['Твой код входа в Focus: '+code,'',expiry,unsolicited].join('\r\n');
const curlConfigValue = value => '"'+value.replace(/["\\]/gu,'\\$&')+'"';

function loginEmailHtml(code) {
 return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Код входа в Focus</title></head>
<body style="margin:0;padding:0;background-color:#edf1eb;color:#192b20;font-family:Arial,sans-serif;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Одноразовый код для входа в Focus. Действует 10 минут.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#edf1eb">
 <tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:500px;border:1px solid #d5dfd3;border-radius:20px;">
   <tr><td bgcolor="#182e23" style="padding:24px 24px 22px;border-radius:19px 19px 0 0;background-color:#182e23;background-image:linear-gradient(115deg,#182e23,#31563e);color:#f5faef;">
    <div style="font-size:25px;line-height:30px;font-weight:700;letter-spacing:-1px;">Focus</div>
    <div style="margin-top:5px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.5px;color:#d7edbb;">РАБОЧЕЕ ПРОСТРАНСТВО</div>
   </td></tr>
   <tr><td style="padding:28px 24px 22px;">
    <h1 style="margin:0;font-size:26px;line-height:32px;letter-spacing:-0.6px;color:#192b20;">Подтверди вход</h1>
    <p style="margin:8px 0 22px;font-size:15px;line-height:23px;color:#42584a;">Введи этот код на странице входа в Focus.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#eef6e9" style="border:1px solid #d4e3cd;border-radius:12px;">
     <tr><td align="center" style="padding:18px 10px 17px;">
      <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;color:#425f4b;">КОД ПОДТВЕРЖДЕНИЯ</div>
      <div style="margin-top:5px;padding-left:6px;font-family:Consolas,'Courier New',monospace;font-size:36px;line-height:46px;font-weight:700;letter-spacing:6px;white-space:nowrap;color:#172f21;">${code}</div>
     </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:13px;line-height:20px;color:#42584a;">${expiry}</p>
   </td></tr>
   <tr><td bgcolor="#f7f9f6" style="padding:17px 24px;border-top:1px solid #e2e9df;border-radius:0 0 19px 19px;font-size:13px;line-height:20px;color:#4a5e50;">${unsolicited}</td></tr>
  </table>
 </td></tr>
</table>
</body>
</html>`;
}

function alternative(boundary,type,content) {
 const encoded = Buffer.from(content).toString('base64').match(/.{1,76}/gu).join('\r\n');
 return ['--'+boundary, 'Content-Type: '+type+'; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded];
}

function message({from,to,code}) {
 const encodedSubject = Buffer.from(subject).toString('base64');
 const id = randomUUID();
 const boundary = 'focus-'+id;
 return [
  'From: Focus <'+from+'>', 'To: <'+to+'>', 'Subject: =?UTF-8?B?'+encodedSubject+'?=',
  'Date: '+new Date().toUTCString(), 'Message-ID: <'+id+'@'+from.split('@')[1]+'>',
  'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="'+boundary+'"', '',
  ...alternative(boundary,'text/plain',loginEmailText(code)),
  ...alternative(boundary,'text/html',loginEmailHtml(code).replaceAll('\n','\r\n')),
  '--'+boundary+'--', '',
 ].join('\r\n');
}

const smtpUrls = {
 465: 'smtps://smtp.timeweb.ru:465',
 587: 'smtp://smtp.timeweb.ru:587',
};

function executeCurl(args,config) {
 return new Promise(resolve=>{
  const child = execFile('/usr/bin/curl',args,{env:{PATH:'/usr/bin:/bin'},timeout:15_000},(error,stdout)=>{
   resolve({exitCode:error?(Number.isInteger(error.code)?error.code:-1):0,stdout});
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(config);
 });
}

async function runCurl(args,credentials) {
 const {exitCode,stdout}=await executeCurl(args,'user = "'+credentials+'"\n');
 const metrics = /^(\d+(?:\.\d+)?) (\d+) (\d{3})$/u.exec(stdout.trim());
 return {exitCode,connectTime:metrics?Number(metrics[1]):null,uploaded:metrics?Number(metrics[2]):null,reply:metrics?Number(metrics[3]):0};
}

export async function sendLoginCodeViaPostbox({from,to,code,keyId,keySecret},{transport=executeCurl}={}){
 if(![keyId,keySecret].every(value=>typeof value==='string'&&value&&!/[\r\n\0]/u.test(value))){
  throw new MailDeliveryError(['Invalid Yandex Cloud Postbox credentials.'],false);
 }
 if(typeof code!=='string'||!/^[0-9]{6}$/u.test(code))throw new Error('Invalid Focus login code.');
 const part = Data => ({Data,Charset:'UTF-8'});
 const payload=JSON.stringify({
  FromEmailAddress:'Focus <'+from+'>',
  Destination:{ToAddresses:[to]},
  Content:{Simple:{Subject:part(subject),Body:{Text:part(loginEmailText(code)),Html:part(loginEmailHtml(code))}}},
 });
 const args=['--disable','--config','-','--url','https://postbox.cloud.yandex.net/v2/email/outbound-emails',
  '--aws-sigv4','aws:amz:ru-central1:ses','--header','Content-Type: application/json',
  '--silent','--connect-timeout','5','--max-time','12','--write-out','\n%{http_code}'];
 const config='user = '+curlConfigValue(keyId+':'+keySecret)+'\ndata-binary = '+curlConfigValue(payload)+'\n';
 const {exitCode,stdout}=await transport(args,config);
 const boundary=stdout.lastIndexOf('\n');
 const status=boundary<0?0:Number(stdout.slice(boundary+1))||0;
 if(exitCode===0&&status===200){
  try{
   const result=JSON.parse(stdout.slice(0,boundary));
   if(typeof result.MessageId==='string'&&result.MessageId)return;
  }catch{}
 }
 const uncertain=!(status>=400&&status<500)&&![6,7].includes(exitCode);
 throw new MailDeliveryError(['Postbox did not confirm email submission (HTTP '+status+', curl '+exitCode+').'],uncertain);
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
 if(typeof code!=='string'||!/^[0-9]{6}$/u.test(code))throw new Error('Invalid Focus login code.');
 if(port!=null&&port!==''&&![465,587].includes(Number(port)))throw new Error('Invalid SMTP port. Use 465 or 587.');
 const preferred = port?Number(port):465;
 const ports = [preferred,preferred===465?587:465];
 const credentials = (from+':'+password).replace(/["\\]/gu,'\\$&');
 const folder = await mkdtemp(join(tmpdir(),'focus-mail-'));
 try{
  const file = join(folder,'mail.eml');
  await writeFile(file,message({from,to,code}),{mode:0o600});
  const errors = [];
  let deliveryUncertain=false;
  for(const port of ports){
   const args = ['--disable','--config','-','--url',smtpUrls[port],'--ssl-reqd',
    '--silent','--show-error','--connect-timeout','5','--max-time','12',
    '--write-out','%{time_connect} %{size_upload} %{response_code}',
    '--mail-from',from,'--mail-rcpt',to,'--upload-file',file];
   const result = await transport(args,credentials);
   if(result.exitCode===0)return port;
   const {diagnostic,canRetry} = diagnose(result,port);
   errors.push(diagnostic);
   deliveryUncertain=deliveryUncertain||result.uploaded!==0;
   if(!canRetry)break;
  }
  throw new SmtpDeliveryError(errors,deliveryUncertain);
 }finally{await rm(folder,{recursive:true,force:true});}
}
