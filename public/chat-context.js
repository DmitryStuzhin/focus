const SEARCH_LIMIT = 600;
const TEXT_LIMIT = 145_000;
const REQUEST_LIMIT = 11_900_000;
const PROJECT_TEXT_LIMIT = 30_000;
const ATTACHMENT_LIMIT = 8;
export const MAX_QUOTE_LENGTH = 4000;
const encoder = new TextEncoder();
const bytes = value => encoder.encode(JSON.stringify(value)).byteLength;

function messageContext(message) {
  const role = message.role || 'user';
  const quote = role === 'user' && typeof message.quote === 'string' ? message.quote.slice(0, MAX_QUOTE_LENGTH) : '';
  return {role, content: message.content || '', ...(quote ? {quote} : {}), attachments: []};
}

// Carry a topic forward for short follow-ups with an explicit reference.
const followUp = /^(?:а\s+(?:в|на|у|для|по|что насч[её]т)|(?:а\s+)?(?:почему|зачем|когда|где|сколько|как)\s+(?:это|он[аи]?|они|там|тогда)|(?:а\s+)?(?:источники|подробнее|сравни с|что насч[её]т)|(?:and (?:in|for)|what about|how about|why is that|sources|tell me more)\b)(?:[\s?.,!]|$)/iu;
const normalize = value => (value || '').trim().replace(/\s+/g, ' ');
const isFollowUp = text => text.length <= 140 && (followUp.test(text) || /^(?:а\s+)?(?:почему|зачем|где|когда|сколько|why|where|when)\s*[?!.]*$/iu.test(text));

export function searchQuery(messages) {
  const questions = messages.filter(message => message.role === 'user');
  const current = normalize(questions.at(-1)?.content);
  if (!isFollowUp(current)) return current.slice(0, SEARCH_LIMIT);

  const recent = questions.slice(-4, -1).reverse();
  const prior = recent.map(message => normalize(message.content)).find(text => text && !isFollowUp(text));
  if (!prior) return current;
  return [current, prior, ...recent.map(message => normalize(message.content))
    .filter(text => text && text !== current && isFollowUp(text))].join(' ').slice(0, SEARCH_LIMIT);
}

function terms(value) {
  return new Set((value.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter(word => !/^(?:для|или|как|что|это|файл|файле|файлы|где|покажи|найди|проверь|проекте|исправь|напиши|the|and|for|with|file)$/u.test(word)));
}

export function rankProjectFiles(files, question) {
  const query = terms(question);
  return files.map(file => ({
    file,
    score: [...terms(file.name.replace(/\.[^.]+$/, ''))].filter(word => query.has(word)).length,
  })).sort((a, b) => b.score - a.score || (b.file.updated || 0) - (a.file.updated || 0))
    .map(({file}) => file);
}

const tokens=value=>value.toLowerCase().replaceAll('ё','е').match(/[\p{L}\p{N}]{3,}/gu)||[];

async function readRelevantProjectFiles(files,question,readAttachments){
 const query=terms(question);
 if(!query.size)return [];
 const documents=[];
 let remaining=2_000_000;
 for(const file of rankProjectFiles(files,question).slice(0,60)){
  if(remaining<=0)break;
  const [attachment]=await readAttachments([file.id]);
  if(!attachment?.text)continue;
  const words=tokens(attachment.text.slice(0,remaining));
  remaining-=attachment.text.length;
  const counts=new Map();
  for(const word of words)if(query.has(word))counts.set(word,(counts.get(word)||0)+1);
  documents.push({file,attachment,counts,length:words.length});
 }
 if(!documents.length)return [];
 const average=documents.reduce((sum,document)=>sum+document.length,0)/documents.length||1;
 const frequencies=new Map([...query].map(word=>[word,documents.filter(document=>document.counts.has(word)).length]));
 return documents.map(document=>{
  let score=0;
  const title=terms(document.file.name.replace(/\.[^.]+$/, ''));
  for(const word of query){
   const tf=document.counts.get(word)||0;
   const df=frequencies.get(word);
   const idf=Math.log(1+(documents.length-df+0.5)/(df+0.5));
   const norm=1.2*(0.25+0.75*document.length/average);
   score+=idf*(tf*2.2/(tf+norm)+(title.has(word)?1:0));
  }
  return {...document,score};
 }).filter(document=>document.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}

export function summarizeHistory(messages){
 const candidates=messages.filter(message=>message.content?.trim());
 const selected=[...new Set([...candidates.slice(0,2),...candidates.slice(-8)])];
 return selected.map(({role,content})=>{
  const short=content.slice(0,800).replace(/\s+/gu,' ').trim().slice(0,220);
  return (role==='assistant'?'Focus: ':'Пользователь: ')+short;
 }).join('\n');
}

function excerpt(text, limit, query) {
  const note = '[Текст файла сокращён из-за лимита контекста]';
  const span = limit - note.length - 3;
  if (span < 100) return null;

  let bestStart = 0;
  if (query?.size) {
    const lastStart = text.length - span;
    const step = Math.floor(span / 2);
    let bestScore = -1;
    for (let start = 0; ; start = Math.min(lastStart, start + step)) {
      const sample = text.slice(start, start + span);
      const score = [...terms(sample)].filter(word => query.has(word)).length;
      if (score > bestScore) {
        bestStart = start;
        bestScore = score;
      }
      if (start === lastStart || score === query.size) break;
    }
  }
  const end = bestStart + span;
  const body = text.slice(bestStart, end);
  return bestStart ? note + '\n' + body + (end < text.length ? '\n…' : '') : body + '\n' + note;
}

export async function buildChatContext(messages, projectFiles, readAttachments, preview = null) {
  const selected = messages.slice(-40);
  const result = [];
  const seen = new Set();
  let textLeft = TEXT_LIMIT;
  let bytesLeft = REQUEST_LIMIT;

  // Reserve room for recent instructions before filling the request with files.
  const recent = selected.slice(0, -1).slice(-8);
  const reservedText = Math.min(20_000, recent.reduce((sum, message) => sum + (message.content || '').length + (messageContext(message).quote?.length || 0), 0));
  const reservedBytes = Math.min(100_000, recent.reduce((sum, message) => sum + bytes(messageContext(message)) + 1, 0));
  let textReserve = reservedText;
  let byteReserve = reservedBytes;

  function appendAttachment(message, file, textCap = textLeft, query) {
    if (message.attachments.length >= ATTACHMENT_LIMIT) return false;
    const available = Math.max(0, Math.min(textLeft - textReserve, textCap));
    let attachment = file;
    if (typeof file.text === 'string' && file.text.length > available) {
      const text = excerpt(file.text, available, query);
      if (!text) return false;
      attachment = {...file, text, truncated: true};
    }
    const cost = bytes(attachment) + 1;
    if (cost > bytesLeft - byteReserve) return false;
    message.attachments.push(attachment);
    bytesLeft -= cost;
    textLeft -= attachment.text?.length || 0;
    return true;
  }

  // Protect the latest question and explicitly attached files before optional context.
  const latest = selected.at(-1);
  if (!latest) return result;
  const current = messageContext(latest);
  const refersBack = current.content.length <= 180 &&
    /^(?:(?:а |теперь |пожалуйста[, ]+))?(?:исправь|доработай|продолжи|улучши|сделай (?:это|его|её|ее)|проверь (?:это|его|её|ее)|объясни подробнее|а что|подробнее)(?=\s|[.!?]|$)/iu.test(current.content.trim());
  const topic = refersBack ? recent.filter(message => message.role === 'user').slice(-2)
    .map(message => message.content).join(' ').slice(-3000) : '';
  const retrievalQuestion = [current.content, topic].filter(Boolean).join(' ');
  const query = terms(retrievalQuestion);
  textLeft -= current.content.length + (current.quote?.length || 0);
  bytesLeft -= bytes(current) + 1;
  if (preview) appendAttachment(current, preview, Math.min(110_000, Math.floor(textLeft * 0.8)));
  const currentIds = [...new Set(latest.files || [])].slice(0, ATTACHMENT_LIMIT);
  const explicit = await readAttachments(currentIds);
  let remainingTexts = explicit.filter(file => typeof file.text === 'string').length;
  for (const file of explicit) {
    if (typeof file.text === 'string') {
      appendAttachment(current, file, Math.floor(textLeft / remainingTexts), query);
      remainingTexts--;
    } else {
      appendAttachment(current, file);
    }
  }
  for (const id of currentIds) seen.add(id);

  if (current.role === 'user') {
    let projectLeft = PROJECT_TEXT_LIMIT;
    const availableFiles=projectFiles.filter(file=>!seen.has(file.id));
    const candidates=current.attachments.length<ATTACHMENT_LIMIT&&textLeft>=500
      ?await readRelevantProjectFiles(availableFiles,retrievalQuestion,readAttachments):[];
    for (const {file,attachment} of candidates) {
      if (current.attachments.length >= ATTACHMENT_LIMIT || Math.min(projectLeft, textLeft) < 500) break;
      const before = textLeft;
      // Cap each automatic excerpt so one document cannot consume all project context.
      if (appendAttachment(current, attachment, Math.min(12_000, projectLeft), query)) {
        seen.add(file.id);
        projectLeft -= before - textLeft;
      }
    }
  }
  result.push(current);

  let included=1;
  for (const original of selected.slice(0, -1).reverse()) {
    const message = messageContext(original);
    const cost = bytes(message) + 1;
    const textLength = message.content.length + (message.quote?.length || 0);
    if (textLength > textLeft || cost > bytesLeft) break;
    included++;
    textReserve = Math.max(0, textReserve - textLength);
    byteReserve = Math.max(0, byteReserve - cost);
    textLeft -= textLength;
    bytesLeft -= cost;
    const ids = (original.files || []).filter(id => !seen.has(id)).slice(0, ATTACHMENT_LIMIT);
    for (const file of await readAttachments(ids)) appendAttachment(message, file);
    for (const id of ids) seen.add(id);
    if (message.content.trim() || message.attachments.length) result.push(message);
  }
  result.reverse();
  // A clipped history can begin with an answer whose question was outside the budget.
  while (result[0]?.role === 'assistant' && result.length > 1) result.shift();
  if(messages.length>40){
    const older=messages.slice(0,messages.length-included);
    const available=Math.min(2400,textLeft,Math.floor((bytesLeft-120)/4));
    if(available>100){
      const summary=summarizeHistory(older).slice(0,available);
      if(summary)current.historySummary=summary;
    }
  }
  return result;
}
