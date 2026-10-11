// Browser-side code (runs inside the pdf.js WebView) that rebuilds readable HTML from a page's positioned
// text runs: lines -> paragraphs / headings, drop caps, ligatures, hyphenation, running headers.
// Kept as a string because it is injected into the WebView; __tests__/pdf-text.test.ts evaluates it directly.
// Backslashes are doubled because this is a template literal.
export const PDF_TEXT_JS = `function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function median(a){if(!a.length)return 0;var b=a.slice().sort(function(x,y){return x-y;});return b[Math.floor(b.length/2)];}
// rebuild readable HTML (paragraphs + headings) from positioned text runs
function toHtml(items){var lines=[],ln=null;
 items.forEach(function(it){if(!it.str&&!it.hasEOL)return;
  // NFKC turns ligature glyphs (fi, fl, ff) and compatibility forms into plain letters; drop soft hyphens / zero-width marks
  var str=(it.str||'').normalize('NFKC').replace(/[\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]/g,'');
  var x=it.transform[4],y=it.transform[5],h=Math.abs(it.height||it.transform[3])||10;
  if(!ln||Math.abs(y-ln.y)>Math.min(h,ln.h)*0.5){ln={y:y,x:x,h:h,text:'',end:x,lastH:h,sizes:{}};lines.push(ln);}
  // a gap means a space - except right after a drop cap (a much larger first letter)
  else if(str&&x-ln.end>Math.min(h,ln.lastH)*0.15&&!/\\s$/.test(ln.text)&&!/^\\s/.test(str)&&!(ln.lastH>h*1.4&&/^\\S$/.test(ln.text.trim())))ln.text+=' ';
  ln.text+=str;ln.end=x+(it.width||0);ln.lastH=h;
  var k=Math.round(h*10)/10;ln.sizes[k]=(ln.sizes[k]||0)+str.replace(/\\s/g,'').length;});
 // a line's size is the size most of its letters use, so one big drop cap does not turn a line into a heading
 lines.forEach(function(l){var best=0,bh=l.h;for(var k in l.sizes){if(l.sizes[k]>best){best=l.sizes[k];bh=+k;}}l.h=bh;});
 lines=lines.filter(function(l){return l.text.trim();});
 // a drop cap on its own line (spanning several lines) joins the start of the next line
 for(var di=0;di<lines.length-1;di++){if(/^\\s*[A-Z\\u201C"]\\s*$/.test(lines[di].text)&&lines[di].h>median(lines.map(function(l){return l.h;}))*1.5){var nx=lines[di+1];nx.text=lines[di].text.trim()+nx.text.replace(/^\\s+/,'');nx.x=Math.min(nx.x,lines[di].x);lines.splice(di,1);di--;}}
 if(!lines.length)return '';
 if(/^\\s*[\\divxlc]+\\s*$/i.test(lines[0].text))lines.shift();
 if(lines.length&&/^\\s*[\\divxlc]+\\s*$/i.test(lines[lines.length-1].text))lines.pop();
 if(!lines.length)return '';
 var body=median(lines.map(function(l){return l.h;})),gaps=[];
 for(var i=1;i<lines.length;i++){var g=lines[i-1].y-lines[i].y;if(g>0&&g<body*3&&Math.abs(lines[i].h-body)<body*0.2)gaps.push(g);}
 var gap=median(gaps)||body*1.3,left=median(lines.map(function(l){return l.x;}).sort(function(a,b){return a-b;}).slice(0,Math.max(1,Math.ceil(lines.length/3))));
 // running header / footer: a short, normal-size line sitting well apart above or below everything else
 [0,1].forEach(function(bottom){if(lines.length<3)return;var by=lines.slice().sort(function(p,q){return bottom?p.y-q.y:q.y-p.y;});
  var edge=by[0],next=by[1];if(Math.abs(edge.y-next.y)>gap*2.2&&edge.text.trim().length<60&&edge.h<=body*1.1)lines.splice(lines.indexOf(edge),1);});
 var ends=lines.map(function(l){return l.end;}).sort(function(a,b){return b-a;});
 var right=median(ends.slice(0,Math.max(1,Math.ceil(lines.length/3))));
 var out=[],para=null,prev=null;
 function flush(){if(para){var t=para.text.trim();if(t)out.push(para.head?'<h2>'+esc(t)+'</h2>':'<p>'+esc(t)+'</p>');}para=null;}
 lines.forEach(function(l){var head=l.h>body*1.25,t=l.text.replace(/\\s+/g,' ').trim();
  // new paragraph: heading change, extra vertical space, an indented first line, or the previous line stopped short
  var brk=!para||head!==para.head||(prev&&prev.y-l.y>gap*1.45)||(!head&&l.x>left+body*0.6)||(!head&&prev&&prev.end<right-body*2.5&&!/-\\s*$/.test(prev.text));
  if(brk){flush();para={head:head,text:''};}
  if(para.text&&/[A-Za-z]-$/.test(para.text)&&/^[a-z]/.test(t))para.text=para.text.slice(0,-1)+t;
  else para.text+=(para.text?' ':'')+t;
  prev=l;});
 flush();return out.join('');}
`;
