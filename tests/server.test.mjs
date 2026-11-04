import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../scripts/server.mjs';

test('HTTPS proxy requests preserve origin and cannot spoof identity headers',async()=>{
 let seen;
 const app={fetch:async(req)=>{seen=req;return Response.json({ok:true})}};
 const server=createServer({PUBLIC_ORIGIN:'https://tokenapp.ru',TRUST_PROXY:'1'},app);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{origin:'https://tokenapp.ru','x-real-ip':'192.0.2.1','cf-connecting-ip':'spoofed','oai-authenticated-user-id':'spoofed'},body:'{}'});
  assert.equal(r.status,200);assert.equal(seen.url,'https://tokenapp.ru/api/chat');assert.equal(seen.headers.get('cf-connecting-ip'),'192.0.2.1');assert.equal(seen.headers.get('oai-authenticated-user-id'),null);
 }finally{await new Promise(resolve=>server.close(resolve))}
});

test('readiness endpoint needs no model credentials',async()=>{
 const server=createServer({});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/healthz`);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true})}
 finally{await new Promise(resolve=>server.close(resolve))}
});
