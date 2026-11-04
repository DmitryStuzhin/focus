import http from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
const publicFiles=new Set(['index.html','app.js','store.js','icons.js','styles.css','favicon.svg']);
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
import worker from '../dist/server/index.js';
const server=http.createServer(async(req,res)=>{try{const origin='http://'+req.headers.host;const name=new URL(req.url,origin).pathname.slice(1)||'index.html';if(publicFiles.has(name)){res.writeHead(200,{'content-type':types[name.split('.').pop()],'cache-control':'no-store'});res.end(await readFile(new URL('../public/'+name,import.meta.url)));return}const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});const response=await worker.fetch(request,process.env,{});res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end()}catch{res.writeHead(500);res.end('Server error')}});
server.listen(Number(process.env.PORT||process.argv[process.argv.indexOf('--port')+1]||3000),'0.0.0.0',()=>console.log('Focus preview ready'));
