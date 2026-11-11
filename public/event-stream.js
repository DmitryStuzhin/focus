export async function* eventStream(body){
 const reader=body.pipeThrough(new TextDecoderStream()).getReader();
 let buffer='',data=[];
 try{
  for(;;){
   const {value,done}=await reader.read();
   buffer+=value??'';
   let newline;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline).replace(/\r$/u,'');
    buffer=buffer.slice(newline+1);
    if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /u,''));
    else if(!line&&data.length){yield data.join('\n');data=[];}
   }
   if(buffer.length>1024*1024)throw new Error('Поток модели содержит слишком большое событие.');
   if(done)break;
  }
  if(buffer.startsWith('data:'))data.push(buffer.slice(5).trimStart());
  if(data.length)yield data.join('\n');
 }finally{await reader.cancel().catch(()=>{});}
}
