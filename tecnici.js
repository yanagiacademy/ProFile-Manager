import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='tecnici';
let auth,db,col,uid=null,me=null,items=[],q='',flt='all',unsubs=[],shellFor='',editing=null,memo=null;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const fmtD=d=>String(d||'').split('-').reverse().join('/');
const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
const age=d=>{if(!isD(d))return '';const b=new Date(d+'T12:00:00'),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a>=0&&a<120?a:''};
const quals=s=>String(s||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';

/* Scadenza: scaduta, in scadenza (entro 30 giorni) o valida */
function stato(d){
  if(!isD(d))return null;
  const days=Math.floor((new Date(d+'T23:59:59')-new Date())/864e5);
  return days<0?{k:'bad',t:'scaduto'}:days<=30?{k:'warn',t:'scade tra '+(days+1)+' g'}:{k:'ok',t:'valido'}}
const chip=(lab,d)=>{const s=stato(d);return s?`<span class="chip ${s.k}">${lab}: ${s.t}</span>`:`<span class="chip">${lab}: —</span>`};
const needs=i=>['bad','warn'].includes((stato(i.tessScad)||{}).k)||['bad','warn'].includes((stato(i.certScad)||{}).k);

/* Struttura della pagina creata una volta sola, così il modulo non si perde quando l'elenco si aggiorna */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca nei tecnici" aria-label="Cerca nei tecnici" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Tecnici</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuovo tecnico</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo del tecnico">+</button></div>
    <div id="fb" hidden>
    <fieldset><legend>Anagrafica</legend>
      <div class="two"><div><label for="nm">Nome</label><input id="nm" type="text" autocomplete="off"></div><div><label for="cg">Cognome</label><input id="cg" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="nas">Data di nascita</label><input id="nas" type="date"></div><div><label for="cf">Codice fiscale</label><input id="cf" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></div></div>
    </fieldset>
    <fieldset><legend>Qualifica tecnica</legend>
      <div class="two"><div><label for="gr">Grado</label><input id="gr" type="text" list="lg" autocomplete="off"><datalist id="lg"></datalist></div><div><label for="ql">Qualifiche</label><input id="ql" type="text" autocomplete="off" placeholder="Separate da virgola"></div></div>
    </fieldset>
    <fieldset><legend>Tesseramento e idoneità</legend>
      <div class="two"><div><label for="idt">ID</label><input id="idt" type="text" autocomplete="off"></div><div><label for="tn">Numero tessera</label><input id="tn" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="ts">Tesseramento valido fino al</label><input id="ts" type="date"></div><div><label for="cm">Certificato medico valido fino al</label><input id="cm" type="date"></div></div>
    </fieldset>
    <fieldset><legend>Informazioni</legend>
      <label for="inf">Info</label><textarea id="inf"></textarea>
      <label for="nt">Note</label><textarea id="nt"></textarea>
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
const F=[['nm','nome'],['cg','cognome'],['nas','nascita'],['cf','cf'],['gr','grado'],['ql','qualifiche'],['idt','idTec'],['tn','tessera'],['ts','tessScad'],['cm','certScad'],['inf','info'],['nt','annotazioni']];
function resetForm(){
  setForm(false);editing=null;F.forEach(([e])=>$('#'+e).value='');
  $('#ft').textContent='Nuovo tecnico';$('#sv').textContent='Salva tecnico';$('#cx').hidden=true;$('#er').textContent=''}
function edit(it){
  setForm(true);editing=it.id;F.forEach(([e,k])=>$('#'+e).value=it[k]||'');
  $('#ft').textContent='Modifica tecnico';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

async function save(){
  const v={};F.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  v.cf=v.cf.toUpperCase().replace(/\s+/g,'');
  const er=$('#er');
  if(!v.nome||!v.cognome){er.textContent='Inserisci nome e cognome.';return}
  if(v.cf&&!/^[A-Z0-9]{16}$/.test(v.cf)){er.textContent='Il codice fiscale deve avere 16 caratteri (lettere e cifre).';return}
  if(v.cf&&items.some(i=>i.id!==editing&&(i.cf||'')===v.cf)){er.textContent='Esiste già un tecnico con questo codice fiscale.';return}
  const data={...v,title:v.cognome+' '+v.nome,
    note:[v.grado,quals(v.qualifiche).join(', '),v.tessera&&'tessera '+v.tessera,v.idTec&&'ID '+v.idTec,v.cf,v.info,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else await addDoc(col,{...data,by:uid,at:serverTimestamp()});
    resetForm();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}

/* ---------- scheda di dettaglio ---------- */
function openDetail(id){
  const it=items.find(x=>x.id===id);if(!it)return;
  const w=perm()==='w',a=age(it.nascita);
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v?esc(v):'<span class="mu">—</span>'}</dd>`;
  const sc=(l,d)=>{const s=stato(d);return `<dt>${l}</dt><dd>${isD(d)?esc(fmtD(d)):'<span class="mu">—</span>'}${s?` <span class="chip ${s.k}">${s.t}</span>`:''}</dd>`};
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda tecnico"><h2 style="margin:0">${esc(nameOf(it))}</h2>
    <h3>Anagrafica</h3><dl>${dd('Nome',it.nome)}${dd('Cognome',it.cognome)}${dd('Data di nascita',isD(it.nascita)?fmtD(it.nascita)+(a!==''?' ('+a+' anni)':''):'')}${dd('Codice fiscale',it.cf)}</dl>
    <h3>Qualifica tecnica</h3><dl>${dd('Grado',it.grado)}${dd('Qualifiche',quals(it.qualifiche).join(', '))}</dl>
    <h3>Tesseramento e idoneità</h3><dl>${dd('ID',it.idTec)}${dd('Numero tessera',it.tessera)}${sc('Tesseramento fino al',it.tessScad)}${sc('Certificato medico fino al',it.certScad)}</dl>
    <h3>Informazioni</h3><dl>${dd('Info',it.info)}${dd('Note',it.annotazioni)}</dl>
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
      if(!confirm('Eliminare '+nameOf(it)+'? L’operazione non si può annullare.'))return;
      try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(editing===it.id)resetForm();close()}
      catch(x){console.error(x);alert('Eliminazione non riuscita.')}}});
  document.body.append(o);o.querySelector('[data-a="x"]').focus()}

/* ---------- elenco ---------- */
function renderList(){
  const ls=$('#ls');if(!ls)return;
  const t=q.trim().toLowerCase();
  const hay=i=>[nameOf(i),i.grado,i.qualifiche,i.cf,i.idTec,i.tessera,i.info,i.annotazioni,isD(i.nascita)&&fmtD(i.nascita)].filter(Boolean).join(' ').toLowerCase();
  const all=items.filter(i=>i.nome||i.cognome||i.title);
  const list=all.filter(i=>(!t||hay(i).includes(t))&&(flt==='all'||needs(i)))
    .sort((a,b)=>(a.cognome||nameOf(a)).localeCompare(b.cognome||nameOf(b),'it')||(a.nome||'').localeCompare(b.nome||'','it'));
  const nd=all.filter(needs).length;
  ls.innerHTML=`<div class="flt"><select id="fs" aria-label="Filtro elenco"><option value="all" ${flt==='all'?'selected':''}>Tutti (${all.length})</option><option value="due" ${flt==='due'?'selected':''}>Da rinnovare o scaduti (${nd})</option></select></div>`+
  (list.length?list.map(i=>{
    const q2=quals(i.qualifiche);
    return `<button class="tr" data-id="${esc(i.id)}" aria-label="Apri la scheda di ${esc(nameOf(i))}"><div class="inf"><div><b>${esc(nameOf(i))}</b>${i.grado?`<span class="gr">${esc(i.grado)}</span>`:''}</div><div class="mu">${esc(q2.join(' · ')||(i.tessera?'Tessera '+i.tessera:'—'))}</div></div><div class="chips">${chip('Tess.',i.tessScad)}${chip('Cert.',i.certScad)}</div></button>`}).join('')
  :`<div class="mu" style="padding:8px 0">${t||flt!=='all'?'Nessun risultato.':'Nessun tecnico registrato.'+(perm()==='w'?' Compila il modulo qui sopra.':'')}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
  if(perm()==='w'){const g=[...new Set(all.map(i=>i.grado).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
    const dl=$('#lg');if(dl)dl.innerHTML=g.map(v=>`<option value="${esc(v)}">`).join('')}
}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
