// Classify the action clause, while retaining the user's wording and payload.
const quotedOrCode=/```[\s\S]*?(?:```|$)|`[^`\r\n]*`|«[^»\r\n]*»|“[^”\r\n]*”|„[^“\r\n]*“|"(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*'/gu;
const actionBoundary=/(?:[.!?](?=\s|$)|\r?\n+|[,;:](?=\s|$)|—(?=\s)|(?<!\S)(?:и|а затем|а потом)\s+(?=(?:сделай|создай|собери|нарисуй|сгенерируй|напиши|проверь|найди|поищи|составь|посчитай|отформатируй|сравни)\s))\s*/giu;
const actionIntro=/^(?:(?:и\s+)?(?:а\s+теперь|а\s+ещ[её]|а|но|теперь|сначала|затем|потом|заодно|дальше|пожалуйста|можешь|можно|давай|короче|слушай|гузан|бро)\s*[,!]?\s+)+/iu;
const requestLead=/^(?:(?:мне\s+)?нужно|(?:я\s+)?хочу|прошу|хотелось бы)$/iu;
const requestForms=new Map(Object.entries({
 сделал:'сделай', создал:'создай', собрал:'собери', нарисовал:'нарисуй',
 сгенерировал:'сгенерируй', написал:'напиши', исправил:'исправь',
 проверил:'проверь', нашёл:'найди', нашел:'найди', поискал:'поищи',
 составил:'составь', посчитал:'посчитай', отформатировал:'отформатируй',
 сделать:'сделай', создать:'создай', собрать:'собери', нарисовать:'нарисуй',
 сгенерировать:'сгенерируй', написать:'напиши', исправить:'исправь',
 проверить:'проверь', найти:'найди', поискать:'поищи', составить:'составь',
 посчитать:'посчитай', отформатировать:'отформатируй', сравнить:'сравни',
}));

function isMention(text){
 return /^(?:объясни|расскажи|покажи пример|приведи пример|как|что значит|что будет|если|когда|я (?:сказал|написал|процитировал)|фраза|команда|пример|не)(?=\s|[:,.!?]|$)/iu.test(text.trim());
}

function normalizeRequest(text,previous,afterIntro){
 const indirect=/^(?:(?<lead>(?:мне\s+)?нужно|(?:я\s+)?хочу|прошу|хотелось бы)\s+)?чтобы\s+ты\s+(?<verb>\p{L}+)(?=\s|$)/iu.exec(text);
 if(indirect&&requestLead.test(indirect.groups.lead||previous)){
  const verb=requestForms.get(indirect.groups.verb.toLowerCase().replace(/ла$/u,'л'));
  if(verb)return verb+text.slice(indirect[0].length);
 }
 if(afterIntro)return text.replace(/^\p{L}+(?=\s|$)/u,verb=>requestForms.get(verb.toLowerCase())||verb);
 return text;
}

export function actionPhrases(content){
 const text=String(content||'').trim();
 if(!text)return [];
 const masked=text.replace(quotedOrCode,part=>' '.repeat(part.length));
 const phrases=[];
 let sentenceStart=0,start=0,clauses=0;
 function add(end){
  const previous=masked.slice(sentenceStart,start).trim().replace(/[,;:]$/u,'').trim();
  const clause=masked.slice(start,end).trim();
  const discussingPhrase=isMention(previous)||/(?:фраз[ауые]|команд[ауые]|пример)(?:\s+(?:для\s+)?(?:примера|теста|проверки))?$/iu.test(previous);
  if(!clause||isMention(clause)||discussingPhrase&&!/^(?:а|но)\s+/iu.test(clause))return;
  const raw=text.slice(start).trimStart();
  if(/^[-–—]?\s*[«“„"'\x60]/u.test(raw))return;
  const skip=raw.match(actionIntro)?.[0].length||0;
  const input=normalizeRequest(raw.slice(skip).trim(),previous,skip>0);
  const short=normalizeRequest(text.slice(start,end).trimStart().slice(skip).trim(),previous,skip>0);
  const visible=normalizeRequest(masked.slice(start,end).trimStart().slice(skip).trim(),previous,skip>0);
  if(short&&visible&&!isMention(input))phrases.push({input,short,visible});
 }
 for(const separator of masked.matchAll(actionBoundary)){
  add(separator.index);
  if(++clauses===128)return phrases;
  start=separator.index+separator[0].length;
  if(/^[.!?\r\n]/u.test(separator[0]))sentenceStart=start;
 }
 add(text.length);
 return phrases;
}

export function resolveAction(content,{local,task,site,image,project}){
 const original=String(content||'').trim();
 const phrases=actionPhrases(original);
 for(const {input,short,visible} of phrases){
  const shortLocal=local(short);
  const endsSentence=/^[.!?](?:\s|$)/u.test(input.slice(short.length));
  const localRequest=shortLocal&&endsSentence?shortLocal:local(input)||shortLocal;
  if(localRequest)return {input,local:localRequest};
  const shortQuery=project?.(short);
  if(shortQuery!=null)return {input,projectQuery:shortQuery||project(input)};
  if(/^(?:найди|поищи|проверь)\s+(?:в интернете|в сети)(?=\s|[,:]|$)/iu.test(short))return {input,web:true};
  const taskRequest=task(visible);
  if((!taskRequest||taskRequest.mode==='code')&&site(visible))return {input,task:task(input)||taskRequest,site:true};
  if(taskRequest)return {input,task:task(input)||taskRequest};
  const imageRequest=image(visible)||(/^(?:нарисуй|изобрази|draw|paint)$/iu.test(visible)&&image(short));
  if(imageRequest)return {input,image:/^\/(?:design|image)\b/iu.test(input)?image(input):{...imageRequest,prompt:imageRequest.mode==='create'?original:input}};
 }
 return {input:original,phrases};
}
