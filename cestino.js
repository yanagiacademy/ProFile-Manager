/* Cestino: gli elementi eliminati dalle altre sezioni restano qui 30 giorni (file compresi), poi vengono cancellati per sempre.
   Ogni voce è un record di "sections/cestino/items" scritto da fsx.js al momento dell'eliminazione. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,getDoc,deleteDoc,ripristinaVoce,logEvento} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {eliminaFileDefinitivo} from "./archivio.js";
import {tgErrText} from "./telegram.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const GIORNI=30,DAY=864e5;
const NOMI={documenti:'Documenti','file-importanti':'File importanti','documenti-in-scadenza':'Documenti in scadenza',archivio:'Archivio',tecnici:'Tecnici',atleti:'Atleti',tessere:'Tessere',richieste:'Richieste',ordini:'Ordini',ricevute:'Ricevute',lezioni:'Lezioni',esami:'Esami',eventi:'Eventi',video:'Video',foto:'Foto',commercialista:'Commercialista',mail:'Mail'};
const nomeSez=k=>NOMI[k]||(k?k.charAt(0).toUpperCase()+k.slice(1).replace(/-/g,' '):'');
const KIND={file:'File',folder:'Cartella',text:'Nota di testo',voce:'Movimento',nota:'Nota del calendario',evento:'Evento',tessera:'Tessera',tesserino:'Tesserino',lezione:'Lezione'};

let auth,db,uid=null,me=null,entries=[],unsubs=[],shell=false,q='',fs='',purgato=false,msg='';
const perms=()=>me.perms||{};
const perm=()=>me?(me.admin?'w':(perms().cestino||'n')):'n';
const vede=s=>!!me&&(me.admin||['r','w'].includes(perms()[s]));
const puo=s=>perm()==='w'&&(me.admin||perms()[s]==='w');
const ms=e=>e.il&&typeof e.il.toMillis==='function'?e.il.toMillis():0;
const giorniRimasti=e=>GIORNI-Math.floor((Date.now()-ms(e))/DAY);
const quando=t=>{const g=Math.floor((Date.now()-t)/DAY);return g<=0?'oggi':g===1?'ieri':g+' giorni fa'};

/* piccola finestra con più pulsanti */
function dialogo(titolo,corpo,bottoni){
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="card dlg" role="dialog" aria-modal="true" aria-label="${esc(titolo)}"><h2>${esc(titolo)}</h2><div class="mu">${corpo}</div><p class="err" role="alert"></p><div class="dact"></div></div>`;
  const act=o.querySelector('.dact');
  bottoni.forEach(b=>{const x=document.createElement('button');x.className='btn'+(b.ghost?' ghost':'');x.textContent=b.label;
    x.onclick=async()=>{if(!b.fn){o.remove();return}x.disabled=true;try{await b.fn(o);o.remove()}catch(e){x.disabled=false;o.querySelector('.err').textContent=b.errore||'Operazione non riuscita.'}};act.append(x)});
  o.onkeydown=e=>{if(e.key==='Escape')o.remove()};
  document.body.append(o);act.lastChild.focus()}

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Cestino</h2><span class="badge">${perm()==='w'?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  <div class="card"><div class="mu">Gli elementi eliminati restano qui per ${GIORNI} giorni, file compresi, poi vengono cancellati per sempre. Vedi solo gli elementi delle sezioni a cui hai accesso.</div>
    <div class="flt"><input id="q" type="search" placeholder="Cerca nel Cestino" aria-label="Cerca nel Cestino"><select id="s" aria-label="Sezione"></select>${perm()==='w'?'<button class="btn ghost sm" id="vuota">Svuota il Cestino</button>':''}</div>
    <p class="mu" id="msg" role="status" style="margin:6px 0 0"></p><div id="ls"></div></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;render()};$('#s').onchange=e=>{fs=e.target.value;render()};
  const v=$('#vuota');if(v)v.onclick=svuota;
  $('#ls').onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;const x=entries.find(z=>z.eid===b.dataset.e);if(!x)return;
    if(b.dataset.a==='r')ripristina(x);else if(b.dataset.a==='d')eliminaUno(x)}}

const visibili=()=>entries.filter(e=>vede(e.sec)).sort((a,b)=>ms(b)-ms(a));
function filtrate(){const t=q.trim().toLowerCase();return visibili().filter(e=>(!fs||e.sec===fs)&&(!t||(e.titolo+' '+nomeSez(e.sec)+' '+(e.daNome||'')).toLowerCase().includes(t)))}
function render(){
  if(!$('#ls'))return;
  const all=visibili(),secs=[...new Set(all.map(e=>e.sec))].sort((a,b)=>nomeSez(a).localeCompare(nomeSez(b),'it'));
  if(fs&&!secs.includes(fs))fs='';
  $('#s').innerHTML='<option value="">Tutte le sezioni</option>'+secs.map(k=>`<option value="${esc(k)}" ${k===fs?'selected':''}>${esc(nomeSez(k))}</option>`).join('');
  const l=filtrate();$('#msg').textContent=msg;
  $('#ls').innerHTML=l.length?l.map(e=>{
    const g=giorniRimasti(e),tipo=KIND[e.kind]||'';
    return `<div class="rw"><div class="inf"><b>${esc(e.titolo||'(senza titolo)')}</b><span class="chip">${esc(nomeSez(e.sec))}</span>${tipo?`<span class="chip">${esc(tipo)}</span>`:''}
      <div class="mu">Eliminato${e.daNome?' da '+esc(e.daNome):''} ${esc(quando(ms(e)))} · <span class="${g<=3?'chip bad':''}" style="${g<=3?'margin:0':''}">${g<=0?'si cancella oggi':'si cancella tra '+g+(g===1?' giorno':' giorni')}</span></div></div>
      ${puo(e.sec)?`<div class="ac"><button class="btn sm" data-a="r" data-e="${esc(e.eid)}">Ripristina</button><button class="btn ghost sm" data-a="d" data-e="${esc(e.eid)}">Elimina ora</button></div>`:''}</div>`}).join('')
    :`<div class="emp">${all.length?'Nessun elemento con questi filtri.':'Il Cestino è vuoto.'}</div>`;
  const v=$('#vuota');if(v)v.disabled=!l.some(e=>puo(e.sec))}

/* ---- ripristino ---- */
async function esisteParent(e){
  const p=e.dati&&e.dati.parent;if(!p)return true;
  if(entries.some(x=>x.sec===e.sec&&x.id===p))return true;   /* anche la cartella è nel Cestino: si ripristina insieme (se scelto) */
  try{return (await getDoc(doc(db,'sections',e.sec,'items',p))).exists()}catch(x){return true}}
async function ripristinaLista(list){
  let ok=0,gia=0;
  for(const e of list){
    try{
      const patch=(await esisteParent(e))?undefined:{parent:''};     /* la cartella d'origine non c'è più: l'elemento torna nella radice */
      await ripristinaVoce(e.eid,patch);ok++
    }catch(x){if(x&&x.message==='ESISTE')gia++;else throw x}}
  return {ok,gia}}
function ripristina(e){
  const altri=entries.filter(x=>x.lotto&&x.lotto===e.lotto&&x.eid!==e.eid&&puo(x.sec));
  const esegui=list=>async()=>{const r=await ripristinaLista(list);msg=r.ok+(r.ok===1?' elemento ripristinato':' elementi ripristinati')+(r.gia?' ('+r.gia+' esisteva già e non è stato toccato)':'')+'.';render()};
  if(!altri.length)return dialogo('Ripristinare?',`“${esc(e.titolo)}” tornerà in ${esc(nomeSez(e.sec))}.`,[{label:'Annulla',ghost:true},{label:'Ripristina',fn:esegui([e]),errore:'Ripristino non riuscito. Controlla che Telegram sia collegato e riprova.'}]);
  dialogo('Ripristinare anche gli altri?',`“${esc(e.titolo)}” è stato eliminato insieme ad altri ${altri.length} elementi (per esempio una cartella con il suo contenuto).`,
    [{label:'Annulla',ghost:true},{label:'Solo questo',ghost:true,fn:esegui([e]),errore:'Ripristino non riuscito.'},{label:'Tutti ('+(altri.length+1)+')',fn:esegui([e,...altri]),errore:'Ripristino non riuscito.'}])}

/* ---- eliminazione definitiva ---- */
async function purge(list){
  let nonCanc=0;
  for(const e of list){
    if(e.tg||e.chunks){const r=await eliminaFileDefinitivo(db,{sec:e.sec,id:e.id,tg:e.tg,chunks:e.chunks});if(!r.tgOk)nonCanc++}
    await deleteDoc(doc(db,'sections','cestino','items',e.eid));
    logEvento('elimina-definitivo',e.sec,e.id,e.titolo,'dal Cestino')}
  return nonCanc}
const avvisoTg=n=>n?' Per '+n+(n===1?' file':' file')+' il messaggio su Telegram non si è potuto cancellare da questo account: eliminalo a mano dal gruppo.':'';
function eliminaUno(e){
  dialogo('Eliminare per sempre?',`“${esc(e.titolo)}” verrà eliminato definitivamente${e.tg||e.chunks?', file compreso':''}. Non si potrà più recuperare.`,
    [{label:'Annulla',ghost:true},{label:'Elimina per sempre',fn:async()=>{const n=await purge([e]);msg='Eliminato definitivamente.'+avvisoTg(n);render()},errore:'Eliminazione non riuscita.'}])}
function svuota(){
  const l=filtrate().filter(e=>puo(e.sec));if(!l.length)return;
  dialogo('Svuotare il Cestino?',`Verranno eliminati per sempre ${l.length} ${l.length===1?'elemento':'elementi'}${fs||q.trim()?' (solo quelli che vedi con i filtri attuali)':''}, file compresi. Non si potranno più recuperare.`,
    [{label:'Annulla',ghost:true},{label:'Elimina tutto',fn:async()=>{const n=await purge(l);msg=l.length+' elementi eliminati definitivamente.'+avvisoTg(n);render()},errore:'Svuotamento non riuscito.'}])}
/* alla prima apertura chi ha la scrittura elimina da solo quello che ha superato i 30 giorni */
async function autoPulizia(){
  if(purgato||perm()!=='w')return;purgato=true;
  const l=entries.filter(e=>giorniRimasti(e)<=0&&puo(e.sec));if(!l.length)return;
  try{const n=await purge(l);msg=l.length+(l.length===1?' elemento scaduto è stato eliminato':' elementi scaduti sono stati eliminati')+' definitivamente.'+avvisoTg(n);render()}catch(e){console.error(e)}}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per il Cestino. Chiedi all’admin.');shell=false;return}
      if(!shell)costruisci();
      if(unsubs.length<2)unsubs.push(onSnapshot(collection(db,'sections','cestino','items'),s=>{
        entries=s.docs.map(d=>({eid:d.id,...d.data()}));render();autoPulizia()},()=>{}));
      render()
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))});
}
