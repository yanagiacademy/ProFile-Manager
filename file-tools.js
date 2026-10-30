/* Strumenti condivisi per i file: anteprima online, salvataggio e download multiplo in ZIP.
   Usato da Documenti, File importanti e Mail. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MIMES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml',
  mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',
  txt:'text/plain',csv:'text/plain',md:'text/plain',json:'text/plain',xml:'text/plain',log:'text/plain'};
export function guessMime(name,mime){
  if(mime&&mime!=='application/octet-stream')return mime;
  const e=String(name||'').split('.').pop().toLowerCase();return MIMES[e]||mime||'application/octet-stream'}
export function saveBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),60000)}

let zp=null;
function loadZip(){return zp||(zp=new Promise((res,rej)=>{
  if(window.JSZip)return res(window.JSZip);
  const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload=()=>res(window.JSZip);s.onerror=()=>{zp=null;rej(new Error('Impossibile caricare lo strumento ZIP'))};document.head.append(s)}))}
/* entries: [{path, load:()=>Promise<Blob>}] — restituisce quanti file non è stato possibile includere */
export async function saveZip(entries,name,say=()=>{}){
  const J=await loadZip(),z=new J(),used=new Set();let n=0,bad=0;
  for(const e of entries){
    let p=e.path,k=1;
    while(used.has(p)){const d=e.path.lastIndexOf('.');p=d>0?e.path.slice(0,d)+' ('+(++k)+')'+e.path.slice(d):e.path+' ('+(++k)+')'}
    used.add(p);say(`Preparazione ${++n}/${entries.length}: ${e.path}`);
    try{z.file(p,await e.load())}catch(x){bad++;console.error(x)}}
  if(bad===entries.length)throw new Error('Nessun file scaricabile');
  say('Creazione dello ZIP…');saveBlob(await z.generateAsync({type:'blob'}),name);return bad}

let cssDone=false;
function css(){if(cssDone)return;cssDone=true;const s=document.createElement('style');s.textContent=`
.pv-ov{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) 10px max(10px,env(safe-area-inset-bottom))}
.pv{width:100%;max-width:960px;height:100%;max-height:92vh;display:flex;flex-direction:column;padding:12px}
.pv-h{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap}
.pv-h b{overflow-wrap:anywhere;min-width:0;flex:1 1 160px}
.pv-h span{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pv-b{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center}
.pv-b img,.pv-b video{max-width:100%;max-height:100%}
.pv-b audio{width:100%}
.pv-b iframe{width:100%;height:100%;border:0;background:#fff;border-radius:6px}
.pv-b pre{white-space:pre-wrap;overflow-wrap:anywhere;align-self:flex-start;width:100%;margin:0;font:inherit}
.pv-b p{text-align:center}
.sk{width:20px;height:20px;margin:0 6px;flex:none}
`;document.head.append(s)}

/* Apre il file online. load(say) deve restituire un Blob; extra: [{label, fn(button)}] pulsanti aggiuntivi */
export function showPreview({title,mime,load,extra=[],errText,fileName}){
  css();
  const o=document.createElement('div');o.className='pv-ov';
  o.innerHTML=`<div class="pv card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pv-h"><b>${esc(title)}</b><span></span></div><div class="pv-b"><p class="mu">Preparazione del file…</p></div></div>`;
  const body=o.querySelector('.pv-b'),bar=o.querySelector('.pv-h span');
  let url='',blob=null;
  const onk=e=>{if(e.key==='Escape')close()};
  function close(){if(url)URL.revokeObjectURL(url);o.remove();document.removeEventListener('keydown',onk)}
  document.addEventListener('keydown',onk);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  const mk=(label,cls,fn)=>{const b=document.createElement('button');b.className='btn sm '+cls;b.textContent=label;b.onclick=()=>fn(b);bar.append(b);return b};
  extra.forEach(x=>mk(typeof x.label==='function'?x.label():x.label,'ghost',x.fn));
  const dl=mk('Scarica','',()=>{if(blob)saveBlob(blob,fileName||title)});dl.disabled=true;
  mk('Chiudi','ghost',close);
  document.body.append(o);
  const say=t=>{body.innerHTML='<p class="mu"></p>';body.firstChild.textContent=t};
  (async()=>{
    try{
      const raw=await load(say),type=guessMime(title,mime||raw.type);
      blob=new Blob([raw],{type});url=URL.createObjectURL(blob);dl.disabled=false;body.innerHTML='';
      if(type.startsWith('image/')){const i=document.createElement('img');i.src=url;i.alt=title;body.append(i)}
      else if(type==='application/pdf'){
        const f=document.createElement('iframe');f.src=url;f.title=title;body.append(f);
        const a=document.createElement('a');a.className='btn ghost sm';a.href=url;a.target='_blank';a.rel='noopener';a.textContent='Apri in una scheda';bar.insertBefore(a,dl)}
      else if(type.startsWith('video/')){const v=document.createElement('video');v.src=url;v.controls=true;v.playsInline=true;body.append(v)}
      else if(type.startsWith('audio/')){const a=document.createElement('audio');a.src=url;a.controls=true;body.append(a)}
      else if(type.startsWith('text/')){const t=await blob.text(),pre=document.createElement('pre');pre.textContent=t.length>300000?t.slice(0,300000)+'\n\n[…anteprima troncata: scarica il file per leggerlo tutto]':t;body.append(pre)}
      else{const p=document.createElement('p');p.className='mu';p.textContent='Anteprima non disponibile per questo tipo di file. Usa “Scarica” per aprirlo con la sua app.';body.append(p)}
    }catch(e){console.error(e);const p=document.createElement('p');p.className='err';p.setAttribute('role','alert');p.textContent=errText?errText(e):'Impossibile aprire il file.';body.innerHTML='';body.append(p)}
  })();
  return {close};
}

/* ---------- Miniature (JPEG piccolo salvato nel documento, campo "thumb") ---------- */
const THUMB_MAX=200;
export const okThumb=u=>typeof u==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(u);
export const canThumb=(name,mime)=>{const t=guessMime(name,mime);return t.startsWith('image/')||t.startsWith('video/')||t==='application/pdf'};
const tmo=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
function toJpeg(src,w,h){
  if(!w||!h)return null;
  const k=Math.min(1,THUMB_MAX/Math.max(w,h)),cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(h*k));
  const c=document.createElement('canvas');c.width=cw;c.height=ch;
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cw,ch);x.drawImage(src,0,0,cw,ch);
  let q=.7,u=c.toDataURL('image/jpeg',q);
  while(u.length>40000&&q>.3){q-=.15;u=c.toDataURL('image/jpeg',q)}
  return u.length>60000?null:u}
const loadImg=url=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('img'));i.src=url});
function videoFrame(url){return new Promise((res,rej)=>{
  const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=url;
  v.onerror=()=>rej(new Error('video'));
  v.onloadedmetadata=()=>{v.currentTime=Math.min(1,(v.duration||2)/10)};
  v.onseeked=()=>{try{res(toJpeg(v,v.videoWidth,v.videoHeight))}catch(e){rej(e)}}})}
let pz=null;
function loadPdfJs(){return pz||(pz=new Promise((res,rej)=>{
  if(window.pdfjsLib)return res(window.pdfjsLib);
  const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';res(window.pdfjsLib)};
  s.onerror=()=>{pz=null;rej(new Error('pdfjs'))};document.head.append(s)}))}
async function pdfThumb(blob){
  const L=await loadPdfJs(),doc=await L.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
  try{const pg=await doc.getPage(1),v0=pg.getViewport({scale:1}),vp=pg.getViewport({scale:THUMB_MAX*1.5/Math.max(v0.width,v0.height)});
    const c=document.createElement('canvas');c.width=Math.round(vp.width);c.height=Math.round(vp.height);
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
    await pg.render({canvasContext:x,viewport:vp}).promise;return toJpeg(c,c.width,c.height)}
  finally{doc.destroy()}}
/* Restituisce un data URL JPEG oppure null se non è possibile (tipo non supportato, file troppo grande, errore) */
export async function makeThumb(blob,name,mime){
  const t=guessMime(name,mime||blob.type);
  try{
    if(t==='application/pdf'){if(blob.size>60*1024*1024)return null;return await tmo(pdfThumb(blob),30000)}
    if(!t.startsWith('image/')&&!t.startsWith('video/'))return null;
    const url=URL.createObjectURL(new Blob([blob],{type:t}));
    try{
      if(t.startsWith('image/')){const i=await tmo(loadImg(url),20000);return toJpeg(i,i.naturalWidth,i.naturalHeight)}
      return await tmo(videoFrame(url),20000)
    }finally{URL.revokeObjectURL(url)}
  }catch(e){console.warn('miniatura non creata',e);return null}}

/* Osserva gli elementi con data-thid e chiama process(id) solo per quelli rimasti visibili a schermo per "dwell" ms.
   Ogni id viene elaborato una sola volta per sessione; l'elaborazione è sequenziale. */
export function thumbWatcher(process,{dwell=2000}={}){
  const seen=new Map(),tried=new Set(),q=[];let io=null,busy=false;
  async function run(){
    if(busy)return;busy=true;
    while(q.length){const id=q.shift();try{await process(id)}catch(e){console.error(e)}}
    busy=false}
  function enqueue(id){if(tried.has(id))return;tried.add(id);q.push(id);run()}
  return {watch(root){
    if(io)io.disconnect();
    if(!('IntersectionObserver' in window))return;
    const els=[...root.querySelectorAll('[data-thid]')],ids=new Set(els.map(e=>e.dataset.thid));
    for(const k of [...seen.keys()])if(!ids.has(k)){clearTimeout(seen.get(k));seen.delete(k)}
    io=new IntersectionObserver(es=>es.forEach(e=>{
      const id=e.target.dataset.thid;
      if(e.isIntersecting){if(!seen.has(id))seen.set(id,setTimeout(()=>{seen.delete(id);enqueue(id)},dwell))}
      else if(seen.has(id)){clearTimeout(seen.get(id));seen.delete(id)}
    }),{threshold:0.6});
    els.forEach(el=>io.observe(el))}}}
