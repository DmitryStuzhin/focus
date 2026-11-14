const entries=[
 ['calc','Рассчитать','(125 + 18) * 1,2'],
 ['stats','Посчитать статистику','12; 18; 21; 24'],
 ['convert','Перевести единицы','2,5 км в м'],
 ['csv','Проанализировать CSV',';'],
 ['csvdiff','Сверить таблицы по ключу','id'],
 ['diff','Сравнить текстовые файлы',''],
 ['json','Проверить JSON','{"сумма":1200}'],
 ['code','Подготовить код','напишите функцию для проверки даты'],
 ['terminal','Разобрать вывод терминала','объясните ошибку сборки'],
 ['plan','Составить план','подготовка квартального отчёта'],
 ['review','Проверить код','найдите ошибки в приложенном файле'],
 ['evidence','Найти подтверждение в файлах','укажите срок оплаты и источник'],
 ['site','Подготовить сайт','сайт для портфолио'],
 ['image','Создать изображение','иллюстрация для отчёта'],
 ['image-edit','Изменить изображение','сделайте фон светлее'],
 ['design','Создать постер','афиша выставки'],
];

export function matchingCommands(draft,recent=[]){
 const match=/^\/([a-z-]*)$/iu.exec(draft);
 if(!match)return [];
 const query=match[1].toLowerCase();
 return entries.filter(([id])=>id.startsWith(query))
  .sort(([a],[b])=>(recent.indexOf(a)+1||Infinity)-(recent.indexOf(b)+1||Infinity));
}

export function commandUsed(draft,recent=[]){
 const id=/^\/([a-z-]+)(?=\s|$)/iu.exec(draft)?.[1].toLowerCase();
 if(!entries.some(([key])=>id===key))return recent;
 return [id,...recent.filter(key=>key!==id)].slice(0,8);
}
