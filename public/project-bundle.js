// Export only complete, explicitly named files. Never interpret generated code.
export function projectFiles(text){
 const files=[],seen=new Set();
 const fence=/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
 for(const match of String(text||'').matchAll(fence)){
  const parts=match[1].trim().split(/\s+/),name=parts[1];
  if(parts.length!==2||!name||name.length>200||! /^[\p{L}\p{N}_.\/-]+$/u.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))continue;
  if(seen.has(name.toLowerCase()))throw new Error('Повторяется имя файла: '+name);
  seen.add(name.toLowerCase());files.push({name,content:match[2]});
 }
 return files;
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function projectZip(files){
 if(!files.length||files.length>200)throw new Error('Нужно от 1 до 200 файлов');
 const encoder=new TextEncoder(),chunks=[],directory=[];let offset=0;
 for(const file of files){
  const name=encoder.encode(file.name),data=encoder.encode(file.content),crc=crc32(data);
  if(offset+data.length>50*1024*1024)throw new Error('Проект превышает 50 МБ');
  const header=new Uint8Array(30+name.length),v=new DataView(header.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
  v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);header.set(name,30);
  const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
  c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
  chunks.push(header,data);directory.push(central);offset+=header.length+data.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,directory.reduce((n,b)=>n+b.length,0),true);e.setUint32(16,offset,true);
 return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
