import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,setDoc,serverTimestamp} from "./fsx.js";
import {doc as rdoc,collection as rcollection,getDoc as rgetDoc,getDocs as rgetDocs,onSnapshot as ronSnap} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {showPreview,saveBlob,guessMime} from "./file-tools.js";
import {TEC_EDIT,apriDati,apriCarica,mieRichieste,richiesteHtml,annullaRichiesta,valTxt} from "./richieste.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {tesName,rigaBreve,sumTes,tesserini} from "./tesserini.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='tecnici';
let auth,db,col,uid=null,me=null,items=[],tess=[],q='',flt='all',unsubs=[],shellFor='',editing=null,memo=null,started=false,tessStarted=false,mails={},mods={},richAll=[],mioState='',mioId='',mioDati=null,mioMod={},mioT=null,mioTes=[],mioFiles={},mioRich=[],mioErr=false;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const permT=()=>me?(me.admin?'w':((me.perms||{}).tessere||'n')):'n';
const fmtD=d=>String(d||'').split('-').reverse().join('/');
const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
const age=d=>{if(!isD(d))return '';const b=new Date(d+'T12:00:00'),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a>=0&&a<120?a:''};
const quals=s=>String(s||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
const isAdm=()=>!!(me&&me.admin);
const noAcc=()=>{const p=perm();return p==='n'||p==='u'};
const mailOf=id=>(mails[id]&&mails[id].email)||'';
const MAIL_RE=/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/;
const pend=id=>!!((mods[id]&&Object.keys(mods[id].campi||{}).length)||richAll.some(r=>r.soggetto===id));
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';

/* Email del tecnico: solo admin. Sta in tecniciMail/<idTecnico> (leggibile solo dall'admin); tecniciEmail/<email> = {tecnici:[id,…]} serve all'account loggato per trovare la propria scheda. */
const idsOf=email=>Object.keys(mails).filter(k=>mailOf(k)&&mailOf(k).toLowerCase()===String(email).toLowerCase());
async function scriviChiave(email,ids){
  if(!ids.length)await deleteDoc(doc(db,'tecniciEmail',email)).catch(()=>{});
  else await setDoc(doc(db,'tecniciEmail',email),{tecnici:ids})}
async function saveMail(id,email){
  if(!isAdm())return;
  const old=mailOf(id);
  if(email){
    await setDoc(doc(db,'tecniciMail',id),{email,by:uid,at:serverTimestamp()});
    await scriviChiave(email,[...new Set([...idsOf(email).filter(k=>k!==id),id])]);
    if(old&&old.toLowerCase()!==email.toLowerCase())await scriviChiave(old,idsOf(old).filter(k=>k!==id)).catch(()=>{})}
  else if(mails[id]){
    await deleteDoc(doc(db,'tecniciMail',id));
    if(old)await scriviChiave(old,idsOf(old).filter(k=>k!==id)).catch(()=>{});
    await deleteDoc(doc(db,'atletiDati',id)).catch(()=>{});await deleteDoc(doc(db,'atletiModifiche',id)).catch(()=>{})}}
/* copia dei dati personali che il tecnico può leggere (atletiDati/<id>), per i tecnici con email: si riallinea da sola (solo admin) */
const sigDati=new Map();
function syncDati(){
  if(!isAdm())return;
  items.forEach(it=>{
    if(!mailOf(it.id))return;
    const v={};TEC_EDIT.forEach(([k])=>v[k]=String(it[k]??'').trim());
    const sig=JSON.stringify(v);if(sigDati.get(it.id)===sig)return;sigDati.set(it.id,sig);
    setDoc(doc(db,'atletiDati',it.id),v).catch(()=>sigDati.delete(it.id))})}

/* Scadenza: scaduta, in scadenza (entro 30 giorni) o valida */
function stato(d){
  if(!isD(d))return null;
  const days=Math.floor((new Date(d+'T23:59:59')-new Date())/864e5);
  return days<0?{k:'bad',t:'scaduto'}:days<=30?{k:'warn',t:'scade tra '+(days+1)+' g'}:{k:'ok',t:'valido'}}
const chip=(lab,d)=>{const s=stato(d);return s?`<span class="chip ${s.k}">${lab}: ${s.t}</span>`:`<span class="chip">${lab}: —</span>`};
/* Tessera, certificato medico e tesserini vivono nella sezione Tessere (stesse regole degli atleti); qui si leggono.
   I vecchi campi scritti in questa scheda (tessScad, certScad…) valgono solo finché non c'è la tessera in Tessere. */
const tOf=id=>tess.find(x=>x.kind==='tessera'&&x.atleta===id)||null;
const zOf=id=>tesserini(tess,id);
const dTess=i=>{const t=tOf(i.id);return t?t.scadenza:i.tessScad},dCert=i=>{const t=tOf(i.id);return t?t.certScad:i.certScad};
const needs=i=>[dTess(i),dCert(i),...zOf(i.id).map(z=>z.scadenza)].some(d=>['bad','warn'].includes((stato(d)||{}).k));

/* Struttura della pagina creata una volta sola, così il modulo non si perde quando l'elenco si aggiorna */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca nei tecnici" aria-label="Cerca nei tecnici" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Tecnici</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  <div id="mioc" style="margin-bottom:12px"></div>
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuovo tecnico</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo del tecnico">+</button></div>
    <div id="fb" hidden>
    <fieldset><legend>Anagrafica</legend>
      <div class="two"><div><label for="nm">Nome</label><input id="nm" type="text" autocomplete="off"></div><div><label for="cg">Cognome</label><input id="cg" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="nas">Data di nascita</label><input id="nas" type="date"></div><div><label for="cf">Codice fiscale</label><input id="cf" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></div></div>
      ${isAdm()?'<label for="em">Email del tecnico (visibile solo all’admin: gli permette di entrare e caricare i propri file e dati)</label><input id="em" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false">':''}
    </fieldset>
    <p class="mu" style="margin:10px 0 0">Tessera, certificato medico e tesserini (albo cinture nere, albo qualifiche, altre qualifiche) si inseriscono nella sezione ${permT()==='w'?'<a href="tessere.html">Tessere</a>':'Tessere'}, con le stesse regole degli atleti.</p>
    <fieldset><legend>Informazioni</legend>
      <label for="inf">Info</label><textarea id="inf"></textarea>
      <label for="nt">Note</label><textarea id="nt"></textarea>
      <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="fbk" style="width:auto;min-height:0"> Salva anche su Firebase</label>
    </fieldset>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva tecnico</button><button class="btn ghost" id="cx" hidden>Annulla modifica</button></div></div></div>`:''}
  <div class="card" id="ls" style="padding:8px 14px"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#ls').onclick=e=>{const b=e.target.closest('[data-id]');if(b)openDetail(b.dataset.id)};
  if(w){
    $('#ftg').onclick=()=>setForm($('#fb').hidden);
    $('#sv').onclick=save;$('#cx').onclick=resetForm;
  }
}
function setForm(o){
  const b=$('#fb'),t=$('#ftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?'Chiudi il modulo del tecnico':'Apri il modulo del tecnico')}
const F=[['nm','nome'],['cg','cognome'],['nas','nascita'],['cf','cf'],['inf','info'],['nt','annotazioni']];
function resetForm(){
  setForm(false);editing=null;F.forEach(([e])=>$('#'+e).value='');if($('#em'))$('#em').value='';$('#fbk').checked=false;
  $('#ft').textContent='Nuovo tecnico';$('#sv').textContent='Salva tecnico';$('#cx').hidden=true;$('#er').textContent=''}
function edit(it){
  setForm(true);editing=it.id;F.forEach(([e,k])=>$('#'+e).value=it[k]||'');if($('#em'))$('#em').value=mailOf(it.id);$('#fbk').checked=!!it.fb;
  $('#ft').textContent='Modifica tecnico';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

async function save(){
  const v={};F.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  v.cf=v.cf.toUpperCase().replace(/\s+/g,'');
  const er=$('#er');
  if(!v.nome||!v.cognome){er.textContent='Inserisci nome e cognome.';return}
  if(v.cf&&!/^[A-Z0-9]{16}$/.test(v.cf)){er.textContent='Il codice fiscale deve avere 16 caratteri (lettere e cifre).';return}
  if(v.cf&&items.some(i=>i.id!==editing&&(i.cf||'')===v.cf)){er.textContent='Esiste già un tecnico con questo codice fiscale.';return}
  const em=$('#em')?$('#em').value.trim():null;
  if(em&&!MAIL_RE.test(em)){er.textContent='L’email non è valida.';return}
  const data={...v,fb:$('#fbk').checked,title:v.cognome+' '+v.nome,
    note:[v.cf,v.info,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    let id=editing;
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else id=(await addDoc(col,{...data,by:uid,at:serverTimestamp()})).id;
    if(em!==null&&em!==mailOf(id))await saveMail(id,em);
    resetForm();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}

/* ---------- scheda di dettaglio ---------- */
function tesBloc(it){
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v?esc(v):'<span class="mu">—</span>'}</dd>`;
  const sc=(l,d)=>{const s=stato(d);return `<dt>${l}</dt><dd>${isD(d)?esc(fmtD(d)):'<span class="mu">—</span>'}${s?` <span class="chip ${s.k}">${s.t}</span>`:''}</dd>`};
  if(permT()==='n')return '<h3>Tessera, certificato e tesserini</h3><div class="mu">Si trovano nella sezione Tessere, a cui non hai accesso.</div>';
  const t=tOf(it.id),L=zOf(it.id),leg=!t&&(it.idTec||it.tessera||it.tessScad||it.certScad);
  const lnk=`<div style="margin-top:8px"><a class="btn ghost sm" href="tessere.html#${encodeURIComponent(it.id)}" style="text-decoration:none">${permT()==='w'?'Gestisci in Tessere':'Apri in Tessere'}</a></div>`;
  return `<h3>Tessera</h3>${t&&(t.numero||t.scadenza)?`<dl>${dd('Ente / federazione',t.ente)}${dd('Numero tessera (ID tecnico)',t.numero)}${dd('Tipo di tessera',t.tipoTessera)}${dd('Stagione',t.stagione)}${sc('Scadenza',t.scadenza)}</dl>`:'<div class="mu">Nessuna tessera inserita.</div>'}
    <h3>Certificato medico</h3>${t&&(t.certTipo||t.certScad)?`<dl>${dd('Tipo',t.certTipo)}${sc('Scadenza',t.certScad)}</dl>`:'<div class="mu">Nessun certificato inserito.</div>'}
    <h3>Tesserini e qualifiche</h3>${L.length?L.map(z=>`<div style="margin:6px 0"><b>${esc(tesName(z))}</b>${isD(z.scadenza)?' <span class="chip '+(stato(z.scadenza)||{}).k+'">'+esc(fmtD(z.scadenza))+' · '+(stato(z.scadenza)||{}).t+'</span>':''}${(z.righe||[]).length?`<div class="mu">${esc(z.righe.map(x=>[x.sport,x.settore&&'settore '+x.settore,x.livello].filter(Boolean).join(' · ')).join('  —  '))}</div>`:''}${z.numero||z.ente?`<div class="mu">${esc([z.ente,z.numero&&'n. '+z.numero].filter(Boolean).join(' · '))}</div>`:''}</div>`).join(''):'<div class="mu">Nessun tesserino inserito.</div>'}
    ${leg?`<h3>Dati della vecchia scheda</h3><dl>${dd('Grado',it.grado)}${dd('Qualifiche',quals(it.qualifiche).join(', '))}${dd('ID',it.idTec)}${dd('Numero tessera',it.tessera)}${sc('Tesseramento fino al',it.tessScad)}${sc('Certificato medico fino al',it.certScad)}</dl><div class="mu">Riportali in Tessere: lì valgono per gli avvisi di scadenza.</div>`:(!t&&(it.grado||it.qualifiche)?`<h3>Dati della vecchia scheda</h3><dl>${dd('Grado',it.grado)}${dd('Qualifiche',quals(it.qualifiche).join(', '))}</dl>`:'')}
    ${lnk}`}
function openDetail(id){
  const it=items.find(x=>x.id===id);if(!it)return;
  const w=perm()==='w',a=age(it.nascita);
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v?esc(v):'<span class="mu">—</span>'}</dd>`;
  const sc=(l,d)=>{const s=stato(d);return `<dt>${l}</dt><dd>${isD(d)?esc(fmtD(d)):'<span class="mu">—</span>'}${s?` <span class="chip ${s.k}">${s.t}</span>`:''}</dd>`};
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda tecnico"><h2 style="margin:0">${esc(nameOf(it))}</h2>
    ${isAdm()&&pend(it.id)?`<div class="card" style="margin:8px 0"><b>Richieste da approvare</b><div class="mu">Il tecnico ha caricato file o proposto modifiche: ogni file e ogni campo si accetta o si rifiuta.</div><div class="dact"><a class="btn sm" href="richieste.html#${esc(it.id)}" style="text-decoration:none">Rivedi le richieste</a></div></div>`:''}
    <h3>Anagrafica</h3><dl>${dd('Nome',it.nome)}${dd('Cognome',it.cognome)}${dd('Data di nascita',isD(it.nascita)?fmtD(it.nascita)+(a!==''?' ('+a+' anni)':''):'')}${dd('Codice fiscale',it.cf)}${isAdm()?dd('Email (solo admin)',mailOf(it.id)):''}</dl>
    ${tesBloc(it)}
    <h3>Informazioni</h3><dl>${dd('Info',it.info)}${dd('Note',it.annotazioni)}${dd('Firebase',it.fb?'Salvato anche su Firebase':'Solo su Telegram')}</dl>
    <div class="dact">${w?'<button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="edit">Modifica</button>':''}<button class="btn" data-a="x">Chiudi</button></div></div>`;
  const close=()=>{o.remove();document.removeEventListener('keydown',esc_)};
  const esc_=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',esc_);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{
    const a=b.dataset.a;
    if(a==='x')close();
    else if(a==='edit'){close();edit(it)}
    else if(a==='del'){
      if(!confirm('Eliminare '+nameOf(it)+'? Va nel Cestino e resta recuperabile per 30 giorni.'))return;
      try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(isAdm()&&mails[it.id])await saveMail(it.id,'').catch(()=>{});if(editing===it.id)resetForm();close()}
      catch(x){console.error(x);alert('Eliminazione non riuscita.')}}});
  document.body.append(o);o.querySelector('[data-a="x"]').focus()}

/* ---------- elenco ---------- */
function renderList(){
  paintMio();
  const ls=$('#ls');if(!ls)return;
  const t=q.trim().toLowerCase();
  const hay=i=>[nameOf(i),i.grado,i.qualifiche,sumTes(zOf(i.id)),(tOf(i.id)||{}).numero,i.cf,i.idTec,i.tessera,i.info,i.annotazioni,isD(i.nascita)&&fmtD(i.nascita)].filter(Boolean).join(' ').toLowerCase();
  const all=items.filter(i=>i.nome||i.cognome||i.title);
  const list=all.filter(i=>(!t||hay(i).includes(t))&&(flt==='all'||needs(i)))
    .sort((a,b)=>(a.cognome||nameOf(a)).localeCompare(b.cognome||nameOf(b),'it')||(a.nome||'').localeCompare(b.nome||'','it'));
  const nd=all.filter(needs).length;
  ls.innerHTML=`<div class="flt"><select id="fs" aria-label="Filtro elenco"><option value="all" ${flt==='all'?'selected':''}>Tutti (${all.length})</option><option value="due" ${flt==='due'?'selected':''}>Da rinnovare o scaduti (${nd})</option></select></div>`+
  (list.length?list.map(i=>{
    const L=zOf(i.id),q2=L.length?[sumTes(L)]:quals(i.qualifiche),tn=(tOf(i.id)||{}).numero||i.tessera;
    return `<button class="tr" data-id="${esc(i.id)}" aria-label="Apri la scheda di ${esc(nameOf(i))}"><div class="inf"><div><b>${esc(nameOf(i))}</b>${(()=>{const g=L.filter(z=>z.albo==='cinture').flatMap(z=>(z.righe||[]).map(x=>x.livello)).filter(Boolean)[0]||i.grado;return g?`<span class="gr">${esc(g)}</span>`:''})()}</div><div class="mu">${esc(q2.join(' · ')||(tn?'Tessera '+tn:'—'))}</div></div><div class="chips">${isAdm()&&pend(i.id)?'<span class="chip bad">Da approvare</span>':''}${chip('Tess.',dTess(i))}${chip('Cert.',dCert(i))}${L.filter(z=>isD(z.scadenza)).map(z=>chip('Tesserino',z.scadenza)).join('')}</div></button>`}).join('')
  :`<div class="mu" style="padding:8px 0">${t||flt!=='all'?'Nessun risultato.':'Nessun tecnico registrato.'+(perm()==='w'?' Compila il modulo qui sopra.':'')}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
}

/* ---------- La mia area: il tecnico loggato (email uguale a quella inserita dall'admin) ----------
   Legge dati, tessera, certificato e tesserini dalle copie che le regole gli permettono di leggere; carica file e propone modifiche,
   che l'admin accetta o rifiuta campo per campo (pagina Richieste). */
async function leggiFile(fid){
  if(!fid)return null;
  try{const sn=await rgetDoc(rdoc(db,'sections','tessere','items',fid));if(sn.exists()&&sn.data().kind==='file'){const f={id:sn.id,...sn.data()};mioFiles[fid]=f;return f}}catch(x){}
  return null}
async function caricaMio(id){
  mioId=id;mioDati=null;mioMod={};mioT=null;mioTes=[];mioFiles={};
  try{const d=await rgetDoc(rdoc(db,'atletiDati',id));mioDati=d.exists()?d.data():null}catch(x){}
  try{const m=await rgetDoc(rdoc(db,'atletiModifiche',id));mioMod=m.exists()?(m.data().campi||{}):{}}catch(x){}
  try{mioRich=await mieRichieste(db,uid)}catch(x){mioRich=[]}
  try{const t=await rgetDoc(rdoc(db,'sections','tessere','items',id));if(t.exists()){mioT=t.data();await leggiFile(mioT.tesFile);await leggiFile(mioT.certFile)}}catch(x){}
  try{const z=await rgetDoc(rdoc(db,'tecniciTes',id));if(z.exists()){mioTes=z.data().tesserini||[];for(const x of mioTes)await leggiFile(x.tesFile)}}catch(x){}}
async function loadMio(){
  const e=auth.currentUser&&auth.currentUser.email;if(!e||isAdm())return false;
  try{
    const k=await rgetDoc(rdoc(db,'tecniciEmail',e.toLowerCase()));if(!k.exists())return false;
    const ids=k.data().tecnici||[];if(!ids.length)return false;
    await caricaMio(ids[0]);mioErr=false;return true
  }catch(x){console.error(x);mioErr=true;return false}}
async function mioBlob(f){
  const sn=await rgetDocs(rcollection(db,'sections','tessere','items',f.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(f.title,f.mime)})}
const mioCur=k=>String((k in mioMod?mioMod[k]:(mioDati||{})[k])??'');
const mioNome=()=>((mioCur('cognome')+' '+mioCur('nome')).trim())||'Tecnico';
const mioFileRow=fid=>{const f=mioFiles[fid];
  if(!fid)return '<div class="mu" style="margin-top:6px">Nessun file caricato.</div>';
  if(!f||!f.chunks)return '<div class="mu" style="margin-top:6px">Il file non è disponibile online. Chiedi all’admin di ricaricarlo.</div>';
  return `<div class="fr"><span class="mu">${esc(f.title)}</span><button class="btn sm" data-a="mioDl" data-f="${esc(fid)}">Scarica</button><button class="btn ghost sm" data-a="mioOp" data-f="${esc(fid)}">Apri</button></div>`};
const mioDd=(l,v)=>v?`<dt>${l}</dt><dd>${esc(v)}</dd>`:'';
const mioSc=(l,d)=>{if(!isD(d))return '';const s=stato(d);return `<dt>${l}</dt><dd>${esc(fmtD(d))}${s?` <span class="chip ${s.k}">${s.t}</span>`:''}</dd>`};
function mioCards(){
  if(mioErr)return `<div class="card"><h2 style="margin:0 0 6px">Impossibile leggere i tuoi dati</h2><div class="mu">Riprova tra poco; se il problema continua avvisa l’admin.</div></div>`;
  const t=mioT||{};
  const dati=TEC_EDIT.map(([k,l])=>{const v=mioCur(k);return `<dt>${l}</dt><dd style="white-space:pre-wrap">${v?esc(valTxt(k,v)):'<span class="mu">—</span>'}${k in mioMod?' <span class="chip">da confermare</span>':''}</dd>`}).join('');
  const tes=mioTes.map(z=>`<div class="fbox"><div class="fh"><b>${esc(tesName(z))}</b>${isD(z.scadenza)?chip('Tesserino',z.scadenza):''}</div>
      ${(z.righe||[]).length?`<dl>${z.righe.map(x=>`<dt>${esc([x.sport,x.settore&&'settore '+x.settore].filter(Boolean).join(' · ')||'—')}</dt><dd>${x.livello?esc(x.livello):'<span class="mu">—</span>'}</dd>`).join('')}</dl>`:''}
      ${z.numero||z.ente?`<div class="mu">${esc([z.ente,z.numero&&'n. '+z.numero].filter(Boolean).join(' · '))}</div>`:''}
      ${mioFileRow(z.tesFile)}<div class="dact" style="justify-content:flex-start"><button class="btn ghost sm" data-a="mioUp" data-t="tesserino" data-z="${esc(z.id)}">Modifica o sostituisci</button></div></div>`).join('');
  return `<div class="card dl"><h2 style="margin:0">${esc(mioNome())}</h2><h3>I miei dati</h3><dl>${dati}</dl>
      ${Object.keys(mioMod).length?'<div class="mu" style="font-size:.8rem;margin-top:4px">Modifiche inviate: in attesa di conferma dell’admin.</div>':''}
      <div class="dact" style="justify-content:flex-start"><button class="btn ghost sm" data-a="mioEdit">Modifica i miei dati</button></div></div>
    <div class="card dl" style="margin-top:12px"><h2 style="margin:0">Tessera e certificato medico</h2>
      <div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px">${chip('Tessera',t.scadenza)}${chip('Certificato',t.certScad)}</div>
      <h3>Tessera</h3>${mioT?`<dl>${mioDd('Ente / federazione',t.ente)}${mioDd('Numero tessera (ID tecnico)',t.numero)}${mioDd('Tipo di tessera',t.tipoTessera)}${mioDd('Stagione',t.stagione)}${mioSc('Scadenza',t.scadenza)}</dl>${mioFileRow(t.tesFile)}`:'<div class="mu">Non c’è ancora una tessera.</div>'}
      <h3>Certificato medico</h3>${mioT?`<dl>${mioDd('Tipo',t.certTipo)}${mioSc('Scadenza',t.certScad)}</dl>${mioFileRow(t.certFile)}`:'<div class="mu">Non c’è ancora un certificato.</div>'}
      <div class="dact" style="justify-content:flex-start;flex-wrap:wrap;margin-top:10px"><button class="btn sm" data-a="mioUp" data-t="tessera">Carica la tessera</button><button class="btn sm" data-a="mioUp" data-t="certificato">Carica il certificato medico</button></div></div>
    <div class="card dl" style="margin-top:12px"><h2 style="margin:0">Tesserini e qualifiche</h2>${tes||'<div class="mu" style="margin-top:6px">Nessun tesserino inserito.</div>'}
      <div class="dact" style="justify-content:flex-start;margin-top:8px"><button class="btn sm" data-a="mioUp" data-t="tesserino">+ Aggiungi tesserino o qualifica</button></div></div>
    ${mioRich.some(r=>r.soggetto===mioId)?`<div class="card dl" style="margin-top:12px"><h2 style="margin:0">In attesa di conferma dell’admin</h2>${richiesteHtml(mioRich,mioId)}</div>`:''}
    <div class="mu" style="font-size:.8rem;margin:10px 2px">Quello che carichi o modifichi lo controlla l’admin: finché non lo conferma, restano i dati attuali.</div>`}
async function mioClick(e,rep){
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a;
  const ricarica=async()=>{await caricaMio(mioId);rep()};
  try{
    if(a==='mioEdit')apriDati({db,uid,soggetto:mioId,defs:TEC_EDIT,base:mioDati||{},mod:mioMod,after:c=>{mioMod=c;rep()}});
    else if(a==='mioUp'){
      const tipo=b.dataset.t,att=tipo==='tesserino'?(b.dataset.z?mioTes.find(z=>z.id===b.dataset.z):null):(mioT||{});
      apriCarica({db,uid,soggetto:mioId,ruolo:'tecnico',tipo,attuale:att,after:ricarica})}
    else if(a==='rAnn'){const r=mioRich.find(x=>x.id===b.dataset.id);if(r&&confirm('Annullare questa richiesta?')){await annullaRichiesta(db,r);await ricarica()}}
    else if(a==='mioDl'||a==='mioOp'){
      const f=mioFiles[b.dataset.f];if(!f)return;
      if(a==='mioDl')saveBlob(await mioBlob(f),f.title);
      else showPreview({title:f.title,mime:f.mime,load:()=>mioBlob(f),errText:()=>'Impossibile aprire il file.'})}
  }catch(x){console.error(x);alert('Operazione non riuscita. Controlla la connessione e riprova.')}}
function mioView(){
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Tecnici</h2><span class="badge">La mia area</span></div></div>${mioCards()}</div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.onclick=e=>mioClick(e,mioView)}
/* riquadro in cima alla pagina per il tecnico che ha anche accesso alla sezione */
function paintMio(){
  const c=$('#mioc');if(!c)return;
  if(mioState!=='ok'||isAdm()){c.innerHTML='';return}
  c.innerHTML=`<h3 style="margin:0 0 8px">La mia area</h3>`+mioCards();c.onclick=e=>mioClick(e,paintMio)}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;tessStarted=false;mioState='';mioId='';mioErr=false;
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      const nega=()=>{app.innerHTML=mioErr?box('Impossibile leggere i tuoi dati','Non riesco a collegarmi ai tuoi dati. Riprova tra poco.'):box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.')};
      if(!me){nega();shellFor='';if(memo)memo.setAccess('n',false);return}
      /* senza accesso alla sezione: il tecnico collegato (stessa email inserita dall'admin) vede solo la propria area */
      if(noAcc()){
        shellFor='';if(memo)memo.setAccess('n',false);
        if(mioState==='ok'){mioView();return}
        if(mioState==='no'){nega();return}
        if(mioState===''){mioState='load';app.innerHTML=box('Un momento…','Sto cercando la tua scheda.');loadMio().then(ok=>{mioState=ok?'ok':'no';if(ok)mioView();else nega()})}
        return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(!started){started=true;unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));syncDati();renderList()},()=>{}));
        if(isAdm()){
          unsubs.push(onSnapshot(collection(db,'tecniciMail'),s=>{mails={};s.docs.forEach(d=>mails[d.id]=d.data());syncDati();renderList()},()=>{mails={}}));
          unsubs.push(onSnapshot(collection(db,'atletiModifiche'),s=>{mods={};s.docs.forEach(d=>mods[d.id]=d.data());renderList()},()=>{mods={}}));
          unsubs.push(ronSnap(rcollection(db,'richieste'),s=>{richAll=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.completa);renderList()},()=>{richAll=[]}))}
        else if(mioState===''){mioState='load';loadMio().then(ok=>{mioState=ok?'ok':'no';paintMio()})}}
      if(!tessStarted&&permT()!=='n'){tessStarted=true;unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tess=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{tess=[];renderList()}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
