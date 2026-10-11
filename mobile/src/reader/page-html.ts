// Builds the HTML document loaded into each reflowable page WebView.
// Content is already sanitized at import time; additionally a nonce-based CSP blocks any script that is not ours,
// and the page cannot load remote resources (img-src data: only, no connect/frame).
import type { Settings } from '../settings/types';
import { FONT_STACKS, THEMES } from '../settings/themes';

export interface PageGeometry { width: number; height: number; padX: number; padY: number }

export function pageGeometry(pw: number, ph: number, s: Pick<Settings, 'margin' | 'fontSize'>): PageGeometry {
  const padX = Math.round(Math.max(12, (pw * s.margin) / 100));
  const padY = Math.round(Math.max(18, s.fontSize * 1.6));
  return { width: Math.max(100, Math.floor(pw)), height: Math.max(100, Math.floor(ph)), padX, padY };
}

export function readerCss(s: Settings, g: PageGeometry): string {
  const t = THEMES[s.theme];
  const page = s.customPageColor ?? t.page;
  const text = s.customTextColor ?? t.text;
  const colW = g.width - 2 * g.padX;
  return `
html,body{margin:0;padding:0;background:${page};overflow:hidden;width:${g.width}px;height:${g.height}px;-webkit-text-size-adjust:100%;}
#vp{position:absolute;left:0;top:0;width:${g.width}px;height:${g.height}px;overflow:hidden;}
#c{position:absolute;left:0;top:0;box-sizing:content-box;padding:${g.padY}px ${g.padX}px;height:${g.height - 2 * g.padY}px;width:${colW}px;
 column-width:${colW}px;column-gap:${2 * g.padX}px;column-fill:auto;will-change:transform;
 color:${text};font-family:${FONT_STACKS[s.fontFamily].css};font-size:${s.fontSize}px;line-height:${s.lineHeight};
 text-align:${s.align};hyphens:auto;-webkit-hyphens:auto;word-wrap:break-word;overflow-wrap:break-word;}
#c p{margin:0 0 ${s.paraSpacing}em 0;text-indent:1.4em;orphans:2;widows:2;}
#c h1,#c h2,#c h3,#c h4{text-indent:0;text-align:center;line-height:1.25;margin:1.2em 0 .8em;break-after:avoid;font-weight:600;}
#c h1{font-size:1.6em}#c h2{font-size:1.35em}#c h3{font-size:1.15em}#c h4{font-size:1em}
#c img{max-width:100%;max-height:${g.height - 2 * g.padY - 8}px;height:auto;display:block;margin:.6em auto;break-inside:avoid;object-fit:contain;}
#c blockquote{margin:.8em 1.2em;font-style:italic}
#c pre,#c code{font-family:${FONT_STACKS.mono.css};font-size:.85em;white-space:pre-wrap}
#c table{border-collapse:collapse;font-size:.9em;max-width:100%}#c td,#c th{border:1px solid ${t.muted};padding:2px 4px}
#c a{color:${t.accent};text-decoration:underline;}
#c hr{border:0;border-top:1px solid ${t.muted};margin:1em 3em}
#c .poem p{text-indent:0;margin-left:1.5em}
#c mark{color:inherit;border-radius:2px}
#c mark.yellow{background:rgba(250,215,60,.45)}#c mark.green{background:rgba(110,200,110,.4)}
#c mark.blue{background:rgba(90,160,240,.4)}#c mark.pink{background:rgba(240,120,170,.4)}
#c mark.note{border-bottom:2px dotted ${t.accent}}
#c mark.search{background:rgba(255,140,0,.55)}
::selection{background:${t.dark ? 'rgba(212,164,99,.45)' : 'rgba(138,75,32,.28)'}}
#end{display:inline-block;width:1px;height:1px}
`;
}

/** In-page bridge. Kept ES2017 and dependency-free. */
export const BRIDGE_JS = `(function(){
var RN=window.ReactNativeWebView;function post(m){m.sid=window.__SID;m.gen=window.__GEN;RN&&RN.postMessage(JSON.stringify(m));}
var c=document.getElementById('c'),G=window.__GEOM,cur=0,count=1,isBlank=false;
function measure(){var e=document.getElementById('end');var r=e.getBoundingClientRect();var tx=-cur*G.width;
 var left=r.left-tx; count=Math.max(1,Math.floor((left-G.padX)/G.width)+1); if(r.top<G.padY-1 && left<G.padX+1) count=1; return count;}
var EVEN=!!window.__EVEN;
function lastEven(){return (count-1)-((count-1)%2);}
function show(p){measure();if(p==='last')p=count-1;else if(p==='lastEven')p=lastEven();else if(p==='lastEven1')p=lastEven()+1;
 p=Math.max(0,p|0);if(EVEN)p=p-(p%2);var blank=p>=count;isBlank=blank;cur=blank?count-1:p;c.style.visibility=blank?'hidden':'visible';
 c.style.transform='translateX('+(-cur*G.width)+'px)';post({type:'shown',page:blank?p:cur,pageCount:count,blank:blank,key:window.__KEY});}
function textNodes(){var w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT,null),a=[],n;while((n=w.nextNode()))a.push(n);return a;}
function pageOfRect(r){var tx=-cur*G.width;return Math.max(0,Math.min(count-1,Math.floor((r.left-tx-G.padX+2)/G.width)));}
function offsetToPage(off){var ns=textNodes(),acc=0;for(var i=0;i<ns.length;i++){var L=ns[i].data.length;if(acc+L>off){var rg=document.createRange();var o=Math.max(0,off-acc);rg.setStart(ns[i],o);rg.setEnd(ns[i],Math.min(L,o+1));var rs=rg.getClientRects();if(rs.length)return pageOfRect(rs[0]);var pr=ns[i].parentElement.getBoundingClientRect();return pageOfRect(pr);}acc+=L;}return count-1;}
function offsetOf(node,off){var ns=textNodes(),acc=0;for(var i=0;i<ns.length;i++){if(ns[i]===node)return acc+off;acc+=ns[i].data.length;}return -1;}
function unwrap(sel){var ms=c.querySelectorAll(sel);for(var i=0;i<ms.length;i++){var m=ms[i],p=m.parentNode;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);p.normalize();}}
function wrapRange(start,end,cls,id){var ns=textNodes(),acc=0,todo=[];for(var i=0;i<ns.length;i++){var L=ns[i].data.length;var s=Math.max(start,acc),e=Math.min(end,acc+L);if(s<e)todo.push([ns[i],s-acc,e-acc]);acc+=L;if(acc>=end)break;}
 todo.forEach(function(t){var n=t[0];if(t[2]<n.data.length)n.splitText(t[2]);var mid=t[1]>0?n.splitText(t[1]):n;var m=document.createElement('mark');m.className=cls;if(id)m.setAttribute('data-h',id);mid.parentNode.insertBefore(m,mid);m.appendChild(mid);});}
function setHighlights(list){unwrap('mark[data-h]');(list||[]).forEach(function(h){wrapRange(h.start,h.end,h.color+(h.note?' note':''),h.id);});}
function setSearch(s){unwrap('mark.search');if(s)wrapRange(s.start,s.end,'search',null);}
// the text visible on the current page, for read-aloud: whole text nodes on this page, and the part of a
// node (a paragraph running over a page break) that is on it; blocks are separated by a line break
function charPage(n,o){var rg=document.createRange();rg.setStart(n,o);rg.setEnd(n,Math.min(n.data.length,o+1));var rs=rg.getClientRects();return rs.length?pageOfRect(rs[0]):-1;}
function pageText(){if(isBlank)return '';measure();var ns=textNodes(),out='',lastB=null,BL='p,h1,h2,h3,h4,h5,h6,li,blockquote,div,td,th,pre,dt,dd,figcaption';
 for(var i=0;i<ns.length;i++){var n=ns[i],L=n.data.length;if(!L)continue;var rg=document.createRange();rg.selectNodeContents(n);var rs=rg.getClientRects();if(!rs.length)continue;
  var a=pageOfRect(rs[0]),b=pageOfRect(rs[rs.length-1]);if(b<cur||a>cur)continue;var s=0,e=L,lo,hi,m;
  if(a<cur){lo=0;hi=L-1;while(lo<hi){m=(lo+hi)>>1;if(charPage(n,m)>=cur)hi=m;else lo=m+1;}s=lo;}
  if(b>cur){lo=s;hi=L;while(lo<hi){m=(lo+hi)>>1;if(charPage(n,m)>cur)hi=m;else lo=m+1;}e=lo;}
  var blk=n.parentElement&&n.parentElement.closest?n.parentElement.closest(BL):null;if(out&&blk!==lastB)out+='\\n';lastB=blk;out+=n.data.slice(s,e);}
 return out;}
window.RB={show:show,
 pageText:function(req){post({type:'pageText',req:req,text:pageText()});},
 relayout:function(){var f=count>1?cur/count:0;measure();show(Math.round(f*count));},
 gotoAnchor:function(id){var el=document.getElementById(id);if(!el){show(0);return;}measure();show(pageOfRect(el.getBoundingClientRect()));},
 gotoOffset:function(off){measure();show(offsetToPage(off));},
 gotoFraction:function(f){measure();show(Math.min(count-1,Math.floor(f*count+1e-6)));},
 setHighlights:function(l){setHighlights(l);measure();show(cur);},
 setSearch:function(s){setSearch(s);if(s){measure();show(offsetToPage(s.start));}},
 clearSelection:function(){var s=window.getSelection();s&&s.removeAllRanges();},
 firstOffset:function(){var ns=textNodes(),acc=0;for(var i=0;i<ns.length;i++){var rg=document.createRange();rg.selectNodeContents(ns[i]);var rs=rg.getClientRects();for(var k=0;k<rs.length;k++){if(pageOfRect(rs[k])===cur)return acc;}acc+=ns[i].data.length;}return 0;}};
// links + highlights taps
c.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a');if(a){ev.preventDefault();var ds=a.getAttribute('data-sec'),ex=a.getAttribute('data-ext');
 if(ex){post({type:'ext',url:ex});return;} if(ds!==null&&ds!==''){post({type:'link',section:parseInt(ds,10),anchor:a.getAttribute('data-anchor')||''});return;} return;}
 var m=ev.target.closest&&ev.target.closest('mark[data-h]');if(m){post({type:'hl',id:m.getAttribute('data-h')});}},true);
// selection
var selT=null;document.addEventListener('selectionchange',function(){clearTimeout(selT);selT=setTimeout(function(){var s=window.getSelection();
 if(!s||s.isCollapsed||!s.rangeCount){post({type:'selection',text:''});return;}var r=s.getRangeAt(0);var a=offsetOf(r.startContainer,r.startOffset),b=offsetOf(r.endContainer,r.endOffset);
 if(a<0||b<0){return;}var t=s.toString();if(t.trim())post({type:'selection',text:t.slice(0,2000),start:Math.min(a,b),end:Math.max(a,b)});},250);});
// gestures: taps and horizontal drags are forwarded to the native page-turn engine
var sx=0,sy=0,st=0,drag=false,lastX=0,lastT=0,vx=0,raf=0,moved=false;
document.addEventListener('touchstart',function(e){if(e.touches.length!==1)return;var t=e.touches[0];sx=lastX=t.clientX;sy=t.clientY;st=lastT=Date.now();drag=false;moved=false;vx=0;},{passive:true});
document.addEventListener('touchmove',function(e){if(e.touches.length!==1)return;var t=e.touches[0],dx=t.clientX-sx,dy=t.clientY-sy;
 if(Math.abs(dx)>6||Math.abs(dy)>6)moved=true; var s=window.getSelection();
 if(!drag&&Math.abs(dx)>14&&Math.abs(dx)>Math.abs(dy)*1.4&&(!s||s.isCollapsed)){drag=true;post({type:'dragStart',dx:dx});}
 if(drag){e.preventDefault();var now=Date.now();if(now>lastT){vx=(t.clientX-lastX)/(now-lastT);}lastX=t.clientX;lastT=now;
  if(!raf){raf=requestAnimationFrame(function(){raf=0;post({type:'drag',dx:lastX-sx});});}}},{passive:false});
document.addEventListener('touchend',function(e){var t=e.changedTouches[0];if(drag){drag=false;post({type:'dragEnd',dx:t.clientX-sx,vx:vx});return;}
 var s=window.getSelection();if(!moved&&Date.now()-st<350&&(!s||s.isCollapsed)){var tg=e.target;if(tg.closest&&(tg.closest('a')||tg.closest('mark[data-h]')))return;post({type:'tap',x:t.clientX/G.width,y:t.clientY/G.height});}},{passive:true});
document.addEventListener('touchcancel',function(){if(drag){drag=false;post({type:'dragEnd',dx:0,vx:0});}},{passive:true});
// two-finger pinch: reported once on release so RN can change the font size
var pd0=0,pr=1;function pdist(ts){var a=ts[0],b=ts[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}
document.addEventListener('touchstart',function(e){if(e.touches.length===2){pd0=pdist(e.touches);pr=1;if(drag){drag=false;post({type:'dragEnd',dx:0,vx:0});}moved=true;}},{passive:true});
document.addEventListener('touchmove',function(e){if(pd0&&e.touches.length===2){e.preventDefault();pr=pdist(e.touches)/pd0;}},{passive:false});
document.addEventListener('touchend',function(e){if(pd0&&e.touches.length<2){if(Math.abs(pr-1)>0.08)post({type:'pinch',scale:pr});pd0=0;pr=1;}},{passive:true});
function go(p){measure();
 if(p&&typeof p==='object'){if(p.anchor){window.RB.gotoAnchor(p.anchor);}else if(typeof p.offset==='number'){window.RB.gotoOffset(p.offset);}else if(typeof p.fraction==='number'){window.RB.gotoFraction(p.fraction);}else show(p.page===undefined?0:p.page);}else show(0);}
window.RB.go=go;
function ready(){setHighlights(window.__HL||[]);go(window.__START);post({type:'ready',pageCount:count,page:cur});}
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(ready,30);});}else setTimeout(ready,60);
var imgs=c.querySelectorAll('img'),pending=imgs.length;for(var i=0;i<imgs.length;i++){if(imgs[i].complete){pending--;continue;}imgs[i].addEventListener('load',function(){if(--pending===0)window.RB.relayout();});imgs[i].addEventListener('error',function(){if(--pending===0)window.RB.relayout();});}
})();`;

export type PageRef = number | 'last' | 'lastEven' | 'lastEven1';
export type StartPos = { page: PageRef } | { anchor: string } | { offset: number } | { fraction: number };

export interface BuildArgs {
  sectionHtml: string;
  settings: Settings;
  geom: PageGeometry;
  start: StartPos;
  highlights: { id: string; start: number; end: number; color: string; note?: string }[];
  sid: string;
  gen: number;
  nonce: string;
  lang?: string;
  /** left page of a two-page spread: always lands on even pages */
  even?: boolean;
  /** target key echoed back in 'shown' messages */
  key: string;
}

const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

export function buildPageHtml(a: BuildArgs): string {
  const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${a.nonce}'`;
  return `<!DOCTYPE html><html lang="${(a.lang ?? 'en').replace(/[^a-zA-Z-]/g, '') || 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=${a.geom.width},initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${readerCss(a.settings, a.geom)}</style></head><body><div id="vp"><div id="c">${a.sectionHtml}<span id="end"></span></div></div>
<script nonce="${a.nonce}">window.__SID=${jsonForScript(a.sid)};window.__GEN=${a.gen};window.__GEOM=${jsonForScript(a.geom)};window.__START=${jsonForScript(a.start)};window.__HL=${jsonForScript(a.highlights)};window.__EVEN=${a.even ? 'true' : 'false'};window.__KEY=${jsonForScript(a.key)};</script>
<script nonce="${a.nonce}">${BRIDGE_JS}</script></body></html>`;
}

/** Plain text of a section, matching the WebView's text-node concatenation closely enough for search offsets. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export interface SearchHit { section: number; start: number; end: number; snippet: string }

export function searchText(sections: string[], query: string, limit = 200): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  sections.forEach((text, si) => {
    const lc = text.toLowerCase();
    let i = lc.indexOf(q);
    while (i >= 0 && hits.length < limit) {
      const a = Math.max(0, i - 40), b = Math.min(text.length, i + q.length + 40);
      hits.push({ section: si, start: i, end: i + q.length, snippet: `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ')}${b < text.length ? '…' : ''}` });
      i = lc.indexOf(q, i + q.length);
    }
  });
  return hits;
}
