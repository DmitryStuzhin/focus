const FILE_LIMIT=120;
const FILE_SIZE_LIMIT=500_000;
const TEXT_BUDGET=4_000_000;
const MATCH_LIMIT=20;
const fold=value=>value.toLocaleLowerCase('ru');
const lineBreak=/\r\n?|\n/u;

export function projectSearchQuery(content){
 const match=/^\s*(?:пожалуйста[ ,]+)?(?:найди|поищи|покажи совпадения)\s+в\s+(?:проекте|файлах(?:\s+проекта)?|исходниках)(?=\s|[:,.!?]|$)\s*:?\s*([\s\S]*)$/iu.exec(content||'');
 if(!match)return null;
 const query=match[1].trim();
 const quoted=/^(?:"([^"]*)"|«([^»]*)»|`([^`]*)`)[.!?]?$/u.exec(query);
 return (quoted?quoted[1]??quoted[2]??quoted[3]:query).trim();
}

export function projectPath(file,folders){
 const names=[file.name],seen=new Set();
 let id=file.parent;
 while(id&&!seen.has(id)&&names.length<32){
  seen.add(id);
  const parent=folders.get(id);
  if(!parent)break;
  names.unshift(parent.name);
  id=parent.parent;
 }
 return names.join('/');
}

export async function searchProjectFiles(files,query,readText,signal){
 const needle=fold(query);
 if(!needle||query.length>160||lineBreak.test(query))throw Error('Введите строку поиска длиной до 160 символов. Например: Найди в проекте loginUser');
 const results=[];
 let scanned=0,used=0,limited=false;
 for(const file of files){
  signal?.throwIfAborted();
  if(scanned>=FILE_LIMIT||used>=TEXT_BUDGET){limited=true;break;}
  if(file.size>FILE_SIZE_LIMIT){limited=true;continue;}
  const text=await readText(file.id);
  signal?.throwIfAborted();
  if(typeof text!=='string'){limited=true;continue;}
  if(text.length>FILE_SIZE_LIMIT||used+text.length>TEXT_BUDGET){limited=true;continue;}
  scanned++;
  used+=text.length;
  const lines=text.split(lineBreak);
  for(const [index,line] of lines.entries()){
   const offset=fold(line).indexOf(needle);
   if(offset<0)continue;
   if(results.length===MATCH_LIMIT)return {results,scanned,limited:true};
   const start=Math.max(0,offset-75);
   const end=Math.min(line.length,offset+needle.length+75);
   results.push({fileId:file.id,path:file.path||file.name,line:index+1,snippet:(start?'…':'')+line.slice(start,end)+(end<line.length?'…':'')});
  }
 }
 return {results,scanned,limited};
}

export function readMatchContext(text,line,query){
 const lines=text.split(lineBreak);
 if(!Number.isSafeInteger(line)||line<1||line>lines.length||!fold(lines[line-1]).includes(fold(query)))return null;
 const start=Math.max(0,line-4);
 return lines.slice(start,line+3).map((value,index)=>({line:start+index+1,text:value}));
}
