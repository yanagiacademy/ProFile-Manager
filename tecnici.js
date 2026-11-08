import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {tesName,rigaBreve,sumTes,tesserini} from "./tesserini.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='tecnici';
let auth,db,col,uid=null,me=null,items=[],tess=[],q='',flt='all',unsubs=[],shellFor='',editing=null,memo=null,started=false,tessStarted=false;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const permT=()=>me?(me.admin?'w':((me.perms||{}).tessere||'n')):'n';
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
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuovo tecnico</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo del tecnico">+</button></div>
    <div id="fb" hidden>
    <fieldset><legend>Anagrafica</legend>
      <div class="two"><div><label for="nm">Nome</label><input id="nm" type="text" autocomplete="off"></div><div><label for="cg">Cognome</label><input id="cg" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="nas">Data di nascita</label><input id="nas" type="date"></div><div><label for="cf">Codice fiscale</label><input id="cf" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></div></div>
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
  setForm(false);editing=null;F.forEach(([e])=>$('#'+e).value='');$('#fbk').checked=false;
  $('#ft').textContent='Nuovo tecnico';$('#sv').textContent='Salva tecnico';$('#cx').hidden=true;$('#er').textContent=''}
function edit(it){
  setForm(true);editing=it.id;F.forEach(([e,k])=>$('#'+e).value=it[k]||'');$('#fbk').checked=!!it.fb;
  $('#ft').textContent='Modifica tecnico';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

async function save(){
  const v={};F.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  v.cf=v.cf.toUpperCase().replace(/\s+/g,'');
  const er=$('#er');
  if(!v.nome||!v.cognome){er.textContent='Inserisci nome e cognome.';return}
  if(v.cf&&!/^[A-Z0-9]{16}$/.test(v.cf)){er.textContent='Il codice fiscale deve avere 16 caratteri (lettere e cifre).';return}
  if(v.cf&&items.some(i=>i.id!==editing&&(i.cf||'')===v.cf)){er.textContent='Esiste già un tecnico con questo codice fiscale.';return}
  const data={...v,fb:$('#fbk').checked,title:v.cognome+' '+v.nome,
    note:[v.cf,v.info,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else await addDoc(col,{...data,by:uid,at:serverTimestamp()});
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
    <h3>Anagrafica</h3><dl>${dd('Nome',it.nome)}${dd('Cognome',it.cognome)}${dd('Data di nascita',isD(it.nascita)?fmtD(it.nascita)+(a!==''?' ('+a+' anni)':''):'')}${dd('Codice fiscale',it.cf)}</dl>
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
      try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(editing===it.id)resetForm();close()}
      catch(x){console.error(x);alert('Eliminazione non riuscita.')}}});
  document.body.append(o);o.querySelector('[data-a="x"]').focus()}

/* ---------- elenco ---------- */
function renderList(){
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
    return `<button class="tr" data-id="${esc(i.id)}" aria-label="Apri la scheda di ${esc(nameOf(i))}"><div class="inf"><div><b>${esc(nameOf(i))}</b>${(()=>{const g=L.filter(z=>z.albo==='cinture').flatMap(z=>(z.righe||[]).map(x=>x.livello)).filter(Boolean)[0]||i.grado;return g?`<span class="gr">${esc(g)}</span>`:''})()}</div><div class="mu">${esc(q2.join(' · ')||(tn?'Tessera '+tn:'—'))}</div></div><div class="chips">${chip('Tess.',dTess(i))}${chip('Cert.',dCert(i))}${L.filter(z=>isD(z.scadenza)).map(z=>chip('Tesserino',z.scadenza)).join('')}</div></button>`}).join('')
  :`<div class="mu" style="padding:8px 0">${t||flt!=='all'?'Nessun risultato.':'Nessun tecnico registrato.'+(perm()==='w'?' Compila il modulo qui sopra.':'')}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;tessStarted=false;
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(!started){started=true;unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}))}
      if(!tessStarted&&permT()!=='n'){tessStarted=true;unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tess=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{tess=[];renderList()}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
