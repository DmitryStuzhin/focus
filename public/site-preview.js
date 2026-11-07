const buildVerb=/^(?:\/code\s+)?(?:напиши|написать|сделай|сделать|создай|создать|сверстай|сверстать|разработай|разработать|собери|собрать|запрограммируй|build|make|create|write)\s+/iu;
const buildTarget=/(?<![\p{L}\p{N}_])(?:сайт\p{L}*|лендинг\p{L}*|веб[- ]?страниц\p{L}*|html|website|landing page|web page|(?<game>игр[ауые]|игрушк[ауие]|мини[- ]?игр[ауые]|(?:mobile |browser )?game)|(?<app>(?:веб[- ]?)?приложени[еяю]|(?:web |mobile )?app(?:lication)?|калькулятор|трекер|дашборд|таймер|тренаж[её]р|to-do list))(?=[^\p{L}\p{N}_]|$)/iu;
const secondaryArtifact=/(?<!\p{L})(?:картин\p{L}*|фотограф\p{L}*|изображен\p{L}*|постер\p{L}*|обложк\p{L}*|логотип\p{L}*|план\p{L}*|описани\p{L}*|промпт\p{L}*|текст\p{L}*|инструкци\p{L}*|скриншот\p{L}*|image|poster|logo|plan|guide)(?!\p{L})/iu;

export function buildIntent(content){
 const text=String(content||'').trim();
 if(/^\/site(?=\s|$)/iu.test(text))return 'site';
 const action=buildVerb.exec(text);
 if(!action)return null;
 const brief=text.slice(action[0].length);
 const match=buildTarget.exec(brief.slice(0,150));
 if(!match||secondaryArtifact.test(brief.slice(0,match.index)))return null;
 return match.groups.game?'game':match.groups.app?'app':'site';
}

export function nativeBuildIntent(content){
 const kind=buildIntent(content);
 return (kind==='app'||kind==='game')&&
  /(?<![\p{L}\p{N}])(?:apk|aab|ipa|swiftui|swift|kotlin|python|pygame|java|c\+\+|c#|rust|android studio|xcode|flutter|react native|unity|godot|unreal(?: engine)?|нативн\p{L}*)(?![\p{L}\p{N}])/iu.test(content);
}

export function updatesBuild(content){
 return /(?<!\p{L})(?:эту\s+(?:игру|версию|страницу)|это\s+приложение|этот\s+(?:сайт|лендинг)|текущ\p{L}*\s+(?:игру|приложение|версию|сайт|страницу)|сложнее|проще|быстрее|медленнее|ярче|темнее)(?!\p{L})/iu.test(content);
}

export function isSiteRevision(content){
 const text=String(content||'').trim();
 const target=/(?<![\p{L}\p{N}_])(?:сайт[ауыем]?|лендинг[аеу]?|страниц[уаые]|игр[ауые]|приложени[еяю]|в\s+предпросмотре|шапк[ауе]|футер[ае]?|website|landing page|web page|game|app|preview|html)(?![\p{L}\p{N}_])/iu;
 return target.test(text)&&/^(?:(?:теперь|а теперь|пожалуйста)\s*[, ]\s*)?(?:добавь|убери|удали|поменяй|замени|измени|сделай|переделай|перенеси|улучши|обнови|исправь|add|remove|change|update|fix)\s/iu.test(text);
}

export function isPreviewBlock(header,code){
 if(typeof code!=='string'||!code.trim()||code.length>110000)return false;
 const [language,filename]=header.trim().toLowerCase().split(/\s+/u);
 return ['html','htm'].includes(language)||/\.html?$/.test(filename||'')||/^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(code);
}
