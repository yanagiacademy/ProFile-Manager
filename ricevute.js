/* Ricevute dei pagamenti.
   - Chi ha il permesso Ricevute in SCRITTURA (admin, commercialista) carica le ricevute (PDF o foto) e le associa a un atleta:
     data del pagamento, importo, causale, n. ricevuta, modalità. Chi ha la LETTURA le vede e le scarica tutte.
   - L'atleta (account con la stessa email inserita in Atleti; un genitore può avere più figli) vede e scarica SOLO le proprie ricevute,
     senza alcun permesso sulla sezione: Home → «La mia area» → «Le mie ricevute».

   Dati: sections/ricevute/items/<id>, kind:'file' (come i file di Tessere) con
     ricAtl (id atleta), nome, cognome, ricData (AAAA-MM-GG), importo (numero, euro), causale, ricNum, metodo, note
     + i campi del file: title, size, mime, tg (messaggio Telegram), chunks (copia su Firebase), enc.
   Il registro sta su Telegram (argomento «Ricevute», cifrato come le altre sezioni) e OGNI ricevuta ha anche la copia su Firebase
   (fb:true, file fino a 20 MB a blocchi): l'atleta non ha la sessione Telegram e legge solo da lì.
   Le regole Firestore (firestore.rules) fanno leggere all'atleta soltanto i documenti con ricAtl uguale a una sua scheda. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,updateDoc} from "./fsx.js";
import {doc as rdoc,collection as rcol,getDoc as rgetDoc,getDocs as rgetDocs,query as rquery,where as rwhere} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {archivio} from "./archivio.js";
import {showPreview,saveBlob,guessMime} from "./file-tools.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='ricevute',MAXB=20*1024*1024;
const METODI=['Contanti','Bonifico','Carta / POS','Altro'];
let auth,db,col,uid=null,me=null,items=[],atl=[],unsubs=[],started=false,sigPerm='',shellOn=false,memo=null,arch=null,errItems=false;
let q='',fAtl='',fAnno='',vista='';                                   /* lato gestione */
let mioState='load',mio=null,mioId='',mieR=[],mioErr='',mAnno='';      /* lato atleta: mio={ids,nomi} */
const perm=()=>{if(!me)return 'n';if(me.admin)return 'w';const v=(me.perms||{})[SEC]||'n';return v==='u'?'n':v};
const gest=()=>perm()==='r'||perm()==='w',scrive=()=>perm()==='w';

/* ---------- utilità ---------- */
const p2=n=>String(n).padStart(2,'0');
const oggi=()=>{const d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())};
const isD=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));if(!m)return false;const d=new Date(+m[1],+m[2]-1,+m[3]);return d.getFullYear()===+m[1]&&d.getMonth()===+m[2]-1&&d.getDate()===+m[3]};
const fmtD=s=>isD(s)?s.slice(8)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'';
const euro=n=>typeof n==='number'&&isFinite(n)?n.toLocaleString('it-IT',{style:'currency',currency:'EUR'}):'';
const somma=l=>Math.round(l.reduce((s,r)=>s+(typeof r.importo==='number'?r.importo:0),0)*100)/100;
const kb=n=>n>=1048576?(n/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(n/1024))+' KB';
/* importo scritto a mano: «45», «45,50», «1.234,56», «45.5» → numero; vuoto → null; non valido o ≤ 0 → NaN */
function parseImporto(s){
  s=String(s||'').replace(/[\s€]/g,'');if(!s)return null;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(s))return NaN;
  const n=Math.round(parseFloat(s)*100)/100;return n>0?n:NaN}
const nameOf=r=>((r.cognome||'')+' '+(r.nome||'')).trim()||'Atleta';
const ext=t=>{const m=/\.([A-Za-z0-9]{1,5})$/.exec(t||'');return m?'.'+m[1].toLowerCase():''};
/* nome del file quando si scarica: «Ricevuta 2026-11-12 Rossi n 15.pdf» */
const dlName=r=>('Ricevuta '+[r.ricData,r.cognome,r.ricNum&&'n '+r.ricNum].filter(Boolean).join(' ')).replace(/[\\/:*?"<>|]+/g,'-')+ext(r.title);
const cmp=(a,b)=>String(b.ricData||'').localeCompare(String(a.ricData||''))||nameOf(a).localeCompare(nameOf(b),'it');
const anniDi=l=>[...new Set(l.map(r=>String(r.ricData||'').slice(0,4)).filter(Boolean))].sort().reverse();
const testo=r=>[nameOf(r),r.causale,r.ricNum,r.metodo,fmtD(r.ricData),euro(r.importo)].filter(Boolean).join(' ').toLowerCase();
const passaQ=r=>!q.trim()||testo(r).includes(q.trim().toLowerCase());

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
    try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Salvataggio non riuscito. Controlla la connessione e riprova.'}
    b.disabled=false};
  document.body.append(o);return o}

/* i dati vanno su Telegram (con copia su Firebase): serve la sessione Telegram, che si fa dalla Chat */
function canWrite(){
  if(arch.needsTelegram()){
    if(confirm('I dati vengono salvati su Telegram (con copia su Firebase): prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  return true}

/* ---------- lato gestione (admin, commercialista) ---------- */
const ricList=()=>items.filter(i=>i.ricAtl).sort(cmp);
const passa=r=>passaQ(r)&&(!fAtl||r.ricAtl===fAtl)&&(!fAnno||String(r.ricData||'').startsWith(fAnno));
/* atleti tra cui scegliere: la scheda Atleti (serve la lettura su Atleti) più quelli che hanno già una ricevuta */
function pickList(){
  const m=new Map();
  atl.filter(a=>a.nome||a.cognome||a.title).forEach(a=>m.set(a.id,{id:a.id,nome:a.nome||'',cognome:a.cognome||(a.nome?'':a.title)||''}));
  ricList().forEach(r=>{if(!m.has(r.ricAtl))m.set(r.ricAtl,{id:r.ricAtl,nome:r.nome||'',cognome:r.cognome||''})});
  return [...m.values()].sort((a,b)=>nameOf(a).localeCompare(nameOf(b),'it'))}
const rowHtml=r=>`<button class="tr" data-a="det" data-id="${esc(r.id)}"><span class="inf"><div><b>${esc(nameOf(r))}</b></div><div class="mu">${esc([fmtD(r.ricData),r.causale,r.ricNum&&'n. '+r.ricNum].filter(Boolean).join(' · '))}</div></span>${typeof r.importo==='number'?`<span class="chips"><span class="chip ok">${esc(euro(r.importo))}</span></span>`:''}</button>`;
function gestHtml(){
  const w=scrive(),all=ricList(),L=all.filter(passa),tot=somma(L),atls=new Map();
  all.forEach(r=>atls.set(r.ricAtl,nameOf(r)));
  return `${errItems?'<div class="card" role="alert" style="margin-bottom:12px"><b>Dati non completi</b><div class="mu">Non riesco a leggere tutte le ricevute. Accedi a Telegram dalla pagina <a href="chat.html">Chat</a> e riapri questa pagina.</div></div>':''}
    <div class="hbtn" style="margin:0 0 12px">${w?'<button class="btn sm" data-a="new">+ Carica ricevuta</button>':''}<button class="btn ghost sm" data-a="csv">Scarica CSV</button></div>
    <div class="flt"><select id="fa" aria-label="Filtra per atleta"><option value="">Tutti gli atleti</option>${[...atls].sort((a,b)=>a[1].localeCompare(b[1],'it')).map(([id,n])=>`<option value="${esc(id)}" ${id===fAtl?'selected':''}>${esc(n)}</option>`).join('')}</select>
      <select id="fy" aria-label="Filtra per anno"><option value="">Tutti gli anni</option>${anniDi(all).map(y=>`<option value="${y}" ${y===fAnno?'selected':''}>${y}</option>`).join('')}</select></div>
    <div class="mu" style="margin:0 0 8px" role="status">${L.length} ${L.length===1?'ricevuta':'ricevute'}${tot?' · totale '+esc(euro(tot)):''}</div>
    <div class="card" style="padding:8px 14px">${L.length?L.map(rowHtml).join(''):`<div class="mu" style="padding:10px 0">${all.length?'Nessuna ricevuta con questi filtri.':(w?'Ancora nessuna ricevuta. Premi «Carica ricevuta» per aggiungere la prima.':'Ancora nessuna ricevuta.')}</div>`}</div>`}

function openDetail(r){
  const w=scrive(),dd=(k,v)=>v?`<dt>${k}</dt><dd>${esc(v)}</dd>`:'';
  const o=modal('Ricevuta · '+nameOf(r),`<div class="dl" style="margin-top:8px"><dl>${dd('Atleta',nameOf(r))}${dd('Data del pagamento',fmtD(r.ricData))}${dd('Importo',euro(r.importo))}${dd('Causale',r.causale)}${dd('N. ricevuta',r.ricNum)}${dd('Modalità',r.metodo)}${dd('File',(r.title||'')+(r.size?' ('+kb(r.size)+')':''))}</dl></div>
    <div class="dact" style="justify-content:flex-start"><button class="btn" data-a="o">Apri</button><button class="btn ghost" data-a="d">Scarica</button>${w?'<button class="btn ghost" data-a="e">Modifica</button><button class="btn ghost" data-a="x">Elimina</button>':''}</div>`,{cancel:'Chiudi'});
  const chiudi=()=>o.querySelector('[data-x]').click(),on=(a,f)=>{const b=o.querySelector(`[data-a="${a}"]`);if(b)b.onclick=f};
  on('o',()=>showPreview({title:dlName(r),mime:r.mime,load:say=>arch.getBlob(r,say),errText:x=>'Impossibile aprire il file: '+arch.errText(x),fileName:dlName(r)}));
  on('d',async()=>{try{saveBlob(await arch.getBlob(r,()=>{}),dlName(r))}catch(x){console.error(x);alert('Impossibile scaricare il file: '+arch.errText(x))}});
  on('e',()=>{chiudi();openForm(r)});
  on('x',async()=>{
    if(!canWrite())return;
    if(!confirm('Eliminare la ricevuta di '+nameOf(r)+' del '+fmtD(r.ricData)+'? Finisce nel Cestino e l’atleta non potrà più vederla.'))return;
    try{await arch.remove(r);chiudi()}catch(x){console.error(x);alert('Eliminazione non riuscita. Riprova.')}})}

/* carica una nuova ricevuta (r nullo) oppure modifica i dati di una esistente: per cambiare il file si elimina e si ricarica */
function openForm(r){
  if(!r&&!canWrite())return;
  const t=r||{},list=pickList();
  const body=`<label for="fa2">Atleta</label><select id="fa2"><option value="">Scegli l’atleta…</option>${list.map(a=>`<option value="${esc(a.id)}" ${a.id===t.ricAtl?'selected':''}>${esc(nameOf(a))}</option>`).join('')}</select>
    ${list.length?'':'<div class="mu" style="margin-top:6px">L’elenco atleti è vuoto: serve il permesso di lettura su Atleti e l’accesso a Telegram dalla Chat.</div>'}
    <div class="two"><div><label for="fd">Data del pagamento</label><input id="fd" type="date" value="${esc(t.ricData||oggi())}"></div>
      <div><label for="fi">Importo in euro (facoltativo)</label><input id="fi" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 45,00" value="${typeof t.importo==='number'?esc(String(t.importo).replace('.',',')):''}"></div></div>
    <label for="fc">Causale (facoltativa)</label><input id="fc" type="text" autocomplete="off" maxlength="120" placeholder="es. Quota associativa 2026/27" value="${esc(t.causale||'')}">
    <div class="two"><div><label for="fn">N. ricevuta (facoltativo)</label><input id="fn" type="text" autocomplete="off" maxlength="40" value="${esc(t.ricNum||'')}"></div>
      <div><label for="fm">Modalità (facoltativa)</label><select id="fm"><option value=""></option>${METODI.map(m=>`<option ${m===t.metodo?'selected':''}>${m}</option>`).join('')}</select></div></div>
    ${r?`<p class="mu" style="margin:12px 0 0">File: ${esc(r.title||'')}. Per cambiare il file elimina la ricevuta e caricala di nuovo.</p>`
       :'<label for="ff">File della ricevuta (PDF o foto, max 20 MB)</label><input id="ff" type="file" accept="application/pdf,image/*">'}
    <p class="mu" style="font-size:.8rem;margin:10px 0 0">L’atleta la vede in «Le mie ricevute» se ha un account con la stessa email inserita nella sua scheda Atleti.</p>`;
  modal(r?'Modifica la ricevuta':'Carica una ricevuta',body,{ok:r?'Salva':'Carica',onSave:async(o,er)=>{
    const g=id=>o.querySelector('#'+id).value.trim();
    const aid=g('fa2'),a=list.find(x=>x.id===aid);
    if(!a){er.textContent='Scegli l’atleta.';return false}
    const d=g('fd');if(!isD(d)){er.textContent='Indica la data del pagamento.';return false}
    const imp=parseImporto(g('fi'));if(Number.isNaN(imp)){er.textContent='L’importo non è valido: scrivi per esempio 45,00.';return false}
    const f=r?null:o.querySelector('#ff').files[0];
    if(!r){
      if(!f){er.textContent='Scegli il file della ricevuta (PDF o foto).';return false}
      if(!f.size){er.textContent='Il file è vuoto.';return false}
      if(f.size>MAXB){er.textContent='Il file supera i 20 MB: l’atleta non potrebbe scaricarlo. Riducilo e riprova.';return false}}
    if(!canWrite())return false;
    const v={ricAtl:aid,nome:a.nome,cognome:a.cognome,ricData:d,importo:imp,causale:g('fc'),ricNum:g('fn'),metodo:g('fm')};
    v.note=[nameOf(a),v.causale,imp!=null&&euro(imp),v.ricNum&&'n. '+v.ricNum].filter(Boolean).join(' · ');
    if(r){await updateDoc(doc(db,'sections',SEC,'items',r.id),v);return}
    er.textContent='Caricamento…';
    try{await arch.save(f,{...v,fb:true},p=>{er.textContent='Caricamento '+p+'%'})}
    catch(x){console.error(x);er.textContent='Caricamento non riuscito ('+arch.errText(x)+'). Riprova.';return false}}})}

const stamp=()=>oggi();
const cella=x=>{x=String(x??'');if(/^[=+\-@]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'};
function exportCsv(){
  const head=['Data','Cognome','Nome','Causale','Importo (€)','N. ricevuta','Modalità'];
  const body=ricList().filter(passa).map(r=>[fmtD(r.ricData),r.cognome||'',r.nome||'',r.causale||'',typeof r.importo==='number'?String(r.importo).replace('.',','):'',r.ricNum||'',r.metodo||'']);
  const t='\ufeff'+[head,...body].map(r=>r.map(cella).join(';')).join('\r\n');
  saveBlob(new Blob([t],{type:'text/csv;charset=utf-8'}),'Ricevute '+stamp()+'.csv')}

/* ---------- lato atleta: legge solo da Firebase (non ha la sessione Telegram) ---------- */
async function caricaMio(){
  const e=auth.currentUser&&auth.currentUser.email;if(!e)return false;
  try{
    const k=await rgetDoc(rdoc(db,'atletiEmail',e.toLowerCase()));if(!k.exists())return false;
    const d=k.data(),ids=(d.atleti&&d.atleti.length)?d.atleti:(d.atleta?[d.atleta]:[]);if(!ids.length)return false;
    const nomi={};
    for(const id of ids){try{const s=await rgetDoc(rdoc(db,'atletiDati',id));nomi[id]=s.exists()?((s.data().cognome||'')+' '+(s.data().nome||'')).trim():''}catch(x){nomi[id]=''}}
    mio={ids,nomi};if(!ids.includes(mioId))mioId=ids[0];return true
  }catch(x){console.error(x);return false}}
async function caricaMieRicevute(){
  mioErr='';
  try{const sn=await rgetDocs(rquery(rcol(db,'sections',SEC,'items'),rwhere('ricAtl','==',mioId)));mieR=sn.docs.map(d=>({id:d.id,...d.data()})).sort(cmp)}
  catch(x){console.error(x);mieR=[];mioErr=x&&x.code==='permission-denied'?'Non ho il permesso di leggere le ricevute: l’admin deve ripubblicare le regole di Firestore (file firestore.rules).':'Non riesco a leggere le ricevute. Controlla la connessione e riprova.'}}
async function mioBlob(r){
  const sn=await rgetDocs(rcol(db,'sections',SEC,'items',r.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(r.title,r.mime)})}
async function mioFile(scarica,r){
  const nome=dlName(r);
  try{
    if(scarica)saveBlob(await mioBlob(r),nome);
    else showPreview({title:nome,mime:r.mime,load:()=>mioBlob(r),errText:()=>'Impossibile aprire il file. Controlla la connessione e riprova.',fileName:nome})
  }catch(x){console.error(x);alert('Impossibile scaricare il file. Controlla la connessione e riprova.')}}
const mioRiga=r=>`<div class="fld"><div class="fh"><b>${esc(r.causale||'Ricevuta')}</b>${typeof r.importo==='number'?`<span class="chip ok">${esc(euro(r.importo))}</span>`:''}</div>
  <div class="mu">${esc([fmtD(r.ricData),r.ricNum&&'n. '+r.ricNum,r.metodo].filter(Boolean).join(' · '))}</div>
  ${r.chunks?`<div class="fr"><button class="btn sm" data-a="mD" data-id="${esc(r.id)}">Scarica</button><button class="btn ghost sm" data-a="mA" data-id="${esc(r.id)}">Apri</button></div>`
    :'<div class="mu" style="margin-top:6px">Il file non è disponibile online. Chiedi di ricaricarlo.</div>'}</div>`;
function mieHtml(){
  const sel=mio.ids.length>1?`<div class="dact" style="justify-content:flex-start;margin:0 0 10px">${mio.ids.map(id=>`<button class="btn sm${id===mioId?'':' ghost'}" data-a="mSel" data-id="${esc(id)}">${esc(mio.nomi[id]||'Atleta')}</button>`).join('')}</div>`:'';
  const anni=anniDi(mieR),L=mieR.filter(r=>passaQ(r)&&(!mAnno||String(r.ricData||'').startsWith(mAnno))),tot=somma(L);
  return `${sel}${mioErr?`<div class="card" role="alert" style="margin-bottom:12px"><b>Ricevute non disponibili</b><div class="mu">${esc(mioErr)}</div></div>`:''}
    <div class="flt">${anni.length>1?`<select id="ma" aria-label="Filtra per anno"><option value="">Tutti gli anni</option>${anni.map(y=>`<option value="${y}" ${y===mAnno?'selected':''}>${y}</option>`).join('')}</select>`:''}<button class="btn ghost sm" data-a="mAgg">Aggiorna</button></div>
    <div class="mu" style="margin:0 0 8px" role="status">${L.length} ${L.length===1?'ricevuta':'ricevute'}${tot?' · totale '+(mAnno?mAnno+': ':'')+esc(euro(tot)):''}</div>
    <div class="card" style="padding:4px 14px">${L.length?L.map(mioRiga).join(''):`<div class="mu" style="padding:10px 0">${mieR.length?'Nessuna ricevuta con questi filtri.':'Non ci sono ancora ricevute caricate.'}</div>`}</div>`}

/* ---------- pagina ---------- */
const vistaCorr=()=>{const g=gest(),m=mioState==='ok';if(g&&m)return vista==='mie'?'mie':'gest';return g?'gest':(m?'mie':'')};
const switchHtml=v=>`<div class="seg" role="group" aria-label="Vista" style="margin-bottom:12px"><button data-a="vista" data-v="gest" aria-pressed="${v==='gest'}">Tutte le ricevute</button><button data-a="vista" data-v="mie" aria-pressed="${v==='mie'}">Le mie ricevute</button></div>`;
function ensureShell(){
  if(shellOn)return;shellOn=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca" aria-label="Cerca nelle ricevute" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Ricevute</h2><div class="mu" id="sub"></div></div></div><div id="main"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;paintMain()};
  const m=$('#main');m.onclick=onClick;m.onchange=onChange}
function paintMain(){
  const m=$('#main');if(!m)return;
  const v=vistaCorr();
  if(!v){m.innerHTML=mioState==='load'?'<div class="mu">Caricamento…</div>':'';return}
  m.innerHTML=(gest()&&mioState==='ok'?switchHtml(v):'')+(v==='gest'?gestHtml():mieHtml());
  const s=$('#sub');if(s)s.textContent=v==='gest'?'Ricevute dei pagamenti degli atleti':'Le tue ricevute dei pagamenti'}
function repaint(){
  if(!me)return;
  if(!gest()&&mioState==='no'){shellOn=false;app.innerHTML=box('Nessuna ricevuta da mostrare','Non hai accesso a questa sezione e il tuo account non è collegato a un atleta. Chiedi all’admin di inserire la tua email nella scheda dell’atleta.');return}
  ensureShell();paintMain()}
function onChange(e){
  const t=e.target;
  if(t.id==='fa'){fAtl=t.value;paintMain()}
  else if(t.id==='fy'){fAnno=t.value;paintMain()}
  else if(t.id==='ma'){mAnno=t.value;paintMain()}}
async function onClick(e){
  const b=e.target.closest('[data-a]');if(!b)return;
  const a=b.dataset.a,id=b.dataset.id,r=items.find(i=>i.id===id)||mieR.find(i=>i.id===id);
  if(a==='new')openForm(null);
  else if(a==='csv')exportCsv();
  else if(a==='det'&&r)openDetail(r);
  else if(a==='vista'){vista=b.dataset.v;paintMain()}
  else if(a==='mSel'){mioId=id;mAnno='';await caricaMieRicevute();paintMain()}
  else if(a==='mAgg'){await caricaMieRicevute();paintMain()}
  else if((a==='mD'||a==='mA')&&r)mioFile(a==='mD',r)}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;shellOn=false;mio=null;mioState='load';mieR=[];items=[];atl=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me){app.innerHTML=box('Account non abilitato','Chiedi all’admin di abilitare il tuo account.');return}
      const sig=perm()+'|'+!!me.admin;
      if(started){if(sig!==sigPerm)location.reload();return}      /* permessi cambiati: si riparte da capo */
      started=true;sigPerm=sig;
      if(gest()){
        memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));errItems=false;repaint()},()=>{items=[];errItems=true;repaint()}));
        /* la lista degli atleti viene dalla sezione Atleti (se non c'è la lettura restano gli atleti che hanno già una ricevuta) */
        unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()}));repaint()},()=>{atl=[]}))}
      repaint();
      /* chi è anche un atleta (stessa email inserita in Atleti) vede anche «Le mie ricevute» */
      caricaMio().then(async ok=>{mioState=ok?'ok':'no';if(ok)await caricaMieRicevute();repaint()})
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
