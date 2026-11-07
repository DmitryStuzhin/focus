import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sendLoginCode} from '../scripts/mail.mjs';

const mail={from:'auth@example.com',to:'user@example.net',code:'000001',password:'fixture-password'};

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
