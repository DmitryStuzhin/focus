function requestWords(content){
 return String(content||'').trim().replace(/^(?:(?:пожалуйста|давай|бро|можешь)(?:\s*[,!]\s*|\s+))+/iu,'');
}

export function taskIntent(content){
 const text=requestWords(content);
 // Terminal advice uses the coding pipeline and its larger response budget.
 if(/^\/terminal(?=\s|$)/iu.test(text))return {mode:'code',details:text.replace(/^\/terminal\s*/iu,'')};
 const terminalQuestion=/^(?:как|что|почему|помоги|объясни|разбери|проверь|исправь|почини|настрой|установи|запусти|покажи|дай|напиши|нужно|надо)/iu.test(text);
 if(terminalQuestion&&/(?:терминал|консол|командн\p{L}*\s+строк|powershell|\bbash\b|\bsystemctl\b|\bdocker\b|\bnpm\b|\bgit\b|депло|лог[иах]?\b)/iu.test(text))return {mode:'code',details:text};
 if(/(?:^|\n)(?:Traceback \(most recent call last\):|npm (?:ERR!|error)|fatal: |error: failed to|Job for [\w@.-]+\.service failed|[\w.-]+@[^\s:]+:[^\n]*[$#] )/u.test(text))return {mode:'code',details:text};
 const command=/^\/(code|plan|review|evidence)(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:command[1].toLowerCase(),details:command[2]};
 if(/^(?:(?:проверь|посмотри|разбери|проанализируй)\s+(?:(?:мой|этот|прикрепл[её]нный)\s+)?(?:код|исходник\p{L}*|правк\p{L}*|diff)(?=[\s:,.!?]|$)|(?:проведи|сделай)\s+(?:ревью|код[- ]ревью)|найди\s+ошибки\s+в\s+(?:коде|исходниках))/iu.test(text))return {mode:'review',details:text};
 if(/^(?:составь|сделай|подготовь|продумай|предложи)\s+(?:(?:пошаговый|подробный|рабочий)\s+)?план(?=[\s:,.!?]|$)/iu.test(text))return {mode:'plan',details:text};
 if(/^(?:сверь\s+(?:эти\s+|прикрепл[её]нные\s+)?(?:документы|отч[её]ты|договоры)|(?:проверь|сверь)\s+по\s+(?:(?:этому|прикрепл[её]нному)\s+)?(?:документу|договору|файлу|отч[её]ту|вложениям)|найди\s+подтверждение\s+в\s+(?:документах|вложениях|файлах)|(?:посмотри|уточни|проверь|что)\s+в\s+(?:(?:этом|прикрепл[её]нном)\s+)?(?:документе|договоре|отч[её]те|вложениях))(?=[\s:,.!?]|$)/iu.test(text))return {mode:'evidence',details:text};
 const codeAction=/^(?:напиши|создай|исправь|почини|отладь|измени|обнови|добавь|сгенерируй|перепиши|реализуй|отрефактори)\s+/iu;
 const codeTarget=/(?:^|\s)(?:код|скрипт|программ[ау]|функци[юию]|тест[ы]?|баг|ошибк[ауи]|исходник\p{L}*|прикрепл[её]нн\p{L}*\s+файл|python|javascript|typescript|rust|java|sql|golang|c\+\+|c#)(?=[\s:,.!?]|$)|(?:^|\s)[a-z0-9_.-]+\.(?:py|js|ts|rs|go|java|cpp|cs|sql|sh|rb|php|html|css)(?=[\s:,.!?]|$)/iu;
 if(codeAction.test(text)&&codeTarget.test(text))return {mode:'code',details:text};
 if(/^напиши\s+на\s+go(?=[\s:,.!?]|$)/iu.test(text))return {mode:'code',details:text};
 return null;
}

export function codeFollowUpIntent(content){
 const text=requestWords(content);
 if(/^(?:вот (?:ошибка|вывод|лог)|не работает|не запускается|та же ошибка|что дальше|что вводить|какую команду|command not found|permission denied)(?=[\s.,:!?]|$)/iu.test(text))return true;
 return text.length<=240&&/^(?:исправь|почини|отладь|доработай|продолжи|измени|обнови|добавь|убери|удали|перепиши|отрефактори|сделай)\s+(?:это|его|её|ее|код|файл|функци\p{L}*|так,?\s+чтобы(?!\p{L})|ещ[её](?!\p{L})|обработк\p{L}*|поддержк\p{L}*)/iu.test(text);
}


export function localIntent(content){
 const text=requestWords(content);
 const command=/^\/(calc|stats|convert|csv|diff|json|csvdiff)(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:command[1].toLowerCase(),details:command[2].trim()};
 const csvdiff=/^(?:сравни|сверь|сопоставь)\s+(?:(?:эти|прикрепл[её]нные|два)\s+)*(?:csv(?:[- ]файлы?)?|файла\s+csv)(?=[\s:.!?]|$)(?:\s+(?:по\s+(?:столбцу|колонке|ключу)|по)\s+([\s\S]+?))?\s*[.!?]?$/iu.exec(text);
 if(csvdiff)return {mode:'csvdiff',details:(csvdiff[1]||'id').trim()};
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



