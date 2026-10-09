// HTML for the hidden PDF renderer WebView (pdf.js, bundled - nothing is fetched from the network).
// RN sends the PDF as base64 chunks via postMessage, then requests pages; the page renders to a canvas and
// returns a JPEG data URL, which RN caches as a file and displays with <Image>.
import { PDFJS_SRC, PDFJS_WORKER_SRC } from '../vendor/pdfjs.generated';

const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');

export function buildPdfRendererHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#fff}</style></head><body>
<script>${safe(PDFJS_SRC)}</script>
<script id="wsrc" type="text/plain">${safe(PDFJS_WORKER_SRC)}</script>
<script>(function(){
var RN=window.ReactNativeWebView;function post(m){RN.postMessage(JSON.stringify(m));}
var lib=window.pdfjsLib; var chunks=[]; var doc=null;
try{var wtxt=document.getElementById('wsrc').textContent;
 lib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([wtxt],{type:'application/javascript'}));}catch(e){post({type:'log',msg:'worker blob failed: '+e});}
function b64ToBytes(b){var s=atob(b),n=s.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=s.charCodeAt(i);return u;}
function open(){var total=0;var parts=chunks.map(b64ToBytes);parts.forEach(function(p){total+=p.length;});var all=new Uint8Array(total),o=0;parts.forEach(function(p){all.set(p,o);o+=p.length;});chunks=[];
 lib.getDocument({data:all,isEvalSupported:false,disableFontFace:false}).promise.then(function(d){doc=d;return d.getPage(1).then(function(p){var v=p.getViewport({scale:1});
  return d.getOutline().catch(function(){return null;}).then(function(outline){
   function flat(items){return Promise.all((items||[]).map(function(it){var dest=it.dest;var pr=typeof dest==='string'?d.getDestination(dest):Promise.resolve(dest);
    return pr.then(function(ex){if(!ex)return null;return d.getPageIndex(ex[0]).then(function(ix){return flat(it.items).then(function(ch){return {title:it.title,page:ix,children:ch.filter(Boolean)};});});}).catch(function(){return null;});})).then(function(a){return a.filter(Boolean);});}
   return flat(outline).then(function(toc){post({type:'opened',pageCount:d.numPages,aspect:v.width/v.height,toc:toc});});});});})
 .catch(function(e){var msg=String(e&&e.message||e);post({type:'error',name:e&&e.name,msg:msg});});}
var queue=Promise.resolve();
function render(page,width,quality){queue=queue.then(function(){if(!doc)return;return doc.getPage(page+1).then(function(p){var v1=p.getViewport({scale:1});var scale=Math.min(4,width/v1.width);var v=p.getViewport({scale:scale});
 var cv=document.createElement('canvas');cv.width=Math.floor(v.width);cv.height=Math.floor(v.height);var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
 return p.render({canvasContext:ctx,viewport:v}).promise.then(function(){var url=cv.toDataURL('image/jpeg',quality||0.85);cv.width=cv.height=0;p.cleanup();post({type:'page',page:page,width:width,data:url});});})
 .catch(function(e){post({type:'pageError',page:page,msg:String(e&&e.message||e)});});});}
function text(page){queue=queue.then(function(){if(!doc)return;return doc.getPage(page+1).then(function(p){return p.getTextContent().then(function(tc){post({type:'text',page:page,text:tc.items.map(function(i){return i.str;}).join(' ')});});}).catch(function(){post({type:'text',page:page,text:''});});});}
function onMsg(ev){var m;try{m=JSON.parse(ev.data);}catch(e){return;}
 if(m.type==='chunk')chunks.push(m.data);else if(m.type==='open')open();else if(m.type==='render')render(m.page,m.width,m.quality);else if(m.type==='text')text(m.page);}
document.addEventListener('message',onMsg);window.addEventListener('message',onMsg);
post({type:'boot',ok:!!lib});
})();</script></body></html>`;
}
