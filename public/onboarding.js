export const ages = {
 under18: 'До 18 лет',
 '18-24': '18–24 года',
 '25-34': '25–34 года',
 '35-44': '35–44 года',
 '45-54': '45–54 года',
 '55-64': '55–64 года',
 '65plus': '65 лет и старше',
};

export const roles = {
 student: 'Школьник или студент',
 employee: 'Работаю в компании',
 freelance: 'Фрилансер',
 business: 'Предприниматель',
 educator: 'Преподаватель',
 other: 'Другое',
};

export const goals = {
 study: 'Учёба',
 work: 'Работа',
 code: 'Программирование',
 creative: 'Творчество',
 personal: 'Личные задачи',
 other: 'Другое',
};

export function starterTemplate(role,selected=[]){
 if(selected.includes('code'))return 'code';
 if(selected.includes('work')||['employee','business','freelance'].includes(role))return 'tables';
 if(selected.includes('study')||['student','educator'].includes(role))return 'document';
 return null;
}
