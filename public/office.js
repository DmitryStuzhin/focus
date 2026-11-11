import {projectZip} from './project-bundle.js';
import {csvTable} from './tabular.js';

const MAIN='http://schemas.openxmlformats.org';
const TYPES='http://schemas.openxmlformats.org/package/2006/content-types';
const REL=MAIN+'/officeDocument/2006/relationships';
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu,'')
 .replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[char]);
const relationships=entries=>XML+`<Relationships xmlns="${MAIN}/package/2006/relationships">${entries.map(([type,target],i)=>`<Relationship Id="rId${i+1}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
function officeZip(main,parts,mime){
 const contentTypes=XML+`<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.filter(part=>part.type).map(part=>`<Override PartName="/${part.name}" ContentType="application/vnd.openxmlformats-officedocument.${part.type}+xml"/>`).join('')}</Types>`;
 const zip=projectZip([{name:'[Content_Types].xml',content:contentTypes},{name:'_rels/.rels',content:relationships([['officeDocument',main]])},...parts]);
 return new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.'+mime});
}
const colName=index=>{
 let value='';
 for(let n=index+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;
 return value;
};
export function createWorkbook(sheets){
 const root='xl/workbook.xml';
 const ns=MAIN+'/spreadsheetml/2006/main';
 const workbook=XML+`<workbook xmlns="${ns}" xmlns:r="${REL}"><sheets>${sheets.map(({name},i)=>`<sheet name="${xml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
 const parts=sheets.map(({rows},i)=>({
  name:`xl/worksheets/sheet${i+1}.xml`,type:'spreadsheetml.worksheet',
  content:XML+`<worksheet xmlns="${ns}"><sheetData>${rows.map((row,index)=>`<row r="${index+1}">${row.map((value,c)=>`<c r="${colName(c)}${index+1}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value??'').slice(0,32767))}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
 }));
 return officeZip(root,[
  {name:root,type:'spreadsheetml.sheet.main',content:workbook},
  {name:'xl/_rels/workbook.xml.rels',content:relationships(parts.map((_,i)=>['worksheet',`worksheets/sheet${i+1}.xml`]))},...parts
 ],'spreadsheetml.sheet');
}

const descendants=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
const MAX_ENTRY=12*1024*1024;
async function readZip(file){
 if(file.size>12*1024*1024)throw new Error('Таблица должна занимать до 12 МБ.');
 const bytes=await file.arrayBuffer(),data=new DataView(bytes);
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let end=data.byteLength-22;
 while(end>=Math.max(0,data.byteLength-65557)&&data.getUint32(end,true)!==0x06054b50)end--;
 if(end<0||end<Math.max(0,data.byteLength-65557))throw new Error('Не удалось прочитать архив XLSX.');
 const entries=new Map();
 let position=data.getUint32(end+16,true);
 const count=data.getUint16(end+10,true);
 if(count>1024)throw new Error('Слишком много частей в XLSX.');
 for(let i=0;i<count;i++){
  if(data.getUint32(position,true)!==0x02014b50)throw new Error('Некорректный каталог XLSX.');
  const nameLength=data.getUint16(position+28,true);
  const name=decoder.decode(bytes.slice(position+46,position+46+nameLength));
  entries.set(name,{
   method:data.getUint16(position+10,true),compressed:data.getUint32(position+20,true),
   size:data.getUint32(position+24,true),offset:data.getUint32(position+42,true)
  });
  position+=46+nameLength+data.getUint16(position+30,true)+data.getUint16(position+32,true);
 }
 return async name=>{
  const entry=entries.get(name);
  if(!entry)return null;
  const {offset,size,method,compressed}=entry;
  if(size>MAX_ENTRY||data.getUint32(offset,true)!==0x04034b50)throw new Error('Часть XLSX превышает допустимый размер.');
  const start=offset+30+data.getUint16(offset+26,true)+data.getUint16(offset+28,true);
  if(start+compressed>data.byteLength)throw new Error('Повреждённый XLSX.');
  const payload=bytes.slice(start,start+compressed);
  let decoded;
  if(method===0)decoded=decoder.decode(payload);
  else if(method===8){
   const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
   const chunks=[];
   let length=0;
   try{
    for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     length+=value.byteLength;
     if(length>MAX_ENTRY)throw new Error('Распакованная часть XLSX слишком большая.');
     chunks.push(value);
    }
    if(length!==size)throw new Error('Повреждённый XLSX.');
    decoded=await new Blob(chunks).text();
   }finally{await reader.cancel().catch(()=>{});}
  }else throw new Error('Формат сжатия XLSX не поддерживается.');
  if(/<!DOCTYPE|<!ENTITY/iu.test(decoded))throw new Error('В XLSX обнаружено недопустимое объявление XML.');
  const result=new DOMParser().parseFromString(decoded,'application/xml');
  if(result.querySelector('parsererror'))throw new Error('Не удалось прочитать XML таблицы.');
  return result;
 };
}

export async function openTable(file){
 if(/\.csv$/iu.test(file.name))return csvTable(await file.text(),'',true);
 if(!/\.xlsx$/iu.test(file.name))throw new Error('Выбери файл CSV или XLSX.');
 const part=await readZip(file);
 const [workbook,rels,strings]=await Promise.all([part('xl/workbook.xml'),part('xl/_rels/workbook.xml.rels'),part('xl/sharedStrings.xml')]);
 if(!workbook||!rels)throw new Error('Не удалось открыть книгу XLSX.');
 const sheet=descendants(workbook,'sheet')[0];
 const key=sheet?.getAttributeNS(REL,'id');
 const target=descendants(rels,'Relationship').find(node=>node.getAttribute('Id')===key)?.getAttribute('Target');
 const path=target?.startsWith('/')?target.slice(1):'xl/'+target;
 if(!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/u.test(path))throw new Error('В XLSX отсутствует первый рабочий лист.');
 const table=await part(path);
 if(!table)throw new Error('Первый лист XLSX не найден.');
 const shared=strings?descendants(strings,'si').map(node=>descendants(node,'t').map(t=>t.textContent).join('')):[];
 const rows=[];
 for(const element of descendants(table,'row')){
  const row=[];
  for(const cell of descendants(element,'c')){
   const column=/^[A-Z]{1,3}/u.exec(cell.getAttribute('r')||'')?.[0];
   if(!column)throw new Error('Не удалось определить столбец XLSX.');
   let index=0;
   for(const char of column)index=index*26+char.charCodeAt(0)-64;
   const raw=descendants(cell,'v')[0]?.textContent||'';
   const type=cell.getAttribute('t');
   const value=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?descendants(cell,'t').map(t=>t.textContent).join(''):raw;
   if(!value)continue;
   if(index>64)throw new Error('Поддерживаются таблицы до 64 столбцов.');
   row[index-1]=value;
  }
  if(!row.some(Boolean))continue;
  rows.push(Array.from(row,value=>value??''));
  if(rows.length>5001)throw new Error('Поддерживаются таблицы до 5000 строк данных.');
 }
 if(!rows.length)throw new Error('Первый лист XLSX пуст.');
 return rows;
}

const WORD=MAIN+'/wordprocessingml/2006/main';
export function createDocument(title,text){
 const paragraph=(value,bold=false)=>`<w:p><w:r>${bold?'<w:rPr><w:b/><w:sz w:val="34"/></w:rPr>':''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
 const body=paragraph(title,true)+String(text).split(/\r?\n/u).slice(0,4000).map(line=>{
  const heading=/^#{1,6}\s+/u.test(line);
  return paragraph(line.replace(/^#{1,6}\s+/u,'').replace(/^[-*]\s+/u,'• '),heading);
 }).join('');
 return officeZip('word/document.xml',[{name:'word/document.xml',type:'wordprocessingml.document.main',content:
  XML+`<w:document xmlns:w="${WORD}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
 }],'wordprocessingml.document');
}

const P=MAIN+'/presentationml/2006/main';
const A=MAIN+'/drawingml/2006/main';
const ppt=(element,content)=>XML+`<p:${element} xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${REL}">${content}</p:${element}>`;
const shapes=content=>`<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld>`;
const colorMap='<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';
function textBox(id,label,lines,y,height,size,color){
 const paragraphs=lines.map(line=>`<a:p><a:r><a:rPr lang="ru-RU" sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xml(line)}</a:t></a:r></a:p>`).join('');
 return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${label}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="625000" y="${y}"/><a:ext cx="10900000" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
export function createSlides(title,text){
 const content=String(text).split(/\r?\n/u).filter(line=>line.trim()).slice(0,240);
 const slides=[];
 let group={title,lines:[]};
 for(const line of content){
  const heading=/^#{1,6}\s+(.*)/u.exec(line);
  if(heading){
   if(group.lines.length)slides.push(group);
   group={title:heading[1].slice(0,140),lines:[]};
   continue;
  }
  const words=line.replace(/^[-*]\s+/u,'• ').match(/.{1,150}(?:\s|$)|.{1,150}/gu)||[];
  for(const word of words){
   if(group.lines.length===6){slides.push(group);group={title:group.title,lines:[]};}
   group.lines.push(word.trim());
  }
 }
 if(group.lines.length||!slides.length)slides.push(group);
 if(slides.length>50)throw new Error('Ответ слишком длинный для 50 слайдов. Сократите его перед экспортом.');
 const root='ppt/presentation.xml';
 const parts=[
  {name:root,type:'presentationml.presentation.main',content:ppt('presentation',
   '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'+
   '<p:sldIdLst>'+slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join('')+'</p:sldIdLst>'+
   '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>')},
  {name:'ppt/_rels/presentation.xml.rels',content:relationships([['slideMaster','slideMasters/slideMaster1.xml'],...slides.map((_,i)=>['slide',`slides/slide${i+1}.xml`])])},
  {name:'ppt/slideMasters/slideMaster1.xml',type:'presentationml.slideMaster',content:ppt('sldMaster',shapes('')+colorMap+'<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>')},
  {name:'ppt/slideMasters/_rels/slideMaster1.xml.rels',content:relationships([['slideLayout','../slideLayouts/slideLayout1.xml']])},
  {name:'ppt/slideLayouts/slideLayout1.xml',type:'presentationml.slideLayout',content:ppt('sldLayout',shapes('')+'<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>')},
  {name:'ppt/slideLayouts/_rels/slideLayout1.xml.rels',content:relationships([['slideMaster','../slideMasters/slideMaster1.xml']])}
 ];
 for(const [index,slide] of slides.entries()){
  const number=index+1;
  parts.push({name:`ppt/slides/slide${number}.xml`,type:'presentationml.slide',content:ppt('sld',shapes(
   textBox(2,'Title',[slide.title],380000,1050000,3100,'272523')+
   textBox(3,'Content',slide.lines,1660000,4500000,1900,'383530')
  )+'<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>')});
  parts.push({name:`ppt/slides/_rels/slide${number}.xml.rels`,content:relationships([['slideLayout','../slideLayouts/slideLayout1.xml']])});
 }
 return officeZip(root,parts,'presentationml.presentation');
}

export const officeFilename=name=>/\.(?:docx|pptx|xlsx)$/iu.test(name);

export async function officeText(file){
 const extension=file.name.toLowerCase().split('.').at(-1);
 const limit=100000;
 let text='',clipped=false;
 const append=line=>{
  const remaining=limit-text.length;
  if(line.length+1>remaining)clipped=true;
  text+=(line+'\n').slice(0,remaining);
 };
 if(extension==='xlsx'){
  for(const row of await openTable(file)){
   append(row.map(value=>value.replace(/[\t\r\n]+/gu,' ')).join('\t'));
   if(clipped)break;
  }
 }else if(extension==='docx'){
  const part=await readZip(file);
  const doc=await part('word/document.xml');
  if(!doc)throw new Error('В документе отсутствует основной текст.');
  for(const paragraph of descendants(doc,'p')){
   append(descendants(paragraph,'t').map(node=>node.textContent).join(''));
   if(clipped)break;
  }
 }else if(extension==='pptx'){
  const part=await readZip(file);
  const [presentation,rels]=await Promise.all([part('ppt/presentation.xml'),part('ppt/_rels/presentation.xml.rels')]);
  if(!presentation||!rels)throw new Error('В презентации отсутствует список слайдов.');
  const targets=new Map(descendants(rels,'Relationship').map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]));
  const ids=descendants(presentation,'sldId');
  for(const [index,id] of ids.slice(0,100).entries()){
   const target=targets.get(id.getAttributeNS(REL,'id'));
   const path=target?.startsWith('/')?target.slice(1):'ppt/'+target;
   if(!/^ppt\/slides\/[A-Za-z0-9_.-]+\.xml$/u.test(path))throw new Error('Некорректная ссылка на слайд.');
   const slide=await part(path);
   if(!slide)throw new Error('Слайд отсутствует в архиве презентации.');
   append('Слайд '+(index+1));
   for(const paragraph of descendants(slide,'p')){
    append(descendants(paragraph,'t').map(node=>node.textContent).join(''));
    if(clipped)break;
   }
   if(clipped)break;
  }
  clipped||=ids.length>100;
 }else throw new Error('Формат файла не поддерживается.');
 return {text:text.trimEnd(),truncated:clipped};
}
