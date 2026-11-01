import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {archivio,limiteMB} from "./archivio.js";
import {showPreview,saveBlob} from "./file-tools.js";
import {isD,fmtD,scadStato,tesseraAlert} from "./atleti-scadenze.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='tessere';
let auth,db,col,uid=null,me=null,items=[],atl=[],q='',flt='all',unsubs=[],started=false,shellFor='',memo=null,detail=null,arch=null;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const canNewAtl=()=>!!(me&&(me.admin||(me.perms||{}).atleti==='w'));
const p2=n=>String(n).padStart(2,'0');
const title=s=>String(s||'').toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase()).trim();
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

/* ---------- dati: lista atleti + tessera (un record per atleta, id = id dell'atleta) ---------- */
const tess=()=>items.filter(i=>i.kind==='tessera');
const fileOf=id=>id?items.find(i=>i.id===id&&i.kind==='file'):null;
function rows(){
  const m=Object.fromEntries(tess().map(t=>[t.atleta,t]));
  const r=atl.filter(a=>a.nome||a.cognome||a.title).map(a=>({id:a.id,nome:a.nome||'',cognome:a.cognome||(a.nome?'':a.title)||'',t:m[a.id]||null}));
  tess().forEach(t=>{if(!atl.some(a=>a.id===t.atleta))r.push({id:t.atleta,nome:t.nome||'',cognome:t.cognome||t.title||'',t})});
  return r}
const nameOf=r=>((r.cognome||'')+' '+(r.nome||'')).trim();
const alertRow=r=>tesseraAlert(r.t);
const minG=r=>Math.min(...[scadStato(r.t&&r.t.scadenza),scadStato(r.t&&r.t.certScad)].filter(Boolean).map(s=>s.g),1e9);
const stTxt=d=>{const s=scadStato(d);return !s?'—':s.late?'Scaduta':s.soon?'In scadenza ('+s.g+' g)':'Valida'};

function chip(label,d){
  const s=scadStato(d);
  if(!s)return `<span class="chip">${label}: —</span>`;
  if(s.late)return `<span class="chip bad">${label} scaduta da ${-s.g} g</span>`;
  if(s.soon)return `<span class="chip bad">${label} ${s.g===0?'scade oggi':'scade tra '+s.g+' g'}</span>`;
  return `<span class="chip ok">${label} fino al ${fmtD(d)}</span>`}

/* ---------- finestra di dialogo ---------- */
function modal(ttl,body,{ok='Salva',cancel='Annulla',onSave}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(ttl)}"><h2 style="margin:0 0 4px">${esc(ttl)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>${cancel}</button>${onSave?`<button class="btn" data-ok>${ok}</button>`:''}</div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  if(onSave)o.querySelector('[data-ok]').onclick=async()=>{
    const b=o.querySelector('[data-ok]');b.disabled=true;er.textContent='';
    try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Salvataggio non riuscito. Riprova.'}
    b.disabled=false};
  document.body.append(o);return o}

/* ---------- lettura automatica (OCR nel browser, gratuita: Tesseract.js, italiano) ---------- */
let tessP=null;
const loadTess=()=>tessP||(tessP=new Promise((res,rej)=>{
  const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  s.onload=()=>res(window.Tesseract);s.onerror=()=>{tessP=null;rej(new Error('LOAD'))};document.head.append(s)}));
async function prep(file){
  const bmp=await createImageBitmap(file),k=Math.min(1,2000/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');
  c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
  const x=c.getContext('2d');x.filter='grayscale(1) contrast(1.35)';x.drawImage(bmp,0,0,c.width,c.height);
  return await new Promise(r=>c.toBlob(r,'image/png'))}
async function ocr(file,say){
  const T=await loadTess();say('Preparazione dell’immagine…');
  const img=await prep(file);
  say('Lettura del testo (la prima volta scarica il dizionario italiano, può servire un minuto)…');
  const w=await T.createWorker('ita',1,{logger:m=>{if(m.status==='recognizing text')say('Lettura in corso '+Math.round(m.progress*100)+'%')}});
  try{return (await w.recognize(img)).data.text||''}finally{await w.terminate()}}

const ENTI=['FIJLKAM','UISP','CSEN','ENDAS','OPES','ACSI','AICS','LIBERTAS','CSI','ASI','CONI','FILPJ','MSP','USACLI','ACLI'];
function dateIso(d,m,y){d=+d;m=+m;y=+y;if(y<100)y+=2000;return (m<1||m>12||d<1||d>31||y<1950||y>2100)?'':y+'-'+p2(m)+'-'+p2(d)}
function dateList(t){
  const low=t.toLowerCase(),re=/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g,out=[];let m;
  while((m=re.exec(t))){
    const iso=dateIso(m[1],m[2],m[3]);if(!iso)continue;
    const from=Math.max(t.lastIndexOf('\n',m.index-1),m.index-45);
    out.push({iso,ctx:low.slice(from<0?0:from,m.index)})}
  return out}
/* scadenza: la data accanto a "scadenza/valido fino al"; se manca, la più recente tra quelle non di nascita (da verificare) */
function pickScad(ds){
  let d=ds.find(x=>/scad|valid|fino al|entro il/.test(x.ctx));
  if(d)return {v:d.iso,dedotta:false};
  const c=ds.filter(x=>!/nasc|nato/.test(x.ctx)&&!/emiss|rilasc|iscriz|affiliaz/.test(x.ctx)).map(x=>x.iso).sort();
  return c.length?{v:c[c.length-1],dedotta:true}:null}
function parseTessera(text){
  const t=text.replace(/\r/g,''),out={},ds=dateList(t);
  for(const e of ENTI)if(new RegExp('(^|[^A-Za-z])'+e+'([^A-Za-z]|$)','i').test(t)){out.ente=e;break}
  const nm=t.match(/(?:tessera|tess\.?|n[°º]|numero|n\.|codice|matricola)\s*[:\-]?\s*([A-Z]{0,5}[\s\-]?\d[\dA-Z\-\/]{3,14})/i);
  if(nm)out.numero=nm[1].replace(/\s+/g,'').toUpperCase();
  else{const c=t.match(/\b[A-Z]{0,4}\d{6,12}\b/g);if(c)out.numero=c.sort((a,b)=>b.length-a.length)[0]}
  const em=ds.find(x=>/emiss|rilasc|iscriz|affiliaz|data tessera/.test(x.ctx));if(em)out.emissione=em.iso;
  const sc=pickScad(ds);if(sc){out.scadenza=sc.v;if(sc.dedotta)out.dedotta=true}
  const nt=norm(t);let best=null;
  atl.forEach(a=>{const c=norm(a.cognome),n=norm(a.nome);if(c&&n&&nt.includes(c)&&nt.includes(n))best=a});
  if(best)out.atleta=best.id;
  else{
    const c=t.match(/cognome\s*[:\-]?\s*([^\n:]{2,30})/i),n=t.match(/\bnome\s*[:\-]?\s*([^\n:]{2,30})/i);
    if(c)out.cognomeRil=title(c[1]);if(n)out.nomeRil=title(n[1])}
  return out}
function parseCert(text){
  const t=text.replace(/\r/g,''),out={},sc=pickScad(dateList(t));
  if(sc){out.certScad=sc.v;if(sc.dedotta)out.dedotta=true}
  if(/non\s+agonistic/i.test(t))out.certTipo='non agonistico';else if(/agonistic/i.test(t))out.certTipo='agonistico';
  return out}

/* ---------- struttura della pagina ---------- */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca un atleta" aria-label="Cerca un atleta" value="${esc(q)}"><span class="who">${esc((me.name||me.email)||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Tessere</h2><div class="hbtn">${w?'<button class="btn sm" id="nuova">+ Nuova tessera</button>':''}<button class="btn ghost sm" id="csv">Scarica CSV</button><button class="btn ghost sm" id="pdf">Scarica PDF</button></div></div></div>
  <div class="card" id="ls" style="padding:8px 14px"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#csv').onclick=exportCsv;$('#pdf').onclick=exportPdf;
  if(w)$('#nuova').onclick=()=>openEdit({id:'',nome:'',cognome:'',t:null});
  $('#ls').onclick=e=>{const b=e.target.closest('[data-id]');if(b)openDetail(b.dataset.id)};}

function filtered(){
  const t=q.trim().toLowerCase(),all=rows();
  const ok={all:()=>true,alert:alertRow,senza:r=>!r.t||(!r.t.numero&&!r.t.scadenza),ok:r=>r.t&&(r.t.numero||r.t.scadenza)&&!alertRow(r)};
  const list=all.filter(r=>(!t||[nameOf(r),r.t&&r.t.numero,r.t&&r.t.ente].filter(Boolean).join(' ').toLowerCase().includes(t))&&(ok[flt]||ok.all)(r));
  list.sort((a,b)=>(alertRow(b)-alertRow(a))||(alertRow(a)&&alertRow(b)?minG(a)-minG(b):0)||nameOf(a).localeCompare(nameOf(b),'it'));
  return {all,list,ok}}

function renderList(){
  const ls=$('#ls');if(!ls)return;
  const {all,list,ok}=filtered();
  ls.innerHTML=`<div class="flt"><select id="fs" aria-label="Filtro elenco"><option value="all" ${flt==='all'?'selected':''}>Tutti (${all.length})</option><option value="alert" ${flt==='alert'?'selected':''}>In scadenza o scadute (${all.filter(ok.alert).length})</option><option value="senza" ${flt==='senza'?'selected':''}>Senza tessera (${all.filter(ok.senza).length})</option><option value="ok" ${flt==='ok'?'selected':''}>Regolari (${all.filter(ok.ok).length})</option></select></div>`+
  (list.length?list.map(r=>{
    const t=r.t,has=t&&(t.numero||t.scadenza);
    return `<button class="tr${alertRow(r)?' alarm':''}" data-id="${esc(r.id)}" aria-label="Apri la scheda di ${esc(nameOf(r))}"><div class="inf"><div><b>${esc(nameOf(r))}</b></div><div class="mu">${has?esc([t.ente,t.numero&&'n. '+t.numero].filter(Boolean).join(' · ')||'Tessera'):'Senza tessera'}</div></div><div class="chips">${has?chip('Tessera',t.scadenza)+chip('Certificato',t.certScad):'<span class="chip">Senza tessera</span>'}</div></button>`}).join(''):`<div class="mu" style="padding:8px 0">${all.length?'Nessun risultato.':'Nessun atleta: aggiungili dalla sezione Atleti.'}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
  paintDetail()}

/* ---------- scheda dell'atleta ---------- */
function openDetail(id){
  if(!rows().find(r=>r.id===id))return;
  const o=document.createElement('div');o.className='ov';
  o.innerHTML='<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda tessera"></div>';
  const close=()=>{o.remove();detail=null;document.removeEventListener('keydown',kd)};
  const kd=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',kd);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.firstElementChild.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b||!detail)return;
    const r=rows().find(x=>x.id===detail.id);if(!r)return;
    const a=b.dataset.a;
    try{
      if(a==='x')close();
      else if(a==='edit'&&perm()==='w'){openEdit(r)}
      else if(a==='dt'||a==='dc'){const f=fileOf(a==='dt'?r.t.tesFile:r.t.certFile);if(f)await download(f)}
      else if(a==='ot'||a==='oc'){const f=fileOf(a==='ot'?r.t.tesFile:r.t.certFile);if(f)showPreview({title:f.title,mime:f.mime,load:say=>arch.getBlob(f,say),errText:x=>'Impossibile aprire il file: '+arch.errText(x)})}
      else if(a==='del'&&perm()==='w'){
        if(!confirm('Eliminare la tessera e il certificato di '+nameOf(r)+' (con i file caricati)? L’atleta resta in elenco.'))return;
        for(const f of items.filter(x=>x.kind==='file'&&x.tesAtl===r.id)){try{await arch.remove(f)}catch(x){console.error(x)}}
        await deleteDoc(doc(db,'sections',SEC,'items',r.id));close()}
    }catch(x){console.error(x);alert('Operazione non riuscita. Controlla la connessione e i permessi.')}});
  detail={id,o};document.body.append(o);paintDetail();o.querySelector('[data-a="x"]').focus()}
async function download(f){
  try{const b=await arch.getBlob(f,()=>{});saveBlob(b,f.title)}catch(e){console.error(e);alert('Impossibile scaricare il file: '+arch.errText(e))}}

function paintDetail(){
  if(!detail||!document.body.contains(detail.o))return;
  const r=rows().find(x=>x.id===detail.id);
  if(!r){detail.o.remove();detail=null;return}
  const w=perm()==='w',t=r.t,c=detail.o.firstElementChild;
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v!==''&&v!=null?v:'<span class="mu">—</span>'}</dd>`;
  const ft=t&&fileOf(t.tesFile),fc=t&&fileOf(t.certFile);
  const fbox=(f,ko,kd)=>f?`<div class="fr"><span class="mu">${esc(f.title)}</span><button class="btn sm" data-a="${kd}">Scarica</button><button class="btn ghost sm" data-a="${ko}">Apri</button></div>`:'<div class="mu" style="margin-top:4px">Nessun file caricato.</div>';
  c.innerHTML=`<h2 style="margin:0">${esc(nameOf(r))}</h2>
    <div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px">${t?chip('Tessera',t.scadenza)+chip('Certificato',t.certScad):'<span class="chip">Senza tessera</span>'}</div>
    <h3>Tessera</h3><dl>${dd('Ente / federazione',esc(t&&t.ente||''))}${dd('Numero tessera (ID)',esc(t&&t.numero||''))}${dd('Data emissione',t&&isD(t.emissione)?esc(fmtD(t.emissione)):'')}${dd('Scadenza',t&&isD(t.scadenza)?esc(fmtD(t.scadenza)):'')}</dl>${fbox(ft,'ot','dt')}
    <h3>Certificato medico</h3><dl>${dd('Tipo',esc(t&&t.certTipo||''))}${dd('Scadenza',t&&isD(t.certScad)?esc(fmtD(t.certScad)):'')}</dl>${fbox(fc,'oc','dc')}
    ${t&&t.nota?`<h3>Note</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem">${esc(t.nota)}</div>`:''}
    <div class="dact">${w?`${t?'<button class="btn ghost" data-a="del">Elimina</button>':''}<button class="btn ghost" data-a="edit">${t?'Modifica / sostituisci':'Aggiungi tessera'}</button>`:''}<button class="btn" data-a="x">Chiudi</button></div>`}

/* ---------- inserimento e modifica (ogni campo è modificabile; i file si sostituiscono con quelli nuovi) ---------- */
function canUpload(){
  if(arch.needsTelegram()){
    if(confirm('I file vengono salvati su Telegram (con copia su Firebase): prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  return true}
function openEdit(r){
  const t=r.t||{},ftOld=fileOf(t.tesFile),fcOld=fileOf(t.certFile);
  const optA=atl.filter(a=>a.nome||a.cognome).sort((a,b)=>((a.cognome||'')+(a.nome||'')).localeCompare((b.cognome||'')+(b.nome||''),'it'));
  const body=`<fieldset><legend>Atleta</legend>
      ${r.id?`<div style="margin-top:8px"><b>${esc(nameOf(r))}</b></div>`:`<label for="ta">Atleta</label><select id="ta"><option value=""></option>${optA.map(a=>`<option value="${esc(a.id)}">${esc(((a.cognome||'')+' '+(a.nome||'')).trim())}</option>`).join('')}${canNewAtl()?'<option value="__new">+ Nuovo atleta…</option>':''}</select>
      <div id="nw" hidden class="two"><div><label for="nc">Cognome</label><input id="nc" type="text" autocomplete="off"></div><div><label for="nn">Nome</label><input id="nn" type="text" autocomplete="off"></div></div>`}
    </fieldset>
    <fieldset><legend>Tessera</legend>
      <label for="ft">Copia della tessera (foto o PDF)${ftOld?' — sostituisce quella attuale':''}</label><input id="ft" type="file" accept="image/*,application/pdf">
      <div class="ocr" id="ot">${ftOld?'Caricata: '+esc(ftOld.title)+'.':'Con una foto i dati si compilano da soli: poi controllali.'}</div>
      ${ftOld?'<label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="rt" style="width:auto;min-height:0"> Togli la tessera caricata</label>':''}
      <div class="two"><div><label for="en">Ente / federazione</label><input id="en" type="text" list="le" autocomplete="off" value="${esc(t.ente||'')}"><datalist id="le">${ENTI.map(e=>`<option value="${e}">`).join('')}</datalist></div><div><label for="nu">Numero tessera (ID)</label><input id="nu" type="text" autocomplete="off" value="${esc(t.numero||'')}"></div></div>
      <div class="two"><div><label for="em">Data emissione</label><input id="em" type="date" value="${esc(t.emissione||'')}"></div><div><label for="sc">Scadenza tessera</label><input id="sc" type="date" value="${esc(t.scadenza||'')}"></div></div>
    </fieldset>
    <fieldset><legend>Certificato medico</legend>
      <label for="fc">Copia del certificato (foto o PDF)${fcOld?' — sostituisce quello attuale':''}</label><input id="fc" type="file" accept="image/*,application/pdf">
      <div class="ocr" id="oc">${fcOld?'Caricato: '+esc(fcOld.title)+'.':''}</div>
      ${fcOld?'<label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="rc" style="width:auto;min-height:0"> Togli il certificato caricato</label>':''}
      <div class="two"><div><label for="ct">Tipo</label><select id="ct"><option value=""></option><option value="agonistico">Agonistico</option><option value="non agonistico">Non agonistico</option></select></div><div><label for="cd">Scadenza certificato</label><input id="cd" type="date" value="${esc(t.certScad||'')}"></div></div>
    </fieldset>
    <label for="nt">Note</label><textarea id="nt">${esc(t.nota||'')}</textarea>`;
  const o=modal(t.numero||t.scadenza?'Modifica tessera':'Nuova tessera',body,{onSave:async(o,er)=>{
    const g=id=>(o.querySelector('#'+id)||{value:''}).value.trim();
    let aid=r.id,nome=r.nome,cognome=r.cognome;
    if(!aid){
      const sel=g('ta');
      if(!sel){er.textContent='Scegli l’atleta.';return false}
      if(sel==='__new'){
        cognome=title(g('nc'));nome=title(g('nn'));
        if(!cognome||!nome){er.textContent='Inserisci cognome e nome del nuovo atleta.';return false}
      }else{const a=atl.find(x=>x.id===sel);aid=sel;nome=a.nome||'';cognome=a.cognome||a.title||''}}
    const v={ente:g('en'),numero:g('nu').toUpperCase(),emissione:g('em'),scadenza:g('sc'),certTipo:g('ct'),certScad:g('cd'),nota:g('nt')};
    for(const [k,l] of [['emissione','La data di emissione'],['scadenza','La scadenza della tessera'],['certScad','La scadenza del certificato']])if(v[k]&&!isD(v[k])){er.textContent=l+' non è valida.';return false}
    if(v.emissione&&v.scadenza&&v.emissione>v.scadenza){er.textContent='La scadenza della tessera è prima dell’emissione.';return false}
    const ft=o.querySelector('#ft').files[0],fc=o.querySelector('#fc').files[0];
    for(const f of [ft,fc])if(f&&f.size>arch.maxBytes()){er.textContent='“'+f.name+'” supera il limite di '+limiteMB()+' MB.';return false}
    if((ft||fc)&&!canUpload())return false;
    /* nuovo atleta creato al volo dalla tessera */
    if(!aid){
      const a=await addDoc(collection(db,'sections','atleti','items'),{nome,cognome,title:cognome+' '+nome,note:'',fb:false,test:[],medaglie:[],by:uid,at:serverTimestamp()});
      aid=a.id}
    const ref=doc(db,'sections',SEC,'items',aid),ex=items.find(i=>i.id===aid&&i.kind==='tessera');
    const data={...v,kind:'tessera',atleta:aid,nome,cognome,title:cognome+' '+nome,fb:true,
      note:[v.ente,v.numero&&'n. '+v.numero,v.scadenza&&'scade '+fmtD(v.scadenza)].filter(Boolean).join(' · ')};
    if(ex)await updateDoc(ref,data);else await setDoc(ref,{...data,by:uid,at:serverTimestamp()});
    /* file: il nuovo sostituisce il vecchio (che viene tolto solo dopo il caricamento riuscito) */
    const put=async(file,ruolo,fld,old,rm)=>{
      if(file){
        er.textContent='Caricamento '+(ruolo==='tessera'?'della tessera':'del certificato')+'…';
        const fid=await arch.save(file,{tesAtl:aid,ruolo,fb:true},p=>{er.textContent='Caricamento '+(ruolo==='tessera'?'della tessera':'del certificato')+' '+p+'%'});
        await updateDoc(ref,{[fld]:fid});if(old)await arch.remove(old).catch(()=>{})}
      else if(old&&rm){await arch.remove(old).catch(()=>{});await updateDoc(ref,{[fld]:''})}};
    try{
      await put(ft,'tessera','tesFile',ftOld,(o.querySelector('#rt')||{}).checked);
      await put(fc,'certificato','certFile',fcOld,(o.querySelector('#rc')||{}).checked);
    }catch(e){console.error(e);er.textContent='Dati salvati, ma un file non è stato caricato ('+arch.errText(e)+'). Riprova da Modifica.';return false}
    if(!r.id&&detail===null)openDetail(aid)}});
  o.querySelector('#ct').value=t.certTipo||'';
  const ta=o.querySelector('#ta');if(ta)ta.onchange=()=>{o.querySelector('#nw').hidden=ta.value!=='__new'};
  /* lettura automatica appena si sceglie un file */
  const run=async(inp,out,kind)=>{
    const f=inp.files[0];if(!f)return;
    const say=m=>{out.textContent=m};
    if(!f.type.startsWith('image/')){say('File PDF: la lettura automatica funziona sulle foto. Inserisci i dati a mano.');return}
    try{
      const text=await ocr(f,say),set=(id,val)=>{if(val)o.querySelector('#'+id).value=val},got=[];
      if(kind==='t'){
        const p=parseTessera(text);
        set('en',p.ente);set('nu',p.numero);set('em',p.emissione);set('sc',p.scadenza);
        ['ente','numero','emissione','scadenza'].forEach(k=>{if(p[k])got.push(k==='numero'?'numero':k==='scadenza'?'scadenza':k)});
        if(ta){
          if(p.atleta){ta.value=p.atleta;ta.onchange();got.push('atleta')}
          else if(canNewAtl()&&(p.cognomeRil||p.nomeRil)){ta.value='__new';ta.onchange();set('nc',p.cognomeRil);set('nn',p.nomeRil);got.push('nuovo atleta')}}
        say(got.length?'Letti: '+got.join(', ')+'.'+(p.dedotta?' La scadenza è dedotta: verificala.':'')+' Controlla sempre i dati prima di salvare.':'Non sono riuscito a leggere dati utili: inseriscili a mano (prova con una foto più nitida e dritta).')
      }else{
        const p=parseCert(text);set('cd',p.certScad);if(p.certTipo)o.querySelector('#ct').value=p.certTipo;
        say(p.certScad?'Letta la scadenza.'+(p.dedotta?' È dedotta: verificala.':'')+' Controlla prima di salvare.':'Non ho trovato la scadenza: inseriscila a mano.')}
    }catch(e){console.error(e);say(e&&e.message==='LOAD'?'Lettura automatica non disponibile (serve la connessione a internet): inserisci i dati a mano.':'Lettura non riuscita: inserisci i dati a mano.')}};
  o.querySelector('#ft').onchange=e=>run(e.target,o.querySelector('#ot'),'t');
  o.querySelector('#fc').onchange=e=>run(e.target,o.querySelector('#oc'),'c')}

/* ---------- CSV e PDF della lista ---------- */
function tabella(){
  const {list}=filtered();
  const head=['Cognome','Nome','ID tessera','Ente','Emissione','Scadenza tessera','Stato tessera','Tipo certificato','Scadenza certificato','Stato certificato'];
  const body=list.map(r=>{const t=r.t||{};return [r.cognome,r.nome,t.numero||'',t.ente||'',isD(t.emissione)?fmtD(t.emissione):'',isD(t.scadenza)?fmtD(t.scadenza):'',stTxt(t.scadenza),t.certTipo||'',isD(t.certScad)?fmtD(t.certScad):'',stTxt(t.certScad)]});
  return {head,body}}
const stamp=()=>{const n=new Date();return n.getFullYear()+'-'+p2(n.getMonth()+1)+'-'+p2(n.getDate())};
function exportCsv(){
  const {head,body}=tabella();
  const t='\ufeff'+[head,...body].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  saveBlob(new Blob([t],{type:'text/csv;charset=utf-8'}),'Tessere atleti '+stamp()+'.csv')}
const loadJs=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('LOAD'));document.head.append(s)});
async function exportPdf(){
  const {head,body}=tabella(),b=$('#pdf');b.disabled=true;const old=b.textContent;b.textContent='Preparazione…';
  try{
    if(!window.jspdf)await loadJs('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    if(!(window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable))await loadJs('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    const d=new window.jspdf.jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
    d.setFontSize(14);d.text('Yanagi Academy – Tessere e certificati medici',40,38);
    d.setFontSize(9);d.text('Aggiornato al '+fmtD(stamp())+' · '+body.length+' atleti',40,54);
    d.autoTable({head:[head],body,startY:66,styles:{fontSize:8,cellPadding:3},headStyles:{fillColor:[27,42,74]},
      didParseCell:h=>{if(h.section==='body'&&(h.column.index===6||h.column.index===9)){const v=String(h.cell.raw);if(v==='Scaduta'||v.startsWith('In scadenza')){h.cell.styles.textColor=[200,30,30];h.cell.styles.fontStyle='bold'}}}});
    saveBlob(d.output('blob'),'Tessere atleti '+stamp()+'.pdf');
  }catch(e){console.error(e);alert('Non riesco a creare il PDF (serve la connessione a internet). Puoi usare “Scarica CSV”.')}
  b.disabled=false;b.textContent=old}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(!started){
        started=true;
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
        /* la lista degli atleti viene dalla sezione Atleti (se non hai accesso a quella, restano gli atleti che hanno già una tessera) */
        unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{atl=[];renderList()}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
