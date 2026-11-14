import http from 'node:http';
import {Readable} from 'node:stream';
import {clientIP,trustedProxies} from './proxy.mjs';
import {createAuth} from './auth.mjs';

export function createServer(env=process.env, app, authOptions) {
  const proxies = trustedProxies(env.TRUST_PROXY);
  const auth = createAuth(env,authOptions);
  const server = http.createServer(async (req,res) => {
    try {
      if (req.url === '/healthz' && ['GET','HEAD'].includes(req.method)) {
        res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
        res.end(req.method==='HEAD'?undefined:JSON.stringify({ok:true})); return;
      }
      const origin=env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      const url=new URL(req.url,origin);
      if(url.origin!==new URL(origin).origin){
        res.writeHead(400);res.end();return;
      }
      const headers=new Headers(req.headers);
      // These identity headers must never be supplied by an Internet client.
      headers.delete('oai-authenticated-user-id'); headers.delete('cf-connecting-ip');
      headers.delete('x-real-ip'); headers.delete('x-forwarded-for');
      headers.set('cf-connecting-ip',clientIP(req.socket.remoteAddress,req.headers['x-real-ip'],proxies));
      const controller=new AbortController();
      res.on('close',()=>{if(!res.writableEnded)controller.abort()});
      const request=new Request(url, {
        method:req.method,headers,signal:controller.signal,
        ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})
      });
      const handler=()=>app?Promise.resolve(app):import('../dist/server/index.js').then(module=>module.default);
      const context={
       reserveProvider:auth.reserveProvider,
       async runBackground(input,research,signal,userId){
        const api=await handler();
        const internalHeaders=new Headers({'content-type':'application/json',origin});
        internalHeaders.set('oai-authenticated-user-id',userId);
        const call=(path,body,ctx={userId})=>api.fetch(new Request(new URL(path,origin),{
         method:'POST',headers:internalHeaders,body:JSON.stringify(body),signal
        }),env,{...ctx,reserveProvider:auth.reserveProvider});
        if(research){
         const response=await call('/api/search',research);
         if(!response.ok)return response;
         input.searchId=(await response.json()).searchId;
        }
        const activity={userId,activity:'chat'};
        const response=await call('/api/chat',input,activity);
        try{auth.record(userId,activity.activity,response.ok);}catch{console.error('Focus could not record activity.');}
        return response;
       }
      };
      let response=await auth.handle(request,url.pathname,headers.get('cf-connecting-ip'),context);
      if(!response&&url.pathname.startsWith('/api/')&&!context.userId){
        response=Response.json({error:'Войди в Focus, чтобы продолжить.'},{status:401,headers:{'cache-control':'no-store'}});
      }
      if(!response){
        const api=await handler();
        if(request.method==='POST')context.activity={'/api/chat':'chat','/api/search':'search'}[url.pathname];
        response=await api.fetch(request,env,context);
        if(context.userId&&['chat','site','image','search'].includes(context.activity)){
          try{auth.record(context.userId,context.activity,response.ok);}catch{console.error('Focus could not record activity.');}
        }
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body && req.method!=='HEAD') Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch {
      if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain'});
      res.end('Server error');
    }
  });
  server.once('close',()=>auth.close());
  return server;
}
