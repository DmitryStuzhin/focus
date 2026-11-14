const requestText=value=>String(value||'').trim();

export function forgeIntent(content,{previewKind=null,taskMode=null,codeFollowUp=false}={}){
 const text=requestText(content);
 if(previewKind)return {kind:previewKind,goal:text};
 if(/(?:доведи до результата|собери готовый проект|режим forge|focus forge)/iu.test(text))return {kind:'project',goal:text};
 if(taskMode==='code'||codeFollowUp)return {kind:'code',goal:text};
 if(/(?:^|[.!?]\s+)(?:доведи|собери|реализуй|сделай|создай|разработай|почини|исправь|доработай)\s+(?:мне\s+)?(?:готов(?:ый|ую|ое)|рабоч(?:ий|ую|ее)|полноценн(?:ый|ую|ое))?\s*(?:проект|программ\p{L}*|скрипт|бот\p{L}*|сервис|api)(?=[\s:,.!?]|$)/iu.test(text))return {kind:'code',goal:text};
 return null;
}

export function namedCodeFiles(text){
 const files=[],fence=/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
 for(const match of requestText(text).matchAll(fence)){
  const parts=match[1].trim().split(/\s+/u),name=parts[1];
  if(parts.length!==2||!name||name.length>200||! /^[\p{L}\p{N}_.\/-]+$/u.test(name)||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..'))continue;
  files.push({name,content:match[2],language:parts[0].toLowerCase()});
 }
 return files;
}

const check=(id,label,status,detail)=>({id,label,status,detail});
export function forgeReport(text,{kind='project',truncated=false,previewReady=false,checkpoint=null}={}){
 const files=namedCodeFiles(text),html=files.find(file=>/\.html?$/iu.test(file.name)||file.language==='html');
 const checks=[check('complete','Ответ завершён',truncated?'fail':'pass',truncated?'Модель остановилась до завершения результата.':'Ответ получен полностью.')];
 if(['site','app','game'].includes(kind)){
  const document=html?.content||'';
  const structure=/<!doctype\s+html\b/iu.test(document)&&/<html(?:\s|>)/iu.test(document)&&/<\/html>/iu.test(document)&&/<body(?:\s|>)/iu.test(document)&&/<\/body>/iu.test(document);
  checks.push(check('structure','Структура приложения',structure?'pass':'fail',structure?'Найден полный HTML-документ.':'Полный HTML-документ не найден.'));
  checks.push(check('preview','Живой предпросмотр',previewReady?'pass':'fail',previewReady?'Артефакт можно открыть справа от чата.':'Предпросмотр не удалось подготовить.'));
  const external=/(?:src|href)\s*=\s*["']https?:\/\//iu.test(document);
  checks.push(check('offline','Самодостаточность',external?'warn':'pass',external?'Есть внешние ресурсы: результат зависит от сети.':'Внешние библиотеки и ресурсы не требуются.'));
  if(kind==='app'||kind==='game'){
   const interactive=/<script(?:\s|>)[\s\S]*?(?:addEventListener|onclick\s*=|onpointer|requestAnimationFrame)/iu.test(document);
   checks.push(check('interactive','Интерактивность',interactive?'pass':'warn',interactive?'Найдена логика взаимодействия.':'Автоматическая проверка не нашла обработчики взаимодействия.'));
  }
 }else checks.push(check('files','Файлы проекта',files.length?'pass':'fail',files.length?`Подготовлено файлов: ${files.length}.`:'Именованные файлы в ответе не найдены.'));
 const duplicates=files.filter((file,index)=>files.findIndex(other=>other.name===file.name)!==index);
 if(duplicates.length)checks.push(check('duplicates','Уникальность путей','fail',`Повторяются пути: ${[...new Set(duplicates.map(file=>file.name))].join(', ')}. Уточните итоговую версию файлов.`));
 const empty=files.filter(file=>!file.content.trim());
 if(empty.length)checks.push(check('empty','Содержимое файлов','fail',`Пустые файлы: ${empty.map(file=>file.name).join(', ')}.`));
 const invalidJSON=files.filter(file=>/\.json$/iu.test(file.name)&&file.content.trim()).filter(file=>{try{JSON.parse(file.content);return false;}catch{return true;}});
 if(invalidJSON.length)checks.push(check('json','Синтаксис JSON','fail',`Некорректный JSON: ${invalidJSON.map(file=>file.name).join(', ')}.`));
 const unfinished=files.filter(file=>/(?:TODO|FIXME|YOUR_API_KEY|вставьте (?:код|реализацию) здесь)/u.test(file.content));
 if(unfinished.length)checks.push(check('unfinished','Места для доработки','warn',`Проверьте заглушки или настройки: ${unfinished.map(file=>file.name).join(', ')}.`));
 if(checkpoint)checks.push(check('checkpoint','Контрольная точка','pass',`Сохранено файлов: ${checkpoint.count}.`));
 const failed=checks.some(item=>item.status==='fail');
 return {version:1,kind,status:failed?'needs_work':'ready',checks,files:files.map(file=>file.name),checkpoint,limitation:'Код проверен структурно. Команды сборки и тесты на сервере не запускались.'};
}
