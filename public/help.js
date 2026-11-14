const search=document.querySelector('#help-search');
const sections=[...document.querySelectorAll('#help-items section')];
const count=document.querySelector('#help-count');

search.addEventListener('input',()=>{
 const tokens=search.value.toLocaleLowerCase('ru').trim().split(/\s+/u).filter(Boolean);
 let matches=0;
 for(const section of sections){
  const content=section.textContent.toLocaleLowerCase('ru');
  section.hidden=!tokens.every(token=>content.includes(token));
  if(!section.hidden)matches++;
 }
 count.textContent=tokens.length?`Найдено разделов: ${matches}.`:'';
});
