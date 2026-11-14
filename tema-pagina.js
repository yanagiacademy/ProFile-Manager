/* Tema (solo admin): installa con un file .json un tema grafico per tutta la suite.
   Il file è controllato da PFM_TEMA.valida (tema.js); il tema installato sta in Firestore, app/tema = {json, nome, at, by}, e tutte le pagine lo applicano da sole.
   Prova = applica il tema solo su questa pagina e solo finché non si ricarica. Ripristina = elimina app/tema (torna l'aspetto predefinito). */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,deleteDoc,serverTimestamp,logEvento} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";

const T=window.PFM_TEMA;
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

let auth,db,me=null,attivo=null,scelto=null,shell=false;   /* attivo = {tema, at} installato; scelto = tema valido letto dal file, non ancora installato */
const scarica=(nome,obj)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=nome;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
const slug=s=>String(s||'tema').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tema';
const colori=(c,def)=>T.vars.map(k=>({k,v:(c&&c[k])||def[k]}));
const sw=(c,def)=>`<div class="sw">${colori(c,def).map(x=>`<span title="${esc(T.nomiVar[x.k])}"><i style="background:${esc(x.v)}"></i>${esc(T.nomiVar[x.k])}</span>`).join('')}</div>`;
const pvVars=(c,def)=>colori(c,def).map(x=>`--p${x.k}:${x.v}`).join(';');
const anteprima=(c,def,et)=>`<div class="mu" style="margin-top:8px">${esc(et)}</div><div class="pv" style="${esc(pvVars(c,def))}"><div class="pc"><b>Titolo di un riquadro</b><div class="pm">Testo secondario di esempio</div><div class="pa">Scheda con bordo colorato</div><div style="margin-top:8px"><span class="pb">Pulsante</span></div><div class="pe">Messaggio di errore</div></div></div>`;
const descr=(t)=>`<b>${esc(t.nome)}</b>${t.autore?` <span class="mu">· ${esc(t.autore)}</span>`:''}${t.descrizione?`<div class="mu">${esc(t.descrizione)}</div>`:''}
  <div class="mu" style="margin-top:4px">${[t.modo&&t.modo!=='auto'?'Sempre '+t.modo:'',t.font?'Font '+t.font:'',t.raggio!=null?'Angoli '+t.raggio+' px':'',t.logo?'Logo incluso':'',t.css?'CSS extra':''].filter(Boolean).join(' · ')}</div>
  ${t.chiaro?`${sw(t.chiaro,T.predefinito.chiaro)}${anteprima(t.chiaro,T.predefinito.chiaro,'Anteprima chiara')}`:''}${t.scuro?`${sw(t.scuro,T.predefinito.scuro)}${anteprima(t.scuro,T.predefinito.scuro,'Anteprima scura')}`:''}`;

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Tema</h2><span class="badge">Solo admin</span></div></div>
  <div class="card cd"><h2>Tema attivo</h2><div id="att"></div></div>
  <div class="card cd"><h2>Installa un tema</h2>
    <div class="mu">Scegli un file tema (.json). Prima vedi l’anteprima e puoi provarlo su questa pagina; solo con «Installa» cambia per tutta la suite, per tutti gli account, dal prossimo caricamento di ogni pagina.</div>
    <label for="fl">File del tema</label><input id="fl" class="fl" type="file" accept=".json,application/json">
    <div id="esito" role="status"></div></div>
  <div class="card cd"><h2>Crea un tema</h2>
    <div class="mu">Scarica il modello, cambia colori e impostazioni con un editor di testo e installalo qui sopra. Un nuovo tema sostituisce il precedente.</div>
    <div class="dact"><button class="btn ghost" id="mod">Scarica modello</button></div>
    <details style="margin-top:8px"><summary>Cosa si può cambiare</summary>
      <div class="mu" style="line-height:1.6">
      <b>formato</b> e <b>nome</b>: obbligatori (<code>"pfm-tema-1"</code>). <b>autore</b>, <b>descrizione</b>: facoltativi.<br>
      <b>chiaro</b> / <b>scuro</b>: colori per i due aspetti — ${T.vars.map(k=>`<code>${k}</code> (${esc(T.nomiVar[k].toLowerCase())})`).join(', ')}. Formato <code>#RRGGBB</code>, <code>rgb()</code> o <code>hsl()</code>. Quelli omessi restano predefiniti.<br>
      <b>modo</b>: <code>"auto"</code> (segue il dispositivo), <code>"chiaro"</code> o <code>"scuro"</code> (forzato).<br>
      <b>font</b>: nome di un font di Google Fonts (es. <code>"Noto Serif JP"</code>). <b>raggio</b>: angoli da 0 a 24 px.<br>
      <b>logo</b>: immagine PNG/JPEG/WebP/SVG come data URL base64 (max ~200 KB); <b>logoSfondo</b>: colore dietro il logo.<br>
      <b>css</b>: regole CSS aggiuntive. Non sono ammessi <code>@import</code> né indirizzi esterni in <code>url()</code> (solo dati incorporati).</div></details></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#mod').onclick=()=>scarica('tema-modello.json',T.esempio());
  $('#fl').onchange=leggiFile;
  renderAttivo()}

function renderAttivo(){
  const el=$('#att');if(!el)return;
  if(!attivo){el.innerHTML=`<div>Nessun tema installato: la suite usa l’aspetto predefinito.</div><div class="dact"><button class="btn ghost sm" id="espDef">Scarica l’aspetto predefinito come tema</button></div>`;
    $('#espDef').onclick=()=>scarica('tema-predefinito.json',{...T.esempio(),nome:'Predefinito',descrizione:'Aspetto originale della suite.'});return}
  el.innerHTML=`${descr(attivo)}<div class="dact"><button class="btn ghost sm" id="espAtt">Scarica questo tema</button><button class="btn ghost sm" id="rip">Ripristina l’aspetto predefinito</button></div><p class="err" id="er1" role="alert"></p>`;
  $('#espAtt').onclick=()=>scarica('tema-'+slug(attivo.nome)+'.json',attivo);
  $('#rip').onclick=async()=>{
    if(!confirm('Ripristinare l’aspetto predefinito per tutta la suite? Il tema «'+attivo.nome+'» verrà tolto (ne conservi una copia scaricandolo prima).'))return;
    try{await deleteDoc(doc(db,'app','tema'));logEvento('modifica','tema','tema','Tema','Ripristinato l’aspetto predefinito');attivo=null;T.svuotaCache();T.applica(null);renderAttivo()}
    catch(e){$('#er1').textContent='Operazione non riuscita. Controlla la connessione e le regole Firestore (vanno ripubblicate), poi riprova.'}}}

function leggiFile(e){
  const f=e.target.files&&e.target.files[0],es=$('#esito');scelto=null;if(!f){es.innerHTML='';return}
  if(f.size>900000){es.innerHTML='<ul class="er-l"><li>Il file è troppo grande (massimo circa 700 KB).</li></ul>';return}
  const r=new FileReader();
  r.onerror=()=>{es.innerHTML='<ul class="er-l"><li>Impossibile leggere il file.</li></ul>'};
  r.onload=()=>{
    let o;try{o=JSON.parse(String(r.result).replace(/^\uFEFF/,''))}catch(x){es.innerHTML='<ul class="er-l"><li>Il file non è un JSON valido: controlla virgole e virgolette.</li></ul>';return}
    const v=T.valida(o);
    if(!v.ok){es.innerHTML=`<div style="margin-top:10px"><b>Tema non installabile</b><ul class="er-l">${v.errori.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;return}
    scelto=v.tema;
    es.innerHTML=`<div style="margin-top:10px"><div class="ok-l">✓ File valido</div>${descr(scelto)}<div class="dact"><button class="btn" id="inst">Installa per tutta la suite</button><button class="btn ghost" id="prova">Prova su questa pagina</button><button class="btn ghost" id="ann">Annulla</button></div><p class="err" id="er2" role="alert"></p></div>`;
    $('#prova').onclick=()=>{T.applica(scelto);$('#er2').style.color='var(--mu)';$('#er2').textContent='Anteprima solo su questa pagina: ricaricandola torna il tema installato.'};
    $('#ann').onclick=()=>{scelto=null;$('#fl').value='';es.innerHTML='';T.applica(attivo)};
    $('#inst').onclick=installa};
  r.readAsText(f)}

async function installa(){
  if(!scelto)return;const b=$('#inst'),er=$('#er2');b.disabled=true;er.style.color='';er.textContent='';
  try{
    await setDoc(doc(db,'app','tema'),{json:JSON.stringify(scelto),nome:scelto.nome,at:serverTimestamp(),by:me.id});
    logEvento('modifica','tema','tema','Tema','Installato il tema «'+scelto.nome+'»');
    attivo=scelto;T.applica(attivo);try{localStorage.setItem('pfm_tema',JSON.stringify({t:attivo,at:Date.now()}))}catch(x){}
    scelto=null;$('#fl').value='';$('#esito').innerHTML='<p class="ok-l" style="margin-top:10px">✓ Tema installato. Gli altri account lo vedranno al prossimo caricamento di una pagina (entro pochi minuti).</p>';renderAttivo()}
  catch(e){b.disabled=false;er.textContent='Installazione non riuscita. Controlla la connessione e che le regole Firestore siano state ripubblicate (blocco app/tema), poi riprova.'}}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    if(!u){location.href='index.html';return}
    try{const sn=await getDoc(doc(db,'users',u.uid));me=sn.exists()?{id:u.uid,...sn.data()}:null}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.');return}
    if(!me||!me.admin){app.innerHTML=box('Solo admin','La gestione del tema è riservata all’amministratore.');return}
    try{const sn=await getDoc(doc(db,'app','tema'));if(sn.exists()){const v=T.valida(JSON.parse(sn.data().json));attivo=v.ok?v.tema:null}}catch(e){}
    if(!shell)costruisci();else renderAttivo()})}
