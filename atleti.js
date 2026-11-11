import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,setDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {isD,fmtD,giorni,addCad,ultimoTest,prossimoTest,testStato,testDaFare,testTesto,scadStato} from "./atleti-scadenze.js";
import {doc as rdoc,collection as rcollection,getDoc as rgetDoc,getDocs as rgetDocs,query as rquery,where as rwhere,deleteDoc as rdelete} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {showPreview,saveBlob,guessMime} from "./file-tools.js";
import {GRADI_LAB,livDaGrado,gradoCanon} from "./gradi.js";
import {ATL_EDIT,apriMedaglia,apriTest,apriDati,apriCarica,mieRichieste,richiesteHtml,annullaRichiesta} from "./richieste.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='atleti';
let auth,db,col,uid=null,me=null,items=[],tess=[],mails={},dati={},mods={},q='',flt='all',unsubs=[],shellFor='',editing=null,memo=null,detail=null;
/* Email dell'atleta: solo admin. Sta in una raccolta Firestore a parte (atletiMail/<idAtleta>), NON nella scheda su Telegram/Firebase, e le regole la fanno leggere solo all'admin */
const isAdm=()=>!!(me&&me.admin);
const mailOf=id=>(mails[id]&&mails[id].email)||'';
const MAIL_RE=/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/;
/* atletiEmail/<email> = {atleta:id, atleti:[id,…]}: serve all'account loggato per trovare le proprie schede (può leggere solo la chiave uguale alla sua email).
   Più atleti possono avere la stessa email (un genitore con più figli): l'elenco atleti raccoglie tutti. */
const idsOf=email=>Object.keys(mails).filter(k=>mailOf(k)&&mailOf(k).toLowerCase()===String(email).toLowerCase());
/* liv = grado più alto tra le schede collegate (1–16, 0 se non impostato): le regole lo usano per limitare il materiale di Esami */
const livOf=ids=>Math.max(0,...ids.map(id=>{const a=items.find(x=>x.id===id);return a?livDaGrado(a.grado):0}));
async function scriviChiave(email,ids){
  if(!ids.length)await deleteDoc(doc(db,'atletiEmail',email)).catch(()=>{});
  else await setDoc(doc(db,'atletiEmail',email),{atleta:ids[0],atleti:ids,liv:livOf(ids)})}
async function saveMail(id,email){
  if(!isAdm())return;
  const old=mailOf(id);
  if(email){
    await setDoc(doc(db,'atletiMail',id),{email,by:uid,at:serverTimestamp()});
    await scriviChiave(email,[...new Set([...idsOf(email).filter(k=>k!==id),id])]);
    if(old&&old.toLowerCase()!==email.toLowerCase())await scriviChiave(old,idsOf(old).filter(k=>k!==id)).catch(()=>{})}
  else if(mails[id]){
    await deleteDoc(doc(db,'atletiMail',id));
    if(old)await scriviChiave(old,idsOf(old).filter(k=>k!==id)).catch(()=>{});
    await deleteDoc(doc(db,'atletiDati',id)).catch(()=>{});await deleteDoc(doc(db,'atletiModifiche',id)).catch(()=>{})}}
/* allinea le chiavi per le email già inserite prima di questa funzione (una volta per sessione, solo admin) */
const synced=new Set();
function syncKeys(){
  if(!isAdm())return;
  const g={};Object.entries(mails).forEach(([id,m])=>{const e=m&&m.email;if(e)(g[e]=g[e]||[]).push(id)});
  Object.entries(g).forEach(([e,ids])=>{ids.sort();const sig=e+'|'+ids.join(',')+'|'+livOf(ids);if(synced.has(sig))return;synced.add(sig);
    setDoc(doc(db,'atletiEmail',e),{atleta:ids[0],atleti:ids,liv:livOf(ids)}).catch(()=>synced.delete(sig))})}
/* ---------- la mia tessera: l'atleta loggato (email uguale a quella inserita dall'admin) scarica la propria tessera e il proprio certificato ----------
   Legge solo la copia su Firebase (senza Telegram) dal percorso sections/tessere/items; permessi applicati dalle regole Firestore. */
let mioRich=[],mioOrd=[];
let mioP=null,mioId='',mioIds=[],mioNomi={},mioT=null,mioF={t:null,c:null},mioErr=false;
/* dettaglio di UNA scheda collegata (dati, modifiche proposte, tessera e certificato) */
async function caricaMioAt(id){
  mioId=id;mioT=null;mioF={t:null,c:null};mioDati=null;mioMod={};
  try{mioRich=await mieRichieste(db,uid)}catch(x){mioRich=[]}
  /* i miei ordini: solo quelli inviati da questo account (le regole non permettono di leggere gli altri) */
  try{const sn=await rgetDocs(rquery(rcollection(db,'ordiniInviati'),rwhere('by','==',uid)));mioOrd=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>((b.at&&b.at.toMillis&&b.at.toMillis())||0)-((a.at&&a.at.toMillis&&a.at.toMillis())||0))}catch(x){mioOrd=[]}
  try{const d=await rgetDoc(rdoc(db,'atletiDati',id));mioDati=d.exists()?d.data():null}catch(x){mioDati=null}
  try{const m=await rgetDoc(rdoc(db,'atletiModifiche',id));mioMod=m.exists()?(m.data().campi||{}):{}}catch(x){mioMod={}}
  const tr=await rgetDoc(rdoc(db,'sections','tessere','items',id));if(!tr.exists()){mioT=null;return}
  mioT=tr.data();
  const fl=async fid=>{if(!fid)return null;try{const sn=await rgetDoc(rdoc(db,'sections','tessere','items',fid));return sn.exists()&&sn.data().kind==='file'?{id:sn.id,...sn.data()}:null}catch(x){return null}};
  mioF={t:await fl(mioT.tesFile),c:await fl(mioT.certFile)}}
async function loadMio(){
  const e=auth.currentUser&&auth.currentUser.email;if(!e||isAdm())return;
  try{
    const k=await rgetDoc(rdoc(db,'atletiEmail',e.toLowerCase()));if(!k.exists())return;
    const d=k.data();mioIds=Array.isArray(d.atleti)&&d.atleti.length?d.atleti:[d.atleta];
    if(!mioIds.includes(mioId))mioId=mioIds[0];
    if(mioIds.length>1)for(const id of mioIds){if(mioNomi[id])continue;
      try{const x=await rgetDoc(rdoc(db,'atletiDati',id));if(x.exists()){const v=x.data();mioNomi[id]=((v.cognome||'')+' '+(v.nome||'')).trim()}}catch(z){}}
    await caricaMioAt(mioId);mioErr=false
  }catch(x){console.error(x);mioErr=true}}
async function ensureMio(id){if(id&&id!==mioId)await caricaMioAt(id)}
async function selMio(id,rep){if(!mioIds.includes(id)||id===mioId)return;try{await ensureMio(id);mioErr=false}catch(x){console.error(x);mioErr=true}rep()}
/* più figli con la stessa email: pulsanti con i nomi per scegliere di quale scheda parlare */
const mioSel=()=>mioIds.length>1?`<div class="dact" style="justify-content:flex-start;margin:0 0 10px;flex-wrap:wrap">${mioIds.map(id=>`<button class="btn sm${id===mioId?'':' ghost'}" data-a="mioSel" data-id="${esc(id)}">${esc(mioNomi[id]||'Atleta')}</button>`).join('')}</div>`:'';
async function mioBlob(f){
  const sn=await rgetDocs(rcollection(db,'sections','tessere','items',f.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(f.title,f.mime)})}
const rinfrescaMio=()=>{if(noAcc())mioView();else paintMio()};
async function mioAct(a,b){
  if(a==='ordAnn'){if(confirm('Annullare questo ordine?')){try{await rdelete(rdoc(db,'ordiniInviati',b.dataset.id));await caricaMioAt(mioId);rinfrescaMio()}catch(x){console.error(x);alert('Operazione non riuscita. Riprova.')}}return}
  if(a==='mioMed'){apriMedaglia({db,uid,soggetto:mioId,after:async()=>{await caricaMioAt(mioId);rinfrescaMio()}});return}
  if(a==='mioTest'){apriTest({db,uid,soggetto:mioId,nomi:[...new Set(((mioDati&&mioDati.test)||[]).flatMap(t=>(t.r||[]).map(r=>r.n)))],after:async()=>{await caricaMioAt(mioId);rinfrescaMio()}});return}
  if(a==='mioUp'){apriCarica({db,uid,soggetto:mioId,ruolo:'atleta',tipo:b.dataset.t,attuale:mioT||{},after:async()=>{await caricaMioAt(mioId);rinfrescaMio()}});return}
  if(a==='rAnn'){const r=mioRich.find(x=>x.id===b.dataset.id);if(r&&confirm('Annullare questa richiesta?')){try{await annullaRichiesta(db,r);await caricaMioAt(mioId);rinfrescaMio()}catch(x){console.error(x);alert('Operazione non riuscita. Riprova.')}}return}
  const f=a.endsWith('t')?mioF.t:mioF.c;if(!f)return;
  try{if(a[0]==='d')saveBlob(await mioBlob(f),f.title);
    else showPreview({title:f.title,mime:f.mime,load:()=>mioBlob(f),errText:()=>'Impossibile aprire il file.'})}
  catch(x){console.error(x);alert('Impossibile scaricare il file. Controlla la connessione e riprova.')}}
const mioRow=(f,ko,kd,vuoto,idSet)=>f?(f.chunks?`<div class="fr"><span class="mu">${esc(f.title)}</span><button class="btn sm" data-a="${kd}">Scarica</button><button class="btn ghost sm" data-a="${ko}">Apri</button></div>`:'<div class="mu" style="margin-top:8px">Il file non è disponibile online. Chiedi all’admin di ricaricarlo.</div>'):(idSet?'<div class="mu" style="margin-top:8px">Il file non è disponibile online. Chiedi all’admin di ricaricarlo.</div>':`<div class="mu" style="margin-top:8px">${vuoto}</div>`);
const mioUpHtml=()=>`<div class="dact" style="justify-content:flex-start;flex-wrap:wrap;margin-top:10px"><button class="btn sm" data-a="mioUp" data-t="tessera">Carica la tessera</button><button class="btn sm" data-a="mioUp" data-t="certificato">Carica il certificato medico</button></div><div class="mu" style="font-size:.8rem;margin-top:4px">Quello che carichi lo controlla l’admin: finché non lo conferma, restano i dati attuali.</div>${richiesteHtml(mioRich,mioId)}`;
const mioFiles=()=>mioT?`<div style="margin-top:10px"><b style="font-size:.9rem">I miei file</b><div class="mu" style="margin-top:6px">Tessera</div>${mioRow(mioF.t,'ot','dt','Nessun file caricato.',!!mioT.tesFile)}<div class="mu" style="margin-top:10px">Certificato medico</div>${mioRow(mioF.c,'oc','dc','Nessun file caricato.',!!mioT.certFile)}</div>`:'';
const mioChip=(l,d)=>{const s=scadStato(d);return !s?`<span class="chip">${l}: —</span>`:s.late?`<span class="chip bad">${l} scaduta da ${-s.g} g</span>`:s.soon?`<span class="chip bad">${l} ${s.g===0?'scade oggi':'scade tra '+s.g+' g'}</span>`:`<span class="chip">${l} fino al ${esc(fmtD(d))}</span>`};
/* pagina Atleti per l'atleta senza permessi sulla sezione: vede solo la propria scheda tessera */
/* La mia scheda: dati personali + tessera e certificato (con Scarica/Apri). Sempre disponibile all'atleta collegato, qualunque permesso abbia su Atleti. */
const ORD_STATO={inviato:['Inviato','warn'],ricevuto:['Ricevuto','ok'],evaso:['Evaso','']};
function mioOrdHtml(){
  const fd=t=>t&&t.toDate?t.toDate().toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const l=mioOrd.map(o=>{
    const [lab,cl]=ORD_STATO[o.stato]||['',''],nm=((o.cognome||'')+' '+(o.nome||'')).trim()||'Ordine';
    const righe=(o.righe||[]).map(r=>{const det=[r.misura&&'Misura '+r.misura,r.colore&&'Colore '+r.colore,r.marchio&&'Marchio '+r.marchio,r.altro&&(r.altroLabel||'Altro')+' '+r.altro].filter(Boolean).join(' · ');
      return `<div style="padding:4px 0"><b>${esc(r.qta||1)} × ${esc(r.nome)}</b>${det?`<div class="mu">${esc(det)}</div>`:''}</div>`}).join('');
    return `<details class="ord"><summary><span class="ot">${esc(nm)}</span><span class="chip ${cl}">${lab}</span><span class="op" aria-hidden="true"></span></summary><div class="ob"><div class="mu">${esc(fd(o.at))}${o.esterno?' · persona non atleta':''}</div>${righe}${o.nota?`<div class="mu" style="white-space:pre-wrap">Note: ${esc(o.nota)}</div>`:''}${o.stato==='inviato'?`<div class="dact"><button class="btn ghost sm" data-a="ordAnn" data-id="${esc(o.id)}">Annulla l’ordine</button></div>`:''}</div></details>`}).join('');
  return `<div class="card dl" style="margin-top:12px"><h2 style="margin:0">I miei ordini</h2>${l||'<div class="mu" style="margin-top:6px">Non hai ancora inviato ordini.</div>'}
    <div class="dact" style="justify-content:flex-start;margin-top:8px"><a class="btn sm" href="ordini.html" style="text-decoration:none">Ordina del materiale</a></div></div>`}
function mioCardsHtml(){
  return mioCardsBase()+mioOrdHtml()}
function mioCardsBase(){
  const t=mioT||{},nome=((t.cognome||'')+' '+(t.nome||'')).trim()||t.title||'';
  const d=(l,v)=>v?`<dt>${l}</dt><dd>${esc(v)}</dd>`:'';
  const err=mioErr?box2('Impossibile leggere i tuoi dati','Non riesco a collegarmi ai tuoi dati. Riprova tra poco; se il problema continua avvisa l’admin (le regole di sicurezza potrebbero non essere aggiornate).'):'';
  if(!mioId)return err;
  return mioSel()+err+`<div class="card dl"><h2 style="margin:0">${esc(nome||[mioCur('nome'),mioCur('cognome')].filter(Boolean).join(' '))}</h2>${mioDatiHtml()}${mioExtraHtml()}</div>
  ${mioT?`<div class="card dl" style="margin-top:12px"><h2 style="margin:0">Tessera e certificato</h2><div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px">${mioChip('Tessera',t.scadenza)}${mioChip('Certificato',t.certScad)}</div>
    <h3>Tessera</h3><dl>${d('Ente / federazione',t.ente)}${d('Numero tessera (ID atleta)',t.numero)}${d('Tipo di tessera',t.tipoTessera)}${d('Stagione',t.stagione)}${d('Data emissione',isD(t.emissione)?fmtD(t.emissione):'')}${d('Scadenza',isD(t.scadenza)?fmtD(t.scadenza):'')}${d('Associazione',t.associazione)}</dl>
    <h3>Certificato medico</h3><dl>${d('Tipo',t.certTipo)}${d('Scadenza',isD(t.certScad)?fmtD(t.certScad):'')}</dl>
    ${mioFiles()}${mioUpHtml()}</div>`:(mioErr?'':`<div class="card dl" style="margin-top:12px"><h2 style="margin:0">Tessera e certificato</h2><div class="mu" style="margin-top:6px">Non c’è ancora una tessera: caricala tu, l’admin la controlla e la conferma.</div>${mioUpHtml()}</div>`)}`}
/* riquadro fisso in cima alla sezione Atleti per l'atleta che ha anche accesso alla sezione (lettura/scrittura) */
function paintMio(){
  const c=$('#mioc');if(!c)return;
  if(!mioId&&!mioErr||isAdm()){c.innerHTML='';return}
  c.innerHTML=`<h3 style="margin:0 0 8px">La mia scheda</h3>`+mioCardsHtml();
  c.onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a==='mioSel')selMio(b.dataset.id,paintMio);else if(b.dataset.a==='mioEdit')openMioDati(paintMio);else mioAct(b.dataset.a,b)}}
function mioView(){
  const t=mioT||{},nome=((t.cognome||'')+' '+(t.nome||'')).trim()||t.title||'';
  const d=(l,v)=>v?`<dt>${l}</dt><dd>${esc(v)}</dd>`:'';
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Atleti</h2><span class="badge">La mia scheda</span></div></div>
  ${mioCardsHtml()}</div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a==='mioSel')selMio(b.dataset.id,mioView);else if(b.dataset.a==='mioEdit')openMioDati(mioView);else mioAct(b.dataset.a,b)}}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!mioP||isAdm()||document.querySelector('.ov'))return;
  loadMio().then(()=>{if(noAcc()){if(mioId)mioView()}else renderList()})});
const box2=(t,m)=>`<div class="card"><h2 style="margin:0 0 6px">${esc(t)}</h2><div class="mu">${esc(m)}</div></div>`;
/* ---------- modifiche dei dati da parte dell'atleta ----------
   L'atleta (account con la stessa email inserita dall'admin) modifica solo i suoi dati personali (ATL_EDIT).
   La scheda vera sta su Telegram, quindi le modifiche vanno in atletiModifiche/<idAtleta> = {campi:{campo:nuovoValore}, at, by}
   (solo i campi cambiati). L'admin le vede in giallo e le conferma (applicate alla scheda) o le scarta.
   atletiDati/<idAtleta> è la copia dei soli dati personali che l'atleta può leggere (senza note e conclusioni dell'allenatore):
   la scrive l'admin per gli atleti con email e si riallinea da sola. */
const ATL_KEYS=ATL_EDIT.map(x=>x[0]);
const datiOf=o=>{const r={};ATL_KEYS.forEach(k=>r[k]=String((o&&o[k])??'').trim());r.medaglie=Array.isArray(o&&o.medaglie)?o.medaglie:[];r.test=Array.isArray(o&&o.test)?o.test:[];return r};      /* medagliere e test servono all'atleta per vederli, non sono modificabili da lui direttamente */
const diffKeys=(it,campi)=>campi?ATL_KEYS.filter(k=>k in campi&&String(campi[k]??'').trim()!==String(it[k]??'').trim()):[];
const modKeys=it=>diffKeys(it,mods[it.id]&&mods[it.id].campi);
const noteOf=v=>[v.grado,v.categoria,v.peso&&v.peso+' kg',TIPO[v.tipo],v.allenatore,v.obiettivi,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300);
const synced2=new Map();
function syncDati(){
  if(!isAdm())return;
  items.forEach(it=>{
    if(!mailOf(it.id))return;
    const v=datiOf(it),sig=JSON.stringify(v);
    if(dati[it.id]&&JSON.stringify(datiOf(dati[it.id]))===sig)return;
    if(synced2.get(it.id)===sig)return;
    synced2.set(it.id,sig);
    setDoc(doc(db,'atletiDati',it.id),v).catch(()=>synced2.delete(it.id))})}
/* se dopo un salvataggio dell'admin i campi proposti coincidono con la scheda, la richiesta non serve più */
function cleanMods(id,v){const m=mods[id];if(m&&!diffKeys(v,m.campi).length)deleteDoc(doc(db,'atletiModifiche',id)).catch(()=>{})}
async function okMod(it){
  const M=mods[it.id]&&mods[it.id].campi,mk=modKeys(it);if(!M||!mk.length)return;
  const upd={};mk.forEach(k=>upd[k]=String(M[k]).trim());
  if('peso' in upd)upd.peso=upd.peso.replace(',','.');
  const merged={...it,...upd};
  upd.title=(merged.cognome||'')+' '+(merged.nome||'');upd.note=noteOf(merged);
  await updateDoc(doc(db,'sections',SEC,'items',it.id),upd);
  await setDoc(doc(db,'atletiDati',it.id),datiOf(merged));
  await deleteDoc(doc(db,'atletiModifiche',it.id))}
/* lato atleta */
let mioDati=null,mioMod={};
const mioBase=k=>String((mioDati?mioDati[k]:(items.find(i=>i.id===mioId)||{})[k])??'').trim();
const mioCur=k=>String((k in mioMod?mioMod[k]:mioBase(k))??'');
function openMioDati(after){
  apriDati({db,uid,soggetto:mioId,defs:ATL_EDIT,base:mioDati||(items.find(i=>i.id===mioId)||{}),mod:mioMod,after:c=>{mioMod=c;if(after)after()}})}
/* medagliere e test dell'atleta: li vede, e può aggiungere una voce che l'admin accetta o rifiuta */
const mioExtraHtml=()=>{
  const med=[...((mioDati&&mioDati.medaglie)||[])].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const ts=[...((mioDati&&mioDati.test)||[])].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  return `<h3>Medagliere</h3>${med.length?med.map(m=>`<div style="padding:4px 0">${esc(POSTO[m.posto]||m.posto)} · <b>${esc(m.gara)}</b>${m.data?` <span class="mu">${esc(fmtD(m.data))}</span>`:''}</div>`).join(''):'<div class="mu">Nessuna voce.</div>'}
    <div class="dact" style="justify-content:flex-start"><button class="btn ghost sm" data-a="mioMed">+ Aggiungi una gara o un risultato</button></div>
    <h3>Test fisici</h3>${ts.length?ts.slice(0,6).map(t=>`<div style="padding:4px 0"><b>${esc(fmtD(t.data))}</b><div class="mu">${esc((t.r||[]).map(r=>r.n+': '+r.v).join(' · '))}</div></div>`).join(''):'<div class="mu">Nessuna rilevazione.</div>'}
    <div class="dact" style="justify-content:flex-start"><button class="btn ghost sm" data-a="mioTest">+ Aggiungi una rilevazione</button></div>`};
const mioDatiHtml=()=>{
  const rows=ATL_EDIT.map(([k,l])=>{const v=mioCur(k);return `<dt>${l}</dt><dd style="white-space:pre-wrap">${v?esc(v):'<span class="mu">—</span>'}${k in mioMod?' <span class="chip">da confermare</span>':''}</dd>`}).join('');
  return `<h3>I miei dati</h3><dl>${rows}</dl>${Object.keys(mioMod).length?'<div class="mu" style="font-size:.8rem;margin-top:4px">Modifiche inviate: in attesa di conferma dell’admin.</div>':''}<div class="dact" style="justify-content:flex-start"><button class="btn ghost sm" data-a="mioEdit">Modifica i miei dati</button></div>`};
const noAcc=()=>{const p=perm();return p==='n'||p==='u'};
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';
const lines=s=>String(s||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
const uidn=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const p2=n=>String(n).padStart(2,'0');
const todayStr=()=>{const n=new Date();return n.getFullYear()+'-'+p2(n.getMonth()+1)+'-'+p2(n.getDate())};
const TIPO={agonista:'Agonista',dilettante:'Dilettante'};
const POSTO={'1':'🥇 1° posto','2':'🥈 2° posto','3':'🥉 3° posto','5':'5° posto','P':'Partecipazione'};
/* Tipi di test predefiniti (modificabili per ogni atleta quando si registra una rilevazione) */
const DEF_TEST=['CMJ','1RM p.piana+squat','Sprint 30m','Illinois Agility test','Test di Cooper','SJFT'];
const cadTxt=i=>+i.cadN>0?'ogni '+(+i.cadN)+(i.cadU==='s'?(+i.cadN===1?' settimana':' settimane'):(+i.cadN===1?' mese':' mesi')):'';

/* Tessera e certificato medico: li gestisce la sezione Tessere (qui si leggono soltanto, senza alert) */
const tessOf=id=>tess.find(t=>t.atleta===id)||null;
/* ID atleta = numero della tessera (sezione Tessere), aggiornato in automatico; per gli atleti senza tessera resta l'eventuale vecchio valore */
const idAtleta=i=>(tessOf(i.id)&&tessOf(i.id).numero)||i.idAtl||'';

/* Chip di stato del test: rosso quando l'alert è attivo */
function testChip(i){
  const s=testStato(i);
  if(!s)return '<span class="chip">Test: —</span>';
  if(s.due)return `<span class="chip bad">Test: ${s.late?'in ritardo':'da fare'}</span>`;
  if(s.g<=14)return `<span class="chip warn">Test ${testTesto(s.g)}</span>`;
  return `<span class="chip">Test: ${fmtD(s.data)}</span>`}

function allTestNames(){
  const s=new Set([...DEF_TEST,'Beep test','Peso']);
  items.forEach(i=>{(i.testTipi||[]).forEach(n=>s.add(n));(i.test||[]).forEach(t=>(t.r||[]).forEach(r=>s.add(r.n)))});
  return [...s].filter(Boolean).sort((a,b)=>a.localeCompare(b,'it'))}

/* ---------- struttura della pagina (creata una volta sola) ---------- */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca negli atleti" aria-label="Cerca negli atleti" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Atleti</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  <div id="mioc" style="margin-bottom:12px"></div>
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuovo atleta</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo dell'atleta">+</button></div>
    <div id="fb" hidden>
    <fieldset><legend>Dati anagrafici</legend>
      <div class="two"><div><label for="nm">Nome</label><input id="nm" type="text" autocomplete="off"></div><div><label for="cg">Cognome</label><input id="cg" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="sx">Sesso</label><select id="sx"><option value=""></option><option value="M">M</option><option value="F">F</option></select></div><div><label for="an">Anno di nascita</label><input id="an" type="number" inputmode="numeric" min="1900" max="2100" autocomplete="off"></div></div>
      <div class="two"><div><label for="gr">Grado</label><select id="gr"><option value=""></option>${GRADI_LAB.map(x=>`<option value="${x}">${x}</option>`).join('')}</select><div class="mu" style="font-size:.8rem;margin-top:4px">Dà accesso al materiale della scheda Esami fino a questo grado.</div></div><div><label for="ct">Categoria</label><input id="ct" type="text" list="lc" autocomplete="off"><datalist id="lc"></datalist></div></div>
      <div class="two"><div><label for="pe">Peso (kg)</label><input id="pe" type="text" inputmode="decimal" autocomplete="off"></div><div><label for="al">Altezza (cm)</label><input id="al" type="text" inputmode="numeric" autocomplete="off"></div></div>
      <div class="two"><div><label for="at">Allenatore</label><input id="at" type="text" list="la" autocomplete="off"><datalist id="la"></datalist></div>${isAdm()?'<div><label for="em">Email dell\'atleta (visibile solo all\'admin)</label><input id="em" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="mu" style="font-size:.8rem;margin-top:4px">Più atleti possono avere la stessa email (es. un genitore con più figli): da quell’account si vedono tutte le schede.</div></div>':''}</div>
      <label for="tp">Agonista o Dilettante</label><select id="tp"><option value=""></option><option value="agonista">Agonista</option><option value="dilettante">Dilettante</option></select>
    </fieldset>
    <fieldset><legend>Scheda tecnica</legend>
      <label for="ku">Kumi kata</label><input id="ku" type="text" autocomplete="off">
      <div class="two"><div><label for="tw">Tachi waza (una per riga)</label><textarea id="tw" style="min-height:110px"></textarea></div><div><label for="nw">Ne waza (una per riga)</label><textarea id="nw" style="min-height:110px"></textarea></div></div>
      <label for="rq">Richieste</label><textarea id="rq"></textarea>
      <p class="mu" style="margin:8px 0 0">Il medagliere si compila dalla scheda dell'atleta, dopo averlo salvato.</p>
    </fieldset>
    <fieldset><legend>Scheda fisica · cadenza dei test</legend>
      <div class="two"><div><label for="cn">Test ogni</label><input id="cn" type="number" inputmode="numeric" min="1" max="60" autocomplete="off"></div><div><label for="cu">Unità</label><select id="cu"><option value="s">Settimane</option><option value="m" selected>Mesi</option></select></div></div>
      <div class="two"><div><label for="px">Prossimo test (data alert)</label><input id="px" type="date"></div><div><label for="pv">Avvisa con anticipo di (giorni)</label><input id="pv" type="number" inputmode="numeric" min="0" max="90" autocomplete="off" placeholder="0"></div></div>
      <p class="mu" style="margin:8px 0 0">Se lasci vuota la data, si calcola da sola: ultimo test + cadenza. Dalla data alert la scheda Atleti diventa rossa nella Home. Le rilevazioni dei test (compreso l'SJFT) si registrano dalla scheda dell'atleta.</p>
      <label for="cc">Conclusioni</label><textarea id="cc"></textarea>
    </fieldset>
    <fieldset><legend>Obiettivi, monitoraggio e note</legend>
      <label for="ob">Obiettivi</label><textarea id="ob"></textarea>
      <label for="inf">Infortuni</label><textarea id="inf" style="min-height:70px"></textarea>
      <label for="nt">Note</label><textarea id="nt"></textarea>
      <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="fbk" style="width:auto;min-height:0"> Salva anche su Firebase</label>
    </fieldset>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva atleta</button><button class="btn ghost" id="cx" hidden>Annulla modifica</button></div></div></div>`:''}
  <div class="card" id="ls" style="padding:8px 14px"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#ls').onclick=e=>{const b=e.target.closest('[data-id]');if(b)openDetail(b.dataset.id)};
  if(w){$('#ftg').onclick=()=>setForm($('#fb').hidden);$('#sv').onclick=save;$('#cx').onclick=resetForm}
}
function setForm(o){
  const b=$('#fb'),t=$('#ftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?"Chiudi il modulo dell'atleta":"Apri il modulo dell'atleta")}
const F=[['nm','nome'],['cg','cognome'],['sx','sesso'],['an','anno'],['gr','grado'],['ct','categoria'],['pe','peso'],['al','altezza'],['at','allenatore'],['tp','tipo'],
  ['ku','kumi'],['tw','tachi'],['nw','ne'],['rq','richieste'],['cn','cadN'],['cu','cadU'],['px','prossimo'],['pv','preavviso'],['cc','conclusioni'],['ob','obiettivi'],['inf','infortuni'],['nt','annotazioni']];
function gradoSel(v){const s=$('#gr');if(!s)return;s.querySelectorAll('.leg').forEach(o=>o.remove());const c=gradoCanon(v);
  if(c&&!GRADI_LAB.includes(c)){const o=document.createElement('option');o.className='leg';o.value=c;o.textContent=c+' (non in elenco)';s.append(o)}s.value=c}
function resetForm(){
  setForm(false);editing=null;F.forEach(([e])=>$('#'+e).value='');gradoSel('');if($('#em'))$('#em').value='';$('#cu').value='m';$('#fbk').checked=false;
  $('#ft').textContent='Nuovo atleta';$('#sv').textContent='Salva atleta';$('#cx').hidden=true;$('#er').textContent=''}
function edit(it){
  setForm(true);editing=it.id;F.forEach(([e,k])=>$('#'+e).value=it[k]??'');gradoSel(it.grado);if($('#em'))$('#em').value=mailOf(it.id);if(!$('#cu').value)$('#cu').value='m';$('#fbk').checked=!!it.fb;
  $('#ft').textContent='Modifica atleta';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

async function save(){
  const v={};F.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  v.peso=v.peso.replace(',','.');
  const er=$('#er');
  if(!v.nome||!v.cognome){er.textContent='Inserisci nome e cognome.';return}
  if(v.anno&&!(/^\d{4}$/.test(v.anno)&&+v.anno>=1900&&+v.anno<=new Date().getFullYear())){er.textContent='L’anno di nascita deve avere 4 cifre.';return}
  if(v.peso&&!/^\d{1,3}(\.\d{1,2})?$/.test(v.peso)){er.textContent='Il peso deve essere un numero (es. 66.5).';return}
  if(v.altezza&&!/^\d{2,3}$/.test(v.altezza)){er.textContent='L’altezza va indicata in centimetri (es. 172).';return}
  if(v.cadN&&!(+v.cadN>0)){er.textContent='La cadenza dei test deve essere un numero maggiore di zero.';return}
  if(v.cadN&&!v.cadU)v.cadU='m';
  const em=$('#em')?$('#em').value.trim().toLowerCase():null;
  if(em&&!MAIL_RE.test(em)){er.textContent='L’indirizzo email non è valido (es. nome@dominio.it).';return}
  if(em){
    const altri=Object.keys(mails).filter(k=>k!==editing&&mailOf(k).toLowerCase()===em);
    if(altri.length&&!confirm('Questa email è già collegata a: '+altri.map(k=>nameOf(items.find(i=>i.id===k)||{})||'un altro atleta').join(', ')+'.\n\nVuoi collegare anche questo atleta alla stessa email? (per esempio un genitore con più figli: dal suo account vedrà tutte le schede)'))return}
  const data={...v,fb:$('#fbk').checked,title:v.cognome+' '+v.nome,
    note:noteOf(v)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    let id=editing;
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else{const r=await addDoc(col,{...data,test:[],medaglie:[],by:uid,at:serverTimestamp()});id=r&&r.id}
    if(em!==null&&id)await saveMail(id,em);
    if(id)cleanMods(id,v);
    resetForm();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}

/* ---------- salvataggio di una parte della scheda (test, SJFT, medagliere) ---------- */
async function patch(it,p){
  await updateDoc(doc(db,'sections',SEC,'items',it.id),p);
  Object.assign(it,p);paintDetail();renderList()}
/* dopo una rilevazione la data alert si ricalcola da sola (ultimo test + cadenza) */
function nextAfter(it,upd){
  const rec={...it,...upd},last=ultimoTest(rec),out={};
  if(!isD(last))return out;
  if(+it.cadN>0)out.prossimo=addCad(last,+it.cadN,it.cadU||'m');
  else if(isD(it.prossimo)&&it.prossimo<=last)out.prossimo='';
  return out}

/* ---------- finestra di dialogo generica ---------- */
function modal(title,body,{ok='Salva',onSave,onDel}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact">${onDel?'<button class="btn ghost" data-del style="margin-right:auto">Elimina</button>':''}<button class="btn ghost" data-x>Annulla</button><button class="btn" data-ok>${ok}</button></div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  const run=async fn=>{er.textContent='';try{if(await fn(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Salvataggio non riuscito. Riprova.'}};
  o.querySelector('[data-ok]').onclick=()=>run(onSave);
  if(onDel)o.querySelector('[data-del]').onclick=()=>{if(confirm('Eliminare questa voce? L’operazione non si può annullare.'))run(onDel)};
  document.body.append(o);return o}

/* Rilevazione test fisici: i tipi di test sono modificabili (nome, aggiunta, rimozione) */
function openTest(it,sess){
  const names=(it.testTipi&&it.testTipi.length?it.testTipi:DEF_TEST);
  let rows=sess?(sess.r||[]).map(r=>({n:r.n,v:r.v,sj:r.sj})):names.map(n=>({n,v:''}));
  const body=`<label for="td" style="margin-top:8px">Data del test</label><input id="td" type="date" value="${esc(sess?sess.data:todayStr())}">
    <label>Test e risultati</label><div id="tr"></div><button class="btn ghost sm" id="ta" type="button">+ Aggiungi test</button>
    <p class="mu" style="margin:8px 0 0">Puoi cambiare il nome di un test (es. Beep test al posto del test di Cooper) o toglierlo: la lista scelta resta per le prossime rilevazioni di questo atleta. Le righe senza risultato non vengono salvate.</p>
    <datalist id="lt">${allTestNames().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
  const o=modal(sess?'Modifica rilevazione':'Nuova rilevazione',body,{
    onDel:sess?async()=>{const list=(it.test||[]).filter(t=>t.id!==sess.id);await patch(it,{test:list,...nextAfter(it,{test:list})})}:null,
    onSave:async(o,er)=>{
      const data=o.querySelector('#td').value;
      if(!isD(data)){er.textContent='Indica la data del test.';return false}
      const r=rows.map(x=>({n:x.n.trim(),v:x.v.trim(),...(isSj(x.n)&&x.sj?{sj:x.sj}:{})})).filter(x=>x.n&&x.v);
      if(!r.length){er.textContent='Inserisci almeno un risultato.';return false}
      const tipi=[...new Set(rows.map(x=>x.n.trim()).filter(Boolean))];
      const list=sess?(it.test||[]).map(t=>t.id===sess.id?{...t,data,r}:t):[...(it.test||[]),{id:uidn(),data,r}];
      await patch(it,{test:list,testTipi:tipi,...nextAfter(it,{test:list})})}});
  const sjBlock=(x,i)=>`<div class="sj" style="margin:0 0 4px">${[['a','Lanci A (15 s)'],['b','Lanci B (30 s)'],['c','Lanci C (30 s)'],['f1','FC subito'],['f2','FC dopo 1 min']].map(([k,l])=>`<input type="number" inputmode="numeric" min="0" data-k="${i}" data-s="${k}" placeholder="${l}" aria-label="${l}" value="${esc((x.sj||{})[k]??'')}">`).join('')}</div><div class="mu" style="margin:0 0 8px;font-size:.8rem">SJFT: con lanci e frequenza cardiaca l’indice si scrive da solo nel risultato.</div>`;
  const draw=()=>{o.querySelector('#tr').innerHTML=rows.map((x,i)=>`<div class="rw"><input type="text" list="lt" data-n="${i}" placeholder="Test" value="${esc(x.n)}" aria-label="Nome del test"><input type="text" data-v="${i}" placeholder="Risultato" value="${esc(x.v)}" aria-label="Risultato"><button class="xb" type="button" data-r="${i}" aria-label="Togli questo test">✕</button></div>${isSj(x.n)?sjBlock(x,i):''}`).join('')};
  draw();
  o.querySelector('#tr').addEventListener('input',e=>{const n=e.target.dataset.n,v=e.target.dataset.v,k=e.target.dataset.k;
    if(k!==undefined){const r=rows[+k];r.sj={...(r.sj||{}),[e.target.dataset.s]:e.target.value};const ix=sjIdx(r.sj);
      if(ix){r.v='Indice '+ix+' (lanci '+sjTot(r.sj)+', FC '+r.sj.f1+'/'+r.sj.f2+')';o.querySelector('[data-v="'+k+'"]').value=r.v}}
    if(n!==undefined)rows[+n].n=e.target.value;if(v!==undefined)rows[+v].v=e.target.value});
  o.querySelector('#tr').addEventListener('change',e=>{if(e.target.dataset.n!==undefined)draw()});
  o.querySelector('#tr').addEventListener('click',e=>{const b=e.target.closest('[data-r]');if(b){rows.splice(+b.dataset.r,1);draw()}});
  o.querySelector('#ta').onclick=()=>{rows.push({n:'',v:''});draw();const l=o.querySelectorAll('[data-n]');l[l.length-1].focus()}}

/* SJFT (è un test come gli altri, nella lista dei test): lanci nelle 3 serie (15 s, 30 s, 30 s), FC subito dopo e dopo 1 minuto; indice = (FC subito + FC dopo 1') / lanci totali */
const isSj=n=>/sjft|special judo/i.test(n||'');
const sjTot=s=>(+s.a||0)+(+s.b||0)+(+s.c||0);
const sjIdx=s=>{const t=sjTot(s),h=(+s.f1||0)+(+s.f2||0);return t>0&&h>0?(h/t).toFixed(2):''};
function openMed(it){
  const body=`<label for="md" style="margin-top:8px">Data</label><input id="md" type="date" value="${todayStr()}">
    <label for="mg">Gara</label><input id="mg" type="text" autocomplete="off">
    <label for="mp">Risultato</label><select id="mp">${Object.entries(POSTO).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select>`;
  modal('Nuova medaglia o risultato',body,{onSave:async(o,er)=>{
    const data=o.querySelector('#md').value,gara=o.querySelector('#mg').value.trim(),posto=o.querySelector('#mp').value;
    if(!gara){er.textContent='Indica il nome della gara.';return false}
    await patch(it,{medaglie:[...(it.medaglie||[]),{id:uidn(),data:isD(data)?data:'',gara,posto}]})}})}

/* ---------- scheda di dettaglio ---------- */
function openDetail(id){
  if(!items.find(x=>x.id===id))return;
  const o=document.createElement('div');o.className='ov';
  o.innerHTML='<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda atleta"></div>';
  const close=()=>{o.remove();detail=null;document.removeEventListener('keydown',esc_)};
  const esc_=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',esc_);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.firstElementChild.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b||!detail)return;
    const it=items.find(x=>x.id===detail.id);if(!it)return;
    const a=b.dataset.a,i=b.dataset.i;
    if(a==='x')close();
    else if(['dt','dc','ot','oc'].includes(a)){if(mioIds.includes(it.id)){await ensureMio(it.id);mioAct(a)}}
    else if(a==='mioEdit'){if(mioIds.includes(it.id)&&!isAdm()){await ensureMio(it.id);openMioDati(paintDetail)}}
    else if(a==='okmod'){if(isAdm())try{await okMod(it)}catch(x){console.error(x);alert('Impossibile applicare le modifiche. Controlla che Telegram sia collegato e riprova.')}}
    else if(a==='nomod'){if(isAdm()&&confirm('Scartare le modifiche proposte dall’atleta?'))try{await deleteDoc(doc(db,'atletiModifiche',it.id))}catch(x){console.error(x);alert('Operazione non riuscita.')}}
    else if(a==='edit'){close();edit(it)}
    else if(a==='del'){
      if(!confirm('Eliminare '+nameOf(it)+'? La scheda va nel Cestino (recuperabile per 30 giorni); l’email dell’atleta e il collegamento al suo account vengono invece rimossi subito.'))return;
      try{const em=mailOf(it.id);await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(isAdm()){if(mails[it.id])await deleteDoc(doc(db,'atletiMail',it.id)).catch(()=>{});if(em)await scriviChiave(em,idsOf(em).filter(k=>k!==it.id)).catch(()=>{});await deleteDoc(doc(db,'atletiDati',it.id)).catch(()=>{});await deleteDoc(doc(db,'atletiModifiche',it.id)).catch(()=>{})};if(editing===it.id)resetForm();close()}
      catch(x){console.error(x);alert('Eliminazione non riuscita.')}}
    else if(perm()!=='w')return;
    else if(a==='addT')openTest(it);
    else if(a==='editT')openTest(it,(it.test||[]).find(t=>t.id===i));
    else if(a==='addM')openMed(it);
    else if(a==='delM'){if(confirm('Togliere questa voce dal medagliere?'))try{await patch(it,{medaglie:(it.medaglie||[]).filter(m=>m.id!==i)})}catch(x){console.error(x);alert('Operazione non riuscita.')}}});
  detail={id,o};document.body.append(o);paintDetail();
  o.querySelector('[data-a="x"]').focus()}
function paintDetail(){
  if(!detail||!document.body.contains(detail.o))return;
  const it=items.find(x=>x.id===detail.id);
  if(!it){detail.o.remove();detail=null;return}
  const w=perm()==='w',c=detail.o.firstElementChild;
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v!==''&&v!=null?esc(v):'<span class="mu">—</span>'}</dd>`;
  const bl=v=>v?`<div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem">${esc(v)}</div>`:'<div class="mu">—</div>';
  const ul=s=>{const l=lines(s);return l.length?`<ul class="ls">${l.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<div class="mu">—</div>'};
  const tt=tessOf(it.id),ts=testStato(it);
  /* modifiche proposte dall'atleta: all'admin in giallo (con il valore di prima), all'atleta solo il nuovo valore */
  const adm=isAdm(),ovc=adm?(mods[it.id]&&mods[it.id].campi):(it.id===mioId?mioMod:null),mk=diffKeys(it,ovc);
  const nv=k=>mk.includes(k)?ovc[k]:it[k];
  const pri=(k,f)=>`<div class="mu" style="font-size:.8rem;white-space:pre-wrap">Prima: ${it[k]?esc(f?f(it[k]):it[k]):'vuoto'}</div>`;
  const dm=(l,k,f)=>{const v=nv(k),t=v!==''&&v!=null?esc(f?f(v):v):'<span class="mu">—</span>';return mk.includes(k)&&adm?`<dt class="mod">${l}</dt><dd class="mod">${t}${pri(k,f)}</dd>`:`<dt>${l}</dt><dd>${t}</dd>`};
  const bm=k=>mk.includes(k)&&adm?`<div class="mmod">${bl(nv(k))}${pri(k)}</div>`:bl(nv(k));
  const at=adm&&mods[it.id]&&mods[it.id].at&&mods[it.id].at.toDate?mods[it.id].at.toDate().toLocaleString('it-IT',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'';
  const modBar=adm&&mk.length?`<div class="modbar"><b>L’atleta ha modificato i suoi dati</b>${at?` <span class="mu">(${esc(at)})</span>`:''}<div class="mu">Ogni campo si accetta o si rifiuta da solo, con il valore prima e dopo.</div><div class="dact" style="margin-top:8px"><a class="btn sm" href="richieste.html#${esc(it.id)}" style="text-decoration:none">Rivedi le richieste</a></div></div>`
    :(!adm&&mioIds.includes(it.id)?`<div class="dact" style="justify-content:flex-start;margin:8px 0 0"><button class="btn ghost sm" data-a="mioEdit">Modifica i miei dati</button></div>${mk.length?'<div class="mu" style="font-size:.8rem;margin-top:4px">Modifiche inviate: in attesa di conferma dell’admin.</div>':''}`:'');
  /* test fisici: una colonna per rilevazione (le più recenti), una riga per test */
  const sess=[...(it.test||[])].sort((a,b)=>b.data.localeCompare(a.data)).slice(0,6);
  const tn=[...new Set([...(it.testTipi||DEF_TEST),...sess.flatMap(s=>(s.r||[]).map(r=>r.n))])];
  const tbl=sess.length?`<div class="tb"><table><thead><tr><th>Test</th>${sess.map(s=>`<th>${w?`<button data-a="editT" data-i="${esc(s.id)}" aria-label="Modifica la rilevazione del ${esc(fmtD(s.data))}">${esc(fmtD(s.data))}</button>`:esc(fmtD(s.data))}</th>`).join('')}</tr></thead><tbody>${tn.map(n=>`<tr><td>${esc(n)}</td>${sess.map(s=>{const r=(s.r||[]).find(x=>x.n===n);return `<td>${r?esc(r.v):'<span class="mu">—</span>'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="mu">Nessuna rilevazione registrata.</div>';
  const med=[...(it.medaglie||[])].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const cnt=k=>med.filter(m=>m.posto===k).length;
  const medH=med.length?`<div style="margin:2px 0 6px"><b>🥇 ${cnt('1')} · 🥈 ${cnt('2')} · 🥉 ${cnt('3')}</b></div>`+med.map(m=>`<div class="row" style="padding:6px 0"><div>${esc(POSTO[m.posto]||m.posto)} · <b>${esc(m.gara)}</b>${m.data?` <span class="mu">${esc(fmtD(m.data))}</span>`:''}</div>${w?`<button class="xb" data-a="delM" data-i="${esc(m.id)}" aria-label="Togli dal medagliere">✕</button>`:''}</div>`).join(''):'<div class="mu">Nessuna medaglia registrata.</div>';
  c.innerHTML=`<h2 style="margin:0">${esc(nameOf(it))}${it.grado?`<span class="gr">${esc(it.grado)}</span>`:''}</h2>
    <div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px">${it.tipo?`<span class="chip">${esc(TIPO[it.tipo]||it.tipo)}</span>`:''}${testChip(it)}</div>
    ${modBar}<h3>Dati anagrafici</h3><dl>${dm('Nome','nome')}${dm('Cognome','cognome')}${dm('Sesso','sesso')}${dm('Anno di nascita','anno')}${dd('Grado',it.grado)}${dd('Categoria',it.categoria)}${dm('Peso','peso',v=>v?v+' kg':'')}${dm('Altezza','altezza',v=>v?v+' cm':'')}${dd('Allenatore',it.allenatore)}${dd('ID atleta (n. tessera)',idAtleta(it))}${dd('Tipo',TIPO[it.tipo]||'')}${isAdm()?dd('Email (solo admin)',mailOf(it.id)):''}</dl>
    <h3>Tecniche</h3><dl>${dd('Kumi kata',it.kumi)}</dl><div class="cols"><div><div class="mu" style="margin-top:6px">Tachi waza</div>${ul(it.tachi)}</div><div><div class="mu" style="margin-top:6px">Ne waza</div>${ul(it.ne)}</div></div>
    <h3>Medagliere${w?'<button class="btn ghost sm" data-a="addM">+ Aggiungi</button>':''}</h3>${medH}
    <h3>Richieste</h3>${bm('richieste')}
    <h3>Obiettivi</h3>${bm('obiettivi')}
    <h3>Cadenza dei test</h3><dl>${dd('Cadenza',cadTxt(it))}${dd('Ultimo test',isD(ultimoTest(it))?fmtD(ultimoTest(it)):'')}<dt>Prossimo test</dt><dd>${ts?esc(fmtD(ts.data))+` <span class="chip ${ts.due?'bad':ts.g<=14?'warn':''}">${ts.due?(ts.late?'in ritardo di '+(-ts.g)+' g':'da fare'):testTesto(ts.g)}</span>`:'<span class="mu">— (imposta cadenza o data)</span>'}</dd>${dd('Avviso',+it.preavviso>0?(+it.preavviso)+' giorni prima':'dalla data del test')}</dl>
    <h3>Monitoraggio test${w?'<button class="btn ghost sm" data-a="addT">+ Nuova rilevazione</button>':''}</h3>${tbl}
    <h3>Conclusioni</h3>${bl(it.conclusioni)}
    <h3>Tessera e certificato medico</h3>${tt&&(tt.numero||tt.scadenza||tt.certScad)?`<dl>${dd('ID atleta (n. tessera)',tt.numero)}${dd('Ente',tt.ente)}${dd('Scadenza tessera',isD(tt.scadenza)?fmtD(tt.scadenza):'')}${dd('Scadenza certificato medico',isD(tt.certScad)?fmtD(tt.certScad):'')}</dl><div class="mu" style="font-size:.8rem;margin-top:4px">Dati aggiornati in automatico dalla sezione Tessere.</div>`:'<div class="mu">Atleta non ancora tesserato (nessuna tessera nella sezione Tessere).</div>'}${it.id===mioId?mioFiles():''}
    <h3>Salute</h3><dl>${dm('Infortuni','infortuni')}</dl>
    <h3>Note</h3>${bl(it.annotazioni)}<dl>${dd('Firebase',it.fb?'Salvato anche su Firebase':'Solo su Telegram')}</dl>
    <div class="dact">${w?'<button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="edit">Modifica dati</button>':''}<button class="btn" data-a="x">Chiudi</button></div>`;
  c.classList.toggle('modc',adm&&mk.length>0)}

/* ---------- elenco ---------- */
function renderList(){
  const ls=$('#ls');if(!ls)return;
  const t=q.trim().toLowerCase();
  const hay=i=>[nameOf(i),i.sesso,i.anno,i.grado,i.categoria,i.peso,i.allenatore,idAtleta(i),isAdm()?mailOf(i.id):'',TIPO[i.tipo],i.kumi,i.tachi,i.ne,i.richieste,i.obiettivi,i.conclusioni,i.infortuni,i.annotazioni,...(i.medaglie||[]).map(m=>m.gara),...(i.test||[]).flatMap(s=>(s.r||[]).map(r=>r.n))].filter(Boolean).join(' ').toLowerCase();
  const all=items.filter(i=>i.nome||i.cognome||i.title);
  const ok={all:()=>true,test:testDaFare,agonista:i=>i.tipo==='agonista',dilettante:i=>i.tipo==='dilettante'};
  const list=all.filter(i=>(!t||hay(i).includes(t))&&(ok[flt]||ok.all)(i))
    .sort((a,b)=>(a.cognome||nameOf(a)).localeCompare(b.cognome||nameOf(b),'it')||(a.nome||'').localeCompare(b.nome||'','it'));
  const nd=all.filter(testDaFare).length;
  ls.innerHTML=`<div class="flt"><select id="fs" aria-label="Filtro elenco"><option value="all" ${flt==='all'?'selected':''}>Tutti (${all.length})</option><option value="test" ${flt==='test'?'selected':''}>Test da fare (${nd})</option><option value="agonista" ${flt==='agonista'?'selected':''}>Agonisti (${all.filter(ok.agonista).length})</option><option value="dilettante" ${flt==='dilettante'?'selected':''}>Dilettanti (${all.filter(ok.dilettante).length})</option></select></div>`+
  (list.length?list.map(i=>{
    const sub=[i.categoria,i.peso&&i.peso+' kg',i.anno,i.allenatore&&'all. '+i.allenatore].filter(Boolean).join(' · ');
    const tt=tessOf(i.id);
    const mm=modKeys(i).length;
    return `<button class="tr${testDaFare(i)?' alarm':''}${mm?' mod':''}" data-id="${esc(i.id)}" aria-label="Apri la scheda di ${esc(nameOf(i))}"><div class="inf"><div><b>${esc(nameOf(i))}</b>${i.grado?`<span class="gr">${esc(i.grado)}</span>`:''}</div><div class="mu">${esc(sub||'—')}</div></div><div class="chips">${mm?'<span class="chip mdc">Modificato dall’atleta</span>':''}${i.tipo?`<span class="chip">${esc(TIPO[i.tipo]||i.tipo)}</span>`:''}${testChip(i)}${tt&&tt.numero?`<span class="chip ok">Tesserato · ${esc(tt.numero)}</span>`:''}</div></button>`}).join('')
  :`<div class="mu" style="padding:8px 0">${t||flt!=='all'?'Nessun risultato.':'Nessun atleta registrato.'+(perm()==='w'?' Compila il modulo qui sopra.':'')}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
  if(perm()==='w'){
    const fill=(id,k)=>{const dl=$('#'+id);if(dl)dl.innerHTML=[...new Set(all.map(i=>i[k]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'it')).map(v=>`<option value="${esc(v)}">`).join('')};
    fill('lg','grado');fill('lc','categoria');fill('la','allenatore')}
  syncDati();paintMio();paintDetail()}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!mioP)mioP=loadMio().then(()=>{if(!noAcc())renderList()});
      if(noAcc()){shellFor='';if(memo)memo.setAccess('n',false);mioP.then(()=>{if(!noAcc())return;if(mioId||mioErr)mioView();else app.innerHTML=box(perm()==='u'?'Account non collegato':'Nessun accesso',perm()==='u'?'Questo account non è collegato a nessuna scheda atleta. Chiedi all’admin di inserire la tua email nella scheda Atleti.':'Non hai i permessi per questa sezione. Chiedi all’admin.')});return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(isAdm()&&!unsubs.mailSub){unsubs.mailSub=1;
        unsubs.push(onSnapshot(collection(db,'atletiMail'),s=>{mails={};s.docs.forEach(d=>mails[d.id]=d.data());syncKeys();renderList()},()=>{mails={}}));
        unsubs.push(onSnapshot(collection(db,'atletiDati'),s=>{dati={};s.docs.forEach(d=>dati[d.id]=d.data());renderList()},()=>{dati={}}));
        unsubs.push(onSnapshot(collection(db,'atletiModifiche'),s=>{mods={};s.docs.forEach(d=>mods[d.id]=d.data());renderList()},()=>{mods={}}))}
      if(!unsubs.itemsSub){unsubs.itemsSub=1;
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
        unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tess=s.docs.map(d=>({id:d.id,...d.data()})).filter(t=>t.kind==='tessera');renderList()},()=>{tess=[]}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
