export function siteIntent(content){
 const text=String(content||'').trim();
 if(/^\/site(?=\s|$)/iu.test(text))return true;
 const request=text.replace(/^(?:(?:можешь|пожалуйста|давай)\s*[, ]\s*)+/iu,'');
 const match=/^(?:\/code\s+)?(?:напиши|написать|сделай|сделать|создай|создать|сверстай|сверстать|разработай|собери|build|make|create|write)\s([^\n]{0,120}?)(?:сайт|лендинг|веб[- ]?страниц|веб[- ]?приложен|html\b|website\b|landing page\b|web page\b|web app\b)/iu.exec(request);
 return !!match&&!/(?:картин|фотограф|изображен|постер|обложк|логотип|план|описан|промпт|текст)/iu.test(match[1]);
}

export function isSiteRevision(content){
 return /^(?:(?:теперь|а теперь|пожалуйста)\s*[, ]\s*)?(?:добавь|убери|удали|поменяй|замени|измени|сделай|переделай|перенеси|улучши|обнови|исправь|add|remove|change|update|fix)\s/iu.test(String(content||'').trim());
}

export function isPreviewBlock(header,code){
 if(typeof code!=='string'||!code.trim()||code.length>110000)return false;
 const [language,filename]=header.trim().toLowerCase().split(/\s+/u);
 return ['html','htm'].includes(language)||/\.html?$/.test(filename||'')||/^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(code);
}
