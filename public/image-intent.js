// Shared routing keeps browser progress and server execution in agreement.
export function imageIntent(content,hasImage=false){
 const text=String(content||'').trim();
 const design=/^\/design(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(design)return {mode:'create',preset:'design',prompt:design[1].trim()};
 const command=/^\/image(?=\s|$)\s*([\s\S]*)$/iu.exec(text);
 if(command)return {mode:'create',prompt:command[1].trim()};
 const t=text.toLowerCase().replace(/ё/g,'е').replace(/^(?:бро[,! ]*|пожалуйста[, ]*|можешь\s+|можно\s+|давай\s+|теперь\s+|а\s+)+/u,'');
 // Requests for advice, text, or prompts must remain ordinary conversation.
 if(/^(?:как |почему |объясни|расскажи|напиши|придумай промпт|не |don't |how |explain|write )/u.test(t)||/^(?:измени|сделай|добавь|убери|замени|перепиши).*?(?:ответ|абзац|код|текст ответа|список|таблиц)/u.test(t))return null;
 if(hasImage&&/^(?:сделай|make)\s/u.test(t)&&/(?:ярче|темнее|светлее|реалистичнее|лучше|краснее|brighter|darker|realistic)/u.test(t))return {mode:'edit',prompt:text};
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
