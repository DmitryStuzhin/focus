// Shared routing keeps browser progress and server execution in agreement.
export function imageIntent(content,hasImage=false){
 const text=String(content||'').trim();
 const design=/^\/design(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(design)return {mode:'create',preset:'design',prompt:design[1].trim()};
 const command=/^\/image(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:'create',prompt:command[1].trim()};
 const editCommand=/^\/image-edit(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(editCommand)return {mode:'edit',prompt:editCommand[1].trim()};
 const t=text.toLowerCase().replace(/ё/g,'е').replace(/^(?:бро[,! ]*|пожалуйста[, ]*|можешь\s+|можно\s+|давай\s+|теперь\s+|а\s+)+/u,'');
 // Data charts use the chat renderer, including colloquial "draw a chart".
 if(/^(?:нарисуй|нарисовать|изобрази|создай|создать|сделай|сгенерируй|draw|make|create)\s+(?:(?:мне|линейный|столбчатую|круговую)\s+)*(?:график|диаграмм[ауые]|chart|graph)(?![\p{L}\p{N}_])/iu.test(t))return null;
 // Requests for advice, text, or prompts must remain ordinary conversation.
 if(/^(?:как |почему |объясни|расскажи|напиши|придумай промпт|не |don't |how |explain|write )/u.test(t)||/^(?:измени|сделай|добавь|убери|замени|перепиши).*?(?:ответ|абзац|код|текст ответа|список|таблиц)/u.test(t))return null;
 // A previous picture must not hijack a subsequent programming task.
 if(/(?:^|\s)(?:код|функци[юяи]|скрипт|компонент|api|css|html|javascript|typescript|python|тесты|баг|ошибку)(?=[\s.,:!?]|$)/iu.test(t))return null;
 // Refinements refer to the existing picture, even when they name a poster.
 const newPicture=/(?:новую|новое|новый|другую|другое|другой|с нуля|new|another)\s/iu.test(t);
 const refinement=/(?:фон|освещени|цвет|контраст|резкост|детализац|композици|надпис|шрифт|ярче|темнее|светлее|реалистичнее|краснее|brighter|darker|realistic|background|lighting)/iu.test(t);
 if(hasImage&&!newPicture&&/^(?:сделай|make|перерисуй|переработай|адаптируй)\s/u.test(t)&&refinement)return {mode:'edit',prompt:text};
 if(hasImage&&!newPicture&&/^(?:сделай|адаптируй|обрежь|кадрируй|resize|crop)\s/u.test(t)&&/(?:9\s*:\s*16|16\s*:\s*9|1\s*:\s*1|вертикальн|горизонтальн|квадратн|сторис|shorts|reels)/iu.test(t))return {mode:'edit',prompt:text};
 const poster=/^(?:нарисуй|нарисовать|создай|создать|сделай|сделать|сгенерируй|сгенерировать|оформи|create|make|design|draw)\s+[^\n]{0,60}?(?:постер|афиш|обложк|poster\b|cover\b)/u;
 if(poster.test(t))return {mode:'create',preset:'design',prompt:text};
 const visual=/(?:картин|изображен|фото|иллюстрац|портрет|аватар|логотип|обложк|постер|рисунок|image|picture|photo|illustration|logo|poster)/u;
 if(/^(?:нарисуй|нарисовать|изобрази|изобразить)\s/u.test(t)||/^(?:создай|создать|сгенерируй|сгенерировать|сделай|сделать)\s/u.test(t)&&visual.test(t)||/^(?:draw|paint)\s/u.test(t)||/^(?:create|generate|make)\s/u.test(t)&&visual.test(t))return {mode:'create',prompt:text};
 const editing=/^(?:измени|поменяй|замени|добавь|убери|удали|перекрась|осветли|затемни|улучши|отредактируй|сделай|пусть|увеличь|уменьши|edit|change|replace|add|remove|make)\s/u.test(t);
 if(editing&&(hasImage||visual.test(t)))return {mode:'edit',prompt:text};
 return null;
}

export function latestImage(messages){
 const end=messages.findLastIndex(m=>m.role==='user');
 return messages.slice(0,end).findLast(m=>m.role==='assistant'&&m.imageFile)||null;
}

export function imageAspectRatio(content){
 const text=String(content||'').trim();
 const explicit=/\s+--ar\s+(\S+)\s*$/iu.exec(text);
 if(explicit)return {ratio:explicit[1],prompt:text.slice(0,explicit.index).trim()};
 const normalized=text.toLowerCase().replaceAll('ё','е');
 if(/(?:сделай|адаптируй|обрежь|кадрируй|make|crop)\s+(?:(?:его|ее|это|картинку|изображение|постер)\s+)?(?:вертикальн|portrait)/iu.test(normalized))return {ratio:'9:16',prompt:text};
 if(/(?:сделай|адаптируй|обрежь|кадрируй|make|crop)\s+(?:(?:его|ее|это|картинку|изображение|постер)\s+)?(?:горизонтальн|landscape)/iu.test(normalized))return {ratio:'16:9',prompt:text};
 if(/(?:сделай|адаптируй|обрежь|кадрируй|make|crop)\s+(?:(?:его|ее|это|картинку|изображение|постер)\s+)?(?:квадратн|square)/iu.test(normalized))return {ratio:'1:1',prompt:text};
 if(/(?:\b9\s*[:xх]\s*16\b|обои\s+(?:на|для)\s+телефон|экран\s+телефона|сторис|stories|reels|shorts|вертикальн\p{L}*\s+(?:изображен|картин|постер|обложк|формат))/iu.test(normalized))return {ratio:'9:16',prompt:text};
 if(/(?:\b16\s*[:xх]\s*9\b|широкоформатн\p{L}*|обои\s+(?:на|для)\s+(?:компьютер|рабочий стол)|баннер\s+(?:для\s+)?youtube|превью\s+(?:для\s+)?youtube|youtube\s+thumbnail|горизонтальн\p{L}*\s+(?:изображен|картин|постер|обложк|формат))/iu.test(normalized))return {ratio:'16:9',prompt:text};
 if(/(?:\b1\s*[:xх]\s*1\b|квадратн\p{L}*\s+(?:изображен|картин|постер|обложк|формат)|аватар(?:к[ауи])?(?!\p{L})|иконк[ауи](?!\p{L}))/iu.test(normalized))return {ratio:'1:1',prompt:text};
 return {ratio:null,prompt:text};
}

// Workers AI reference inputs must fit within 512 px; retain original output size.
export async function imageReference(blob){
 const bitmap=await createImageBitmap(blob);
 try{
  const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.floor(bitmap.width*scale));
  canvas.height=Math.max(1,Math.floor(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  return {mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1],width:bitmap.width,height:bitmap.height};
 }finally{bitmap.close()}
}



