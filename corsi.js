/* Corsi («I nostri corsi»): l'admin (o chi ha la scrittura) aggiunge i corsi; gli account con almeno la lettura li vedono in elenco e, toccando un corso, ne aprono le specifiche.
   Dati: sections/corsi/items (kind 'corso') su Telegram, argomento «I Nostri corsi», con copia fb:true su Firebase così si leggono anche senza Telegram (fsx.js ripiega da solo).
   Campi: nome, breve (una riga), descrizione, perChi, quando, dove, istruttore, quota, serve, altro; title/note = nome/breve per la ricerca della Home.
   COLLEGAMENTO: i nomi dei corsi sono l'elenco dei corsi della scheda Atleti (campo «corsi») e dei gruppi (criterio «Corso») in Atleti, Eventi, Lezioni e Calendario (gruppi-atleti.js, seguiCorsi). Rinominando un corso si aggiornano le schede atleta e le regole di gruppo del Calendario che lo usavano.
   Permessi come le altre sezioni: Gestione account → Corsi (Lettura per gli atleti, Scrittura per chi può modificare). Regole Firestore: quelle generiche di sections/{sec}/items. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,getDocs,serverTimestamp,logEvento} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='corsi';
/* [campo, etichetta, suggerimento] dei dati di dettaglio */
const CAMPI=[['perChi','Per chi','Età e livello'],['quando','Quando','Giorni e orari'],['dove','Dove','Palestra o sede'],['istruttore','Istruttore',''],['quota','Quota','Es. 35 € al mese'],['serve','Cosa serve','Abbigliamento e attrezzatura'],['altro','Altre informazioni','']];
let auth,db,col,me=null,items=[],atl=[],unsubs=[],shell=false,letto=false,errLet='';
const puoVedere=()=>!!me&&(me.admin||['r','w'].includes((me.perms||{})[SEC]));
const puoModif=()=>!!me&&(me.admin||(me.perms||{})[SEC]==='w');
const msgErr=e=>String((e&&e.message)||e||'').indexOf('NO_SESSION')>=0?'Telegram non è collegato: apri la Chat e accedi, poi riprova.':'Operazione non riuscita. Controlla la connessione e l’accesso a Telegram (Chat), poi riprova.';
const nomeAt=a=>[a.cognome,a.nome].filter(Boolean).join(' ')||a.title||'Atleta';
const iscritti=nome=>atl.filter(a=>Array.isArray(a.corsi)&&a.corsi.includes(nome));
/* dopo aver rinominato un corso: stesse schede atleta e stesse regole di gruppo del Calendario col nome nuovo */
async function rinomina(vecchio,nuovo){
  let n=0;
  for(const a of iscritti(vecchio)){await updateDoc(doc(db,'sections','atleti','items',a.id),{corsi:a.corsi.map(x=>x===vecchio?nuovo:x)});n++}
  const cal=await getDocs(collection(db,'sections','calendario','items'));
  for(const d of cal.docs){const r=d.data().regola;if(r&&r.corso===vecchio){await updateDoc(doc(db,'sections','calendario','items',d.id),{regola:{...r,corso:nuovo}});n++}}
  return n}
const corsi=()=>items.filter(i=>i.kind==='corso'||(!i.kind&&i.nome)).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'it'));

function modal(title,body,{ok='Salva',cancel='Annulla',onSave,extra=''}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px;overflow-wrap:anywhere">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>${cancel}</button>${extra}${onSave?`<button class="btn" data-ok>${ok}</button>`:''}</div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  if(onSave)o.querySelector('[data-ok]').onclick=async()=>{er.textContent='';try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent=msgErr(x)}};
  document.body.append(o);o.close=close;return o}

/* specifiche del corso (si apre toccando il corso nell'elenco) */
function dettaglio(c){
  const isc=me.admin?iscritti(c.nome):[];
  const righe=CAMPI.filter(([k])=>String(c[k]||'').trim()).map(([k,l])=>`<dt>${esc(l)}</dt><dd>${esc(c[k])}</dd>`).join('')+(me.admin&&atl.length?`<dt>Atleti iscritti</dt><dd>${isc.length?esc(isc.length+': '+isc.map(nomeAt).join(', ')):'Nessuno (si segnano nella scheda Atleti)'}</dd>`:'');
  const body=`${c.breve?`<div class="mu" style="margin-top:4px">${esc(c.breve)}</div>`:''}${c.descrizione?`<p class="ds">${esc(c.descrizione)}</p>`:''}${righe?`<dl class="dl">${righe}</dl>`:''}${!c.descrizione&&!righe&&!c.breve?'<div class="mu" style="margin-top:8px">Nessuna specifica inserita per questo corso.</div>':''}`;
  const o=modal(c.nome||'Corso',body,{cancel:'Chiudi',extra:puoModif()?'<button class="btn ghost" data-ed>Modifica</button><button class="btn ghost" data-del>Elimina</button>':''});
  if(puoModif()){
    o.querySelector('[data-ed]').onclick=()=>{o.close();form(c)};
    o.querySelector('[data-del]').onclick=()=>{
      if(!confirm('Eliminare il corso «'+c.nome+'»? Va nel Cestino.'+(isc.length?' '+isc.length+(isc.length===1?' atleta lo segue':' atleti lo seguono')+': resta segnato sulla loro scheda ma il corso sparisce dagli elenchi.':'')))return;
      deleteDoc(doc(db,'sections',SEC,'items',c.id)).then(()=>{logEvento('elimina','corsi',c.id,'Corsi','Eliminato il corso «'+c.nome+'»');o.close()}).catch(x=>{o.querySelector('[data-er]').textContent=msgErr(x)})}}}

function form(c){
  const ex=c||{};
  const body=`<label for="fn">Nome del corso</label><input id="fn" type="text" maxlength="80" placeholder="Es. Judo kids" value="${esc(ex.nome||'')}">
  <label for="fb">In breve (una riga)</label><input id="fb" type="text" maxlength="140" placeholder="Es. Judo per bambini dai 6 ai 12 anni" value="${esc(ex.breve||'')}">
  <label for="fd">Descrizione</label><textarea id="fd" maxlength="3000" placeholder="Cosa si fa, come si svolgono le lezioni…">${esc(ex.descrizione||'')}</textarea>
  ${CAMPI.map(([k,l,h])=>`<label for="f_${k}">${esc(l)} (facoltativo)</label><input id="f_${k}" type="text" maxlength="200" placeholder="${esc(h)}" value="${esc(ex[k]||'')}">`).join('')}`;
  const o=modal(c?'Modifica corso':'Nuovo corso',body,{onSave:async(o,er)=>{
    const g=id=>o.querySelector('#'+id).value.trim(),nome=g('fn');
    if(!nome){er.textContent='Scrivi il nome del corso.';return false}
    if(items.some(i=>i.id!==ex.id&&String(i.nome||'').trim().toLowerCase()===nome.toLowerCase())){er.textContent='Esiste già un corso con questo nome.';return false}
    const D={kind:'corso',nome,breve:g('fb'),descrizione:g('fd'),title:nome,note:g('fb'),fb:true};
    CAMPI.forEach(([k])=>{D[k]=g('f_'+k)});
    if(c)await updateDoc(doc(db,'sections',SEC,'items',c.id),D);
    else await addDoc(col,{...D,by:me.id,at:serverTimestamp()});
    logEvento(c?'modifica':'crea','corsi',c?c.id:'','Corsi',(c?'Modificato':'Creato')+' il corso «'+nome+'»');
    if(c&&c.nome&&c.nome!==nome&&me.admin){
      try{const n=await rinomina(c.nome,nome);if(n)logEvento('modifica','corsi',c.id,'Corsi','Corso rinominato «'+c.nome+'» → «'+nome+'»: aggiornati '+n+' elementi')}
      catch(x){console.error(x);alert('Il corso è stato rinominato, ma non è stato possibile aggiornare tutte le schede atleta e le regole di gruppo che lo usavano: riapri la scheda degli atleti interessati e ricontrolla i corsi.')}}}});
  o.querySelector('#fn').focus()}

function paint(){
  const el=$('#lista');if(!el)return;
  if(errLet){el.innerHTML=`<p class="err" role="alert">${esc(errLet)}</p>`;return}
  if(!letto){el.innerHTML='<div class="mu">Caricamento…</div>';return}
  const l=corsi();
  el.innerHTML=l.length?`<div class="cors">${l.map(c=>`<button class="cr" data-id="${esc(c.id)}"><b>${esc(c.nome)}</b>${c.breve?`<span class="mu">${esc(c.breve)}</span>`:''}${c.quando?`<span class="mu">${esc(c.quando)}</span>`:''}</button>`).join('')}</div>`
    :`<div class="mu">${puoModif()?'Nessun corso. Premi «Nuovo corso» per aggiungere il primo.':'Nessun corso inserito per ora.'}</div>${puoModif()?'<div class="mu" style="margin-top:8px">Finché non ne inserisci, negli elenchi degli atleti valgono Kata, Judo kids e Judo. Appena aggiungi un corso, l’elenco diventa quello di questa scheda.</div><div class="dact"><button class="btn ghost" id="seed">Aggiungi Kata, Judo kids e Judo</button></div>':''}`}

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">I nostri corsi</h2>${puoModif()?'':'<span class="badge">Sola lettura</span>'}</div></div>
  <div class="card cd"><div class="mu" style="margin-bottom:8px">${puoModif()?'Aggiungi i corsi: gli atleti con accesso li vedono qui e toccando un corso aprono le specifiche.':'Tocca un corso per vedere le specifiche.'}</div><div id="lista"></div>${puoModif()?'<div class="dact"><button class="btn" id="nc">Nuovo corso</button></div>':''}</div></div>`;
  $('#out').onclick=()=>signOut(auth);
  $('#lista').addEventListener('click',e=>{
    if(e.target.id==='seed'){e.target.disabled=true;
      Promise.all(['Judo','Judo kids','Kata'].map(nome=>addDoc(col,{kind:'corso',nome,breve:'',descrizione:'',title:nome,note:'',fb:true,by:me.id,at:serverTimestamp()}))).then(()=>logEvento('crea','corsi','','Corsi','Creati i corsi Judo, Judo kids e Kata')).catch(x=>{e.target.disabled=false;alert(msgErr(x))});return}
    const b=e.target.closest('.cr');if(!b)return;const c=items.find(x=>x.id===b.dataset.id);if(c)dettaglio(c)});
  if($('#nc'))$('#nc').onclick=()=>form();
  paint()}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Apri index.html e incolla i dati del progetto Firebase.')}
else{
  const fa=initializeApp(firebaseConfig);auth=getAuth(fa);db=getFirestore(fa);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];shell=false;letto=false;errLet='';
    if(!u){location.href='index.html';return}
    unsubs.push(onSnapshot(doc(db,'users',u.uid),sn=>{
      me=sn.exists()?{id:u.uid,...sn.data()}:null;
      if(!puoVedere()){app.innerHTML=box('Nessun accesso','Non hai accesso ai corsi. Chiedi all’admin di abilitarti.');shell=false;return}
      if(shell)return;
      costruisci();
      if(me.admin)unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>!a.kind||a.kind==='atleta')},()=>{}));
      unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));letto=true;errLet='';paint()},e=>{console.error('corsi',e);errLet='Impossibile leggere i corsi. Controlla la connessione e riprova.';paint()}))},
    ()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
