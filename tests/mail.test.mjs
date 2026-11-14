import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MailDeliveryError,sendLoginCode,sendLoginCodeViaPostbox} from '../scripts/mail.mjs';

const mail={from:'auth@example.com',to:'user@example.net',code:'000001',password:'fixture-password'};
const postboxMail={...mail,keyId:'fixture-id',keySecret:'fixture-secret'};

test('Postbox signs the HTTPS request without putting credentials or the code in process arguments',async()=>{
 await sendLoginCodeViaPostbox(postboxMail,{transport:async(args,config)=>{
  assert.equal(args[args.indexOf('--url')+1],'https://postbox.cloud.yandex.net/v2/email/outbound-emails');
  assert.equal(args[args.indexOf('--aws-sigv4')+1],'aws:amz:ru-central1:ses');
  assert.ok(args.every(arg=>!arg.includes(postboxMail.keySecret)&&!arg.includes(mail.code)));
  const [user,body]=config.trimEnd().split('\n');
  assert.equal(user,'user = "fixture-id:fixture-secret"');
  const payload=JSON.parse(JSON.parse(body.slice('data-binary = '.length)));
  assert.equal(payload.FromEmailAddress,'Focus <auth@example.com>');
  assert.deepEqual(payload.Destination.ToAddresses,[mail.to]);
  assert.match(payload.Content.Simple.Body.Text.Data,/000001/u);
  assert.match(payload.Content.Simple.Body.Html.Data,/>000001<\/div>/u);
  return {exitCode:0,stdout:'{"MessageId":"accepted-id"}\n200'};
 }});
});

test('Postbox errors report only safe diagnostics and preserve ambiguous delivery state',async()=>{
 for(const [result,uncertain] of [
  [{exitCode:0,stdout:'{"message":"fixture-secret"}\n403'},false],
  [{exitCode:28,stdout:'\n000'},true],
  [{exitCode:0,stdout:'{}\n200'},true],
 ]){
  await assert.rejects(sendLoginCodeViaPostbox(postboxMail,{transport:async()=>result}),error=>{
   assert.ok(error instanceof MailDeliveryError);
   assert.equal(error.deliveryUncertain,uncertain);
   assert.ok(!error.message.includes(postboxMail.keySecret));
   return true;
  });
 }
});

test('login email carries the same copyable six-digit code in plain text and HTML',async()=>{
 await sendLoginCode(mail,{transport:async args=>{
  const source=await readFile(args[args.indexOf('--upload-file')+1],'utf8');
  const boundary=/Content-Type: multipart\/alternative; boundary="([^"]+)"\r\n/u.exec(source)?.[1];
  assert.ok(boundary);
  const [,plain,html,end]=source.split('--'+boundary);
  assert.equal(end,'--\r\n');
  const decode=(part,type)=>{
   const [headers,body]=part.split('\r\n\r\n');
   assert.equal(headers,`\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64`);
   assert.ok(body.trim().split('\r\n').every(line=>line.length<=76));
   return Buffer.from(body,'base64').toString('utf8');
  };
  const text=decode(plain,'text/plain');
  const markup=decode(html,'text/html');
  assert.match(text,/Твой код входа в Focus: 000001/u);
  assert.match(markup,/>000001<\/div>/u);
  for(const version of [text,markup])assert.match(version,/Код действует 10 минут и используется один раз/u);
  return {exitCode:0,reply:250};
 }});
});

test('unexpected login code markup is rejected before transport',async()=>{
 await assert.rejects(sendLoginCode({...mail,code:'<img>'},{transport:()=>assert.fail('must not send')}),/Invalid Focus login code/u);
});

test('an unreachable SMTP port falls back to STARTTLS and returns the working port',async()=>{
 const urls=[];
 const port=await sendLoginCode(mail,{transport:async(args,credentials)=>{
  const url=args[args.indexOf('--url')+1];
  urls.push(url);
  assert.ok(args.includes('--ssl-reqd'));
  assert.ok(args.every(arg=>!arg.includes(mail.password)));
  assert.equal(credentials,mail.from+':'+mail.password);
  const message=await readFile(args[args.indexOf('--upload-file')+1],'utf8');
  assert.match(message,/^From: Focus <auth@example\.com>\r\nTo: <user@example\.net>\r\n/u);
  return urls.length===1?{exitCode:28,connectTime:0,uploaded:0,reply:0}:{exitCode:0,connectTime:.2,reply:250};
 }});
 assert.deepEqual(urls,['smtps://smtp.timeweb.ru:465','smtp://smtp.timeweb.ru:587']);
 assert.equal(port,587);
});

test('credentials rejected or a message already uploaded never cause a second send',async()=>{
 for(const [result,error] of [
  [{exitCode:67,connectTime:.2,uploaded:0,reply:535},/Port 587: Timeweb rejected SMTP login/],
  [{exitCode:28,connectTime:.2,uploaded:800,reply:354},/Check whether the message arrived/],
 ]){
  let calls=0;
  await assert.rejects(sendLoginCode({...mail,port:'587'},{transport:async args=>{
   calls++;
   assert.ok(args.includes('smtp://smtp.timeweb.ru:587'));
   return result;
  }}),error);
  assert.equal(calls,1);
 }
});
