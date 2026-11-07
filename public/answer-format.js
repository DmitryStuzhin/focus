const escapes = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const escape = value => String(value).replace(/[&<>"']/g, character => escapes[character]);

export function inlineMarkdown(text) {
 const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gu;
 let html = '', end = 0;
 for(const match of text.matchAll(pattern)){
  html += escape(text.slice(end,match.index));
  const [token,code,bold,italic,label,url]=match;
  if(code)html += '<code>'+escape(code)+'</code>';
  else if(bold)html += '<strong>'+escape(bold)+'</strong>';
  else if(italic)html += '<em>'+escape(italic)+'</em>';
  else html += '<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>';
  end = match.index + token.length;
 }
 return html + escape(text.slice(end));
}

function tableCells(line){
 const cells=[''];
 let code=false;
 for(let index=0;index<line.length;index++){
  const char=line[index];
  if(char==='\\'&&line[index+1]==='|'){
   cells[cells.length-1]+='|';
   index++;
  }else if(char==='|'&&!code){
   cells.push('');
  }else{
   cells[cells.length-1]+=char;
   if(char==='`')code=!code;
  }
 }
 if(cells.length<2)return [];
 if(!cells[0].trim()&&line.trimStart().startsWith('|'))cells.shift();
 if(cells.length>1&&!cells.at(-1).trim()&&/[^\\]\|\s*$/u.test(line))cells.pop();
 return cells.map(cell=>cell.trim());
}

export function answerTable(lines,index){
 const headings=tableCells(lines[index]);
 const rule=lines[index+1];
 if(!headings.length||headings.length>20||!rule)return null;
 const delimiters=headings.length===1&&!rule.includes('|')?[rule.trim()]:tableCells(rule);
 if(delimiters.length!==headings.length||!delimiters.every(cell=>/^:?-{3,}:?$/u.test(cell)))return null;
 const alignment=delimiters.map(cell=>cell.endsWith(':')?(cell.startsWith(':')?'center':'right'):'left');
 const row=(cells,tag)=>'<tr>'+cells.map((cell,column)=>
  '<'+tag+(tag==='th'?' scope="col"':'')+' class="cell-'+alignment[column]+'">'+inlineMarkdown(cell)+'</'+tag+'>'
 ).join('')+'</tr>';
 let end=index+2, body='';
 while(end<lines.length){
  const cells=tableCells(lines[end]);
  if(cells.length!==headings.length)break;
  body+=row(cells,'td');
  end++;
 }
 return {html:'<div class="table-wrap"><table><thead>'+row(headings,'th')+'</thead><tbody>'+body+'</tbody></table></div>',end};
}

const chartNumber = new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:6});
const point = n => Number(n.toFixed(2));

const chartFields = new Set(['type','title','unit','labels','values']);

export function prefersJsonCode(request){
 return /^\s*\/json(?:\s|$)|(?:в\s+(?:(?:виде|формате)\s+)?|как\s+)`?json\b|(?:покажи|дай|верни|выведи|сгенерируй|напиши|отформатируй|проверь)\s+(?:сырой\s+|только\s+)?`?json\b/iu.test(request);
}

export function answerChart(source,{strictFields=false}={}){
 if(source.length>8000)return null;
 let chart;
 try{chart=JSON.parse(source);}catch{return null;}
 if(!chart||typeof chart!=='object'||Array.isArray(chart)||
  strictFields&&Object.keys(chart).some(key=>!chartFields.has(key))||
  !['line','bar'].includes(chart.type)||typeof chart.title!=='string'||!chart.title.trim()||chart.title.length>120||
  (chart.unit!==undefined&&(typeof chart.unit!=='string'||chart.unit.length>32))||
  !Array.isArray(chart.labels)||!Array.isArray(chart.values)||chart.labels.length<2||
  chart.labels.length>20||chart.labels.length!==chart.values.length||
  !chart.labels.every(label=>typeof label==='string'&&label.trim()&&label.length<=48)||
  !chart.values.every(value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12))return null;
 const {type,title,unit='',labels,values}=chart;
 const bar=type==='bar', left=93, right=612, top=16, bottom=195, width=right-left;
 const min=Math.min(...values), max=Math.max(...values);
 let low=bar?Math.min(0,min):min, high=bar?Math.max(0,max):max;
 if(low===high){const padding=Math.max(1,Math.abs(low)*.05);low-=padding;high+=padding;}
 if(high-low<1e-12){low-=1e-12;high+=1e-12;}
 const y=value=>point(bottom-(value-low)/(high-low)*(bottom-top));
 const x=index=>point(bar?left+width*(index+.5)/values.length:left+width*index/(values.length-1));
 const zero=y(0);
 const ticks=Array.from({length:5},(_,index)=>low+(high-low)*index/4);
 const grid=ticks.map(value=>'<line x1="'+left+'" x2="'+right+'" y1="'+y(value)+'" y2="'+y(value)+'"/>'+
  '<text text-anchor="end" x="'+(left-9)+'" y="'+(y(value)+4)+'">'+escape(chartNumber.format(value))+'</text>').join('');
 const marks=bar?values.map((value,index)=>{
  const size=point(Math.min(36,width/values.length*.65));
  return '<rect x="'+point(x(index)-size/2)+'" y="'+Math.min(y(value),zero)+'" width="'+size+
   '" height="'+point(Math.abs(y(value)-zero))+'" rx="2"><title>'+escape(labels[index]+': '+chartNumber.format(value))+'</title></rect>';
 }).join(''):'<polyline fill="none" points="'+values.map((value,index)=>x(index)+','+y(value)).join(' ')+'"/>'+
  values.map((value,index)=>'<circle cx="'+x(index)+'" cy="'+y(value)+'" r="3.7"><title>'+
   escape(labels[index]+': '+chartNumber.format(value))+'</title></circle>').join('');
 const skip=Math.ceil(labels.length/5);
 const axis=labels.map((label,index)=>index%skip===0||index===labels.length-1?
  '<text x="'+x(index)+'" y="218" text-anchor="'+(bar?'middle':index===0?'start':index===labels.length-1?'end':'middle')+'">'+
  escape(label.length>14?label.slice(0,13)+'…':label)+'</text>':'').join('');
 const rows=labels.map((label,index)=>'<tr><th scope="row">'+escape(label)+'</th><td>'+
  escape(String(values[index]))+'</td></tr>').join('');
 return '<figure class="answer-chart"><figcaption><strong>'+escape(title)+'</strong>'+
  (unit?'<small>'+escape(unit)+'</small>':'')+'</figcaption>'+
  '<svg viewBox="0 0 630 232" role="img" aria-label="'+escape(title)+'">'+
  '<g class="chart-grid">'+grid+'</g><g class="chart-marks">'+marks+'</g><g class="chart-axis">'+axis+'</g></svg>'+
  '<details><summary>Данные графика</summary><div class="table-wrap"><table><thead><tr><th scope="col">Метка</th><th scope="col">'+
  escape(unit||'Значение')+'</th></tr></thead><tbody>'+rows+'</tbody></table></div></details></figure>';
}
