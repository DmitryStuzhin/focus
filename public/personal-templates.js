const LIMIT=40;
const MAX_TITLE=70;
const MAX_PROMPT=5000;

export function importTemplates(value){
 if(value?.version!==1||!Array.isArray(value.templates)||value.templates.length>LIMIT){
  throw new Error('Выберите JSON-файл шаблонов Focus (до 40 шаблонов).');
 }
 const templates=value.templates.map(item=>{
  if(typeof item?.title!=='string'||typeof item.prompt!=='string'||
   !item.title.trim()||item.title.length>MAX_TITLE||!item.prompt.trim()||item.prompt.length>MAX_PROMPT){
   throw new Error('В каждом шаблоне нужны название и текст.');
  }
  return {title:item.title.trim(),prompt:item.prompt.trim()};
 });
 if(new Set(templates.map(item=>item.title.toLocaleLowerCase('ru'))).size!==templates.length){
  throw new Error('Названия шаблонов должны отличаться.');
 }
 return templates;
}

export function saveTemplate(templates,template){
 const key=template.title.trim().toLocaleLowerCase('ru');
 return importTemplates({version:1,templates:[
  ...templates.filter(item=>item.title.toLocaleLowerCase('ru')!==key),template
 ]});
}
