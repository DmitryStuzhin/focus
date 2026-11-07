function requestWords(content){
 return String(content||'').trim().replace(/^(?:(?:пожалуйста|давай|бро|можешь)(?:\s*[,!]\s*|\s+))+/iu,'');
}

export function taskIntent(content){
 const text=requestWords(content);
 const command=/^\/(code|plan|review)(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:command[1].toLowerCase(),details:command[2]};
 if(/^(?:(?:проверь|посмотри|разбери|проанализируй)\s+(?:(?:мой|этот|прикрепл[её]нный)\s+)?(?:код|исходник\p{L}*|правк\p{L}*|diff)(?=[\s:,.!?]|$)|(?:проведи|сделай)\s+(?:ревью|код[- ]ревью)|найди\s+ошибки\s+в\s+(?:коде|исходниках))/iu.test(text))return {mode:'review',details:text};
 if(/^(?:составь|сделай|подготовь|продумай|предложи)\s+(?:(?:пошаговый|подробный|рабочий)\s+)?план(?=[\s:,.!?]|$)/iu.test(text))return {mode:'plan',details:text};
 const codeAction=/^(?:напиши|создай|исправь|измени|обнови|добавь|сгенерируй|перепиши|реализуй)\s+/iu;
 const codeTarget=/(?:^|\s)(?:код|скрипт|программ[ау]|функци[юию]|тест[ы]?|python|javascript|typescript|rust|java|sql|golang|c\+\+|c#)(?=[\s:,.!?]|$)|(?:^|\s)[a-z0-9_.-]+\.(?:py|js|ts|rs|go|java|cpp|cs|sql|sh|rb|php|html|css)(?=[\s:,.!?]|$)/iu;
 if(codeAction.test(text)&&codeTarget.test(text))return {mode:'code',details:text};
 if(/^напиши\s+на\s+go(?=[\s:,.!?]|$)/iu.test(text))return {mode:'code',details:text};
 return null;
}

export function localIntent(content){
 const text=requestWords(content);
 const command=/^\/(calc|stats|convert|csv|diff|json)(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:command[1].toLowerCase(),details:command[2].trim()};
 const json=/^(?:проверь|отформатируй|приведи в порядок)\s+(?:этот\s+|прикрепл[её]нный\s+)?json(?:[- ]файл)?(?=[\s:.!?]|$)\s*:?\s*([\s\S]*)$/iu.exec(text);
 if(json)return {mode:'json',details:json[1].replace(/^\s*[.!?]\s*$/u,'').trim()};
 const calc=/^(?:посчитай|вычисли|рассчитай|сколько будет)\s*:?\s*([\d.,+−\-×÷*/^%() \t]+)\s*[?!.]?$/iu.exec(text);
 if(calc&&/\d/u.test(calc[1]))return {mode:'calc',details:calc[1].trim().replace(/\.$/u,'')};
 const convert=/^(?:переведи|конвертируй)\s+([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[а-я]+\s+в\s+[а-я]+)\s*[?!.]?$/iu.exec(text);
 if(convert)return {mode:'convert',details:convert[1]};
 const stats=/^(?:(?:посчитай|покажи|рассчитай)\s+)?статистик[уа]\s+(?:для\s+(?:чисел\s+)?|по\s+числам\s+)?([\d.,;+\- \t]+)\s*[?!.]?$/iu.exec(text);
 if(stats&&/\d/u.test(stats[1]))return {mode:'stats',details:stats[1].trim().replace(/\.$/u,'')};
 if(/^(?:проанализируй|разбери|посчитай статистику по)\s+(?:(?:этот|прикрепл[её]нный)\s+)?(?:csv(?:[- ]файл)?|файл csv)\s*[.!?]?$/iu.test(text))return {mode:'csv',details:''};
 if(/^(?:сравни|сопоставь)\s+(?:(?:эти|прикрепл[её]нные|два|текстовые)\s+)*(?:файлы|файла|версии)(?:\s+построчно)?\s*[.!?]?$/iu.test(text))return {mode:'diff',details:''};
 return null;
}
