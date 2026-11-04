import http from 'node:http';
import {Readable} from 'node:stream';

export function createServer(env=process.env, app) {
  return http.createServer(async (req,res) => {
    try {
      if (req.url === '/healthz' && ['GET','HEAD'].includes(req.method)) {
        res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
        res.end(req.method==='HEAD'?undefined:JSON.stringify({ok:true})); return;
      }
      const origin=env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      const headers=new Headers(req.headers);
      // These identity headers must never be supplied by an Internet client.
      headers.delete('oai-authenticated-user-id'); headers.delete('cf-connecting-ip');
      headers.set('cf-connecting-ip',env.TRUST_PROXY==='1'?(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress);
      const controller=new AbortController();
      res.on('close',()=>{if(!res.writableEnded)controller.abort()});
      const request=new Request(new URL(req.url,origin), {
        method:req.method,headers,signal:controller.signal,
        ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})
      });
      const handler=app || (await import('../dist/server/index.js')).default;
      const response=await handler.fetch(request,env,{});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body && req.method!=='HEAD') Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch {
      if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain'});
      res.end('Server error');
    }
  });
}
