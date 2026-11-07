const headers = {'cache-control':'no-store', 'x-content-type-options':'nosniff'};
export const json = (body, status=200, extra={}) => Response.json(body,{status,headers:{...headers,...extra}});
export const error = (message,status,extra) => json({error:message},status,extra);

export async function readJson(request) {
 if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type')||''))return null;
 const reader = request.body?.getReader();
 if(!reader)return null;
 const chunks = [];
 let size = 0;
 try{
  while(true){
   const {done,value} = await reader.read();
   if(done)break;
   size += value.byteLength;
   if(size>2048){void reader.cancel().catch(()=>{});return null;}
   chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return data && typeof data==='object' && !Array.isArray(data) ? data : null;
 }catch{return null;}
}

export const secureTransport = url => url.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname);
export const trustedOrigin = (request,url) => request.headers.get('origin')===url.origin&&secureTransport(url);
