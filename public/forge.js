const requestText=value=>String(value||'').trim();

export function forgeIntent(content,{previewKind=null,taskMode=null,codeFollowUp=false}={}){
 const text=requestText(content);
 if(previewKind)return {kind:previewKind,goal:text};
 if(taskMode==='code'||codeFollowUp)return {kind:'code',goal:text};
 if(/(?:^|[.!?]\s+)(?:доведи|собери|реализуй|сделай|создай|разработай|почини|исправь|доработай)\s+(?:мне\s+)?(?:готов(?:ый|ую|ое)|рабоч(?:ий|ую|ее)|полноценн(?:ый|ую|ое))?\s*(?:проект|программ\p{L}*|скрипт|бот\p{L}*|сервис|api)(?=[\s:,.!?]|$)/iu.test(text))return {kind:'code',goal:text};
 if(/(?:доведи до результата|собери готовый проект|режим forge|focus forge|guzan forge)/iu.test(text))return {kind:'project',goal:text};
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
 }else checks.push(check('files','Файлы проекта',files.length?'pass':'warn',files.length?`Подготовлено файлов: ${files.length}.`:'Именованные файлы в ответе не найдены.'));
 if(checkpoint)checks.push(check('checkpoint','Контрольная точка','pass',`Сохранено файлов: ${checkpoint.count}.`));
 const failed=checks.some(item=>item.status==='fail');
 return {version:1,kind,status:failed?'needs_work':'ready',checks,files:files.map(file=>file.name),checkpoint,limitation:'Код проверен структурно. Команды сборки и тесты на сервере не запускались.'};
}
