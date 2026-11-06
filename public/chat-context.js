const SEARCH_LIMIT = 600;
const TEXT_LIMIT = 145_000;
const REQUEST_LIMIT = 11_900_000;
const PROJECT_TEXT_LIMIT = 30_000;
const ATTACHMENT_LIMIT = 8;
const encoder = new TextEncoder();
const bytes = value => encoder.encode(JSON.stringify(value)).byteLength;

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
    .filter(word => !/^(?:для|или|как|что|это|файл|the|and|for|with|file)$/u.test(word)));
}

export function rankProjectFiles(files, question) {
  const query = terms(question);
  return files.map(file => ({
    file,
    score: [...terms(file.name.replace(/\.[^.]+$/, ''))].filter(word => query.has(word)).length,
  })).sort((a, b) => b.score - a.score || (b.file.updated || 0) - (a.file.updated || 0))
    .map(({file}) => file);
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

  function appendAttachment(message, file, textCap = textLeft, query) {
    if (message.attachments.length >= ATTACHMENT_LIMIT) return false;
    const available = Math.min(textLeft, textCap);
    let attachment = file;
    if (typeof file.text === 'string' && file.text.length > available) {
      const text = excerpt(file.text, available, query);
      if (!text) return false;
      attachment = {...file, text, truncated: true};
    }
    const cost = bytes(attachment) + 1;
    if (cost > bytesLeft) return false;
    message.attachments.push(attachment);
    bytesLeft -= cost;
    textLeft -= attachment.text?.length || 0;
    return true;
  }

  // Protect the latest question and explicitly attached files before optional context.
  const latest = selected.at(-1);
  if (!latest) return result;
  const current = {role: latest.role || 'user', content: latest.content || '', attachments: []};
  const query = terms(current.content);
  textLeft -= current.content.length;
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
    for (const file of rankProjectFiles(projectFiles, current.content).filter(file => !seen.has(file.id)).slice(0, 5)) {
      if (current.attachments.length >= ATTACHMENT_LIMIT || Math.min(projectLeft, textLeft) < 500) break;
      const [attachment] = await readAttachments([file.id]);
      if (!attachment?.text) continue;
      const before = textLeft;
      // Cap each automatic excerpt so one document cannot consume all project context.
      if (appendAttachment(current, attachment, Math.min(12_000, projectLeft), query)) {
        seen.add(file.id);
        projectLeft -= before - textLeft;
      }
    }
  }
  result.push(current);

  for (const original of selected.slice(0, -1).reverse()) {
    const message = {role: original.role || 'user', content: original.content || '', attachments: []};
    const cost = bytes(message) + 1;
    if (message.content.length > textLeft || cost > bytesLeft) break;
    textLeft -= message.content.length;
    bytesLeft -= cost;
    const ids = (original.files || []).filter(id => !seen.has(id)).slice(0, ATTACHMENT_LIMIT);
    for (const file of await readAttachments(ids)) appendAttachment(message, file);
    for (const id of ids) seen.add(id);
    if (message.content.trim() || message.attachments.length) result.push(message);
  }
  result.reverse();
  // A clipped history can begin with an answer whose question was outside the budget.
  while (result[0]?.role === 'assistant' && result.length > 1) result.shift();
  return result;
}
