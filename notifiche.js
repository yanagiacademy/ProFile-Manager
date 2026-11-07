/* Notifiche Telegram (solo admin): impostazioni, elenco dei Telegram degli atleti, sincronizzazione e prove.
   La logica sta in notifiche-motore.js (invio/programmazione) e notifiche-core.js (calcolo). */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getDoc as getDocSdk} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {getFirestore,doc,collection,onSnapshot} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {hasSession,tgConfigured} from "./telegram.js";
import {sincronizza,provaMessaggio,provaProgrammata,leggiConfig,salvaConfig,leggiRubrica,salvaRubrica,riepilogoProgrammate,parseHandle,erroreTg} from "./notifiche-motore.js";
import {isD,fmtD,giorniA} from "./notifiche-core.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

let auth,db,me=null,shell=false,unsubs=[],atleti=[],tessere={},rubrica={},q='',busy=false;
const H=v=>typeof v==='string'?v:(v&&v.h)||'';const G=v=>!!(v&&typeof v==='object'&&v.g);     /* rubrica: nomeutente oppure {h,g:1} (genitore) */
const nomeAt=a=>((a.cognome||'')+' '+(a.nome||'')).trim()||a.title||'(senza nome)';
const quando=ms=>new Date(ms).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+new Date(ms).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
const log=t=>{const l=$('#log');if(!l)return;l.hidden=false;l.textContent+=(l.textContent?'\n':'')+t;l.scrollTop=l.scrollHeight};
const tgOk=()=>tgConfigured()&&hasSession();

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Notifiche Telegram</h2><span class="badge">Solo admin</span></div></div>
  <div class="card"><h2>Stato</h2>
    <div class="st" id="stato"></div>
    <div class="btns"><button class="btn" id="sync">Sincronizza ora</button><button class="btn ghost" id="ant">Anteprima</button><button class="btn ghost" id="pm">Messaggio di prova</button><button class="btn ghost" id="pp">Prova programmata (2 min)</button></div>
    <p class="mu" style="margin:10px 0 0">I promemoria sono <b>programmati su Telegram</b>: li consegna Telegram all’ora giusta anche con l’app chiusa. Si aggiornano da soli quando apri la Home da admin (al massimo ogni 10 ore) o con «Sincronizza ora». «Prova programmata» ti manda un messaggio fra 2 minuti: se arriva con l’app chiusa, funziona tutto.</p>
    <div class="lg" id="log" role="log" aria-live="polite" hidden></div></div>
  <div class="card" style="margin-top:12px"><h2>Cosa inviare</h2>
    <label class="ck"><input type="checkbox" id="ce"><span><b>Nuovi eventi</b><br><span class="mu">Messaggio subito a tutti gli atleti con Telegram quando crei un evento (se lo crea un operatore, parte alla prima apertura della Home da admin).</span></span></label>
    <label class="ck"><input type="checkbox" id="ca"><span><b>Scadenze agli atleti</b><br><span class="mu">A ogni atleta con Telegram: promemoria prima della scadenza di tessera e certificato medico.</span></span></label>
    <label class="ck"><input type="checkbox" id="cm"><span><b>Scadenze per me (admin)</b><br><span class="mu">Un riepilogo per ogni giorno con scadenze, nei tuoi «Messaggi salvati»: documenti, tessere e certificati di tutti gli atleti, iscrizioni e hotel degli eventi, test.</span></span></label>
    <div class="two"><div><label for="cg">Giorni di preavviso</label><input id="cg" type="text" inputmode="numeric" placeholder="30, 7, 1"></div><div><label for="co">Ora del promemoria</label><select id="co">${Array.from({length:16},(_,i)=>`<option value="${i+6}">${String(i+6).padStart(2,'0')}:00</option>`).join('')}</select></div></div>
    <p class="err" id="er" role="alert"></p><div class="btns"><button class="btn" id="sv">Salva e applica</button></div></div>
  <div class="card" style="margin-top:12px"><h2>Atleti su Telegram</h2>
    <p class="mu">Scrivi il nome utente Telegram di ogni atleta (per esempio <b>@mario_rossi</b>): solo chi ce l’ha riceve i messaggi. I numeri di telefono non sono supportati. Chiedi agli atleti di salvare il tuo contatto o di scriverti una volta, così i messaggi non finiscono tra gli sconosciuti. Per un genitore con più figli scrivi lo stesso nome utente su ciascuno (o spunta «Genitore»): i messaggi parleranno dell’atleta, per esempio «la tessera di Mario Rossi scade…».</p>
    <div class="flt"><input id="q" type="search" placeholder="Cerca un atleta" aria-label="Cerca un atleta"><span class="mu" id="cnt"></span></div>
    <p class="err" id="er2" role="alert"></p><div id="ls"></div></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;lista()};
  $('#sv').onclick=salva;$('#sync').onclick=()=>esegui('sync');$('#ant').onclick=()=>esegui('ant');
  $('#pm').onclick=()=>esegui('pm');$('#pp').onclick=()=>esegui('pp');
  $('#ls').onchange=e=>{const i=e.target.closest('input[data-a]');if(i){salvaHandle(i);return}const g=e.target.closest('input[data-g]');if(g)salvaGenitore(g)};
  leggiConfig(db).then(c=>{$('#ce').checked=c.eventi;$('#ca').checked=c.atleti;$('#cm').checked=c.admin;$('#cg').value=c.giorni.join(', ');$('#co').value=String(c.ora)});
  stato()}

async function stato(){
  const el=$('#stato');if(!el)return;
  let r={atleti:0,admin:0,eventi:0,prossima:0,ult:0};try{r=await riepilogoProgrammate(db)}catch(e){}
  el.innerHTML=`<b>Telegram</b><span>${tgOk()?'collegato in questo browser':'<span class="neg">non collegato</span> — <a href="chat.html">accedi dalla Chat</a>'}</span>
    <b>Programmati</b><span>${r.atleti} promemoria agli atleti · ${r.admin} riepiloghi per te${r.prossima?' · il prossimo il '+esc(quando(r.prossima)):''}</span>
    <b>Eventi notificati</b><span>${r.eventi}</span>
    <b>Ultima sincronizzazione</b><span>${r.ult?esc(quando(r.ult)):'mai'}</span>`}

async function esegui(cosa){
  if(busy)return;busy=true;['sync','ant','pm','pp','sv'].forEach(i=>{const b=$('#'+i);if(b)b.disabled=true});
  const l=$('#log');l.textContent='';l.hidden=false;
  try{
    if(cosa==='pm'){await provaMessaggio();log('Messaggio di prova inviato nei tuoi «Messaggi salvati» di Telegram.')}
    else if(cosa==='pp'){const r=await provaProgrammata(2);log('Programmato per le '+new Date(r.when).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+'. Chiudi pure l’app: tra 2 minuti deve arrivare nei «Messaggi salvati» di Telegram.')}
    else{
      log(cosa==='ant'?'Calcolo dell’anteprima…':'Sincronizzazione in corso…');
      const R=await sincronizza(db,{log,anteprima:cosa==='ant'});
      if(R.errore)log('⚠ '+R.errore);
      if(cosa==='ant'){
        log('Da programmare o inviare: '+(R.nuovi||[]).length+' · da annullare: '+(R.annulla||[]).length+' · già a posto: '+R.gia);
        (R.nuovi||[]).slice(0,25).forEach(x=>log('  + '+(x.tipo==='evento'?'evento → '+x.peers.length+' atleti':(x.peer==='me'?'per te':'@'+x.peer))+' · '+(x.when?quando(x.when):'subito')+' · '+x.text.split('\n')[0].slice(0,70)));
        if((R.nuovi||[]).length>25)log('  … e altri '+(R.nuovi.length-25));
        (R.annulla||[]).slice(0,10).forEach(a=>log('  − annulla '+(a.voce.p==='me'?'riepilogo per te':'@'+a.voce.p)+' · '+quando(a.voce.t)))}
      else log('Fatto: '+R.programmate+' programmati, '+R.inviati+' inviati subito, '+R.annullate+' annullati, '+R.gia+' già a posto'+(R.errori?', '+R.errori+' con errore':'')+'.');
      (R.note||[]).forEach(n=>log('ℹ '+n))}
  }catch(e){console.error(e);log('✗ '+erroreTg(e))}
  busy=false;['sync','ant','pm','pp','sv'].forEach(i=>{const b=$('#'+i);if(b)b.disabled=false});stato()}

async function salva(){
  const er=$('#er');er.textContent='';
  const g=$('#cg').value.split(/[,\s;]+/).filter(Boolean).map(Number);
  if(g.some(n=>!Number.isInteger(n)||n<1||n>90)||!g.length){er.textContent='Scrivi i giorni di preavviso separati da virgola, tra 1 e 90 (per esempio 30, 7, 1).';return}
  try{await salvaConfig(db,{eventi:$('#ce').checked,atleti:$('#ca').checked,admin:$('#cm').checked,giorni:g,ora:Number($('#co').value)})}
  catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla che Telegram sia collegato e riprova.';return}
  if(tgOk())esegui('sync');else log('Impostazioni salvate. Telegram non è collegato: i messaggi verranno programmati alla prossima sincronizzazione.')}

/* ---- elenco atleti con il loro Telegram ---- */
function scadInfo(id){
  const t=tessere[id];if(!t)return '';
  const f=(d,n)=>isD(d)?n+' '+fmtD(d)+(giorniA(d,new Date())<0?' (scaduto)':''):'';
  return [f(t.scadenza,'tessera'),f(t.certScad,'certificato')].filter(Boolean).join(' · ')}
function lista(){
  const el=$('#ls');if(!el)return;
  const t=q.trim().toLowerCase(),l=atleti.filter(a=>!t||nomeAt(a).toLowerCase().includes(t)).sort((a,b)=>nomeAt(a).localeCompare(nomeAt(b),'it'));
  $('#cnt').textContent=atleti.length?Object.values(rubrica).filter(H).length+' su '+atleti.length+' con Telegram':'';
  el.innerHTML=l.length?l.map(a=>`<div class="rw"><div class="inf"><b>${esc(nomeAt(a))}</b>${scadInfo(a.id)?`<div class="mu">${esc(scadInfo(a.id))}</div>`:''}</div>
    <div class="ac"><input class="tg" type="text" data-a="${esc(a.id)}" value="${esc(H(rubrica[a.id])?'@'+H(rubrica[a.id]):'')}" placeholder="@nomeutente" aria-label="Telegram di ${esc(nomeAt(a))}" autocomplete="off" autocapitalize="off"><label class="mu" style="display:flex;gap:6px;align-items:center;margin-top:4px;font-size:.8rem"><input type="checkbox" data-g="${esc(a.id)}" ${G(rubrica[a.id])?'checked':''} ${H(rubrica[a.id])?'':'disabled'} style="width:auto;min-height:0"> Genitore</label></div></div>`).join('')
    :`<div class="emp">${atleti.length?'Nessun atleta con questo nome.':'Nessun atleta nell’elenco.'}</div>`}
async function salvaGenitore(c){
  const id=c.dataset.g,h=H(rubrica[id]);if(!h)return;
  const nuova={...rubrica,[id]:c.checked?{h,g:1}:h};
  try{await salvaRubrica(db,nuova);rubrica=nuova;$('#er2').textContent=''}
  catch(e){console.error(e);c.checked=!c.checked;$('#er2').textContent='Salvataggio non riuscito. Controlla che Telegram sia collegato e riprova.'}}
async function salvaHandle(i){
  const er=$('#er2'),id=i.dataset.a,v=i.value.trim();er.textContent='';
  const h=parseHandle(v);
  if(v&&!h){er.textContent='Nome utente non valido: usa per esempio @mario_rossi (5-32 caratteri: lettere, numeri e _). I numeri di telefono non sono supportati.';i.setAttribute('aria-invalid','true');i.style.borderColor='var(--er)';return}
  i.removeAttribute('aria-invalid');i.style.borderColor='';
  const nuova={...rubrica};if(h)nuova[id]=G(rubrica[id])?{h,g:1}:h;else delete nuova[id];
  try{await salvaRubrica(db,nuova);rubrica=nuova;i.value=h?'@'+h:'';$('#cnt').textContent=Object.values(rubrica).filter(H).length+' su '+atleti.length+' con Telegram';lista();
    er.textContent='';i.style.borderColor='var(--ac)';setTimeout(()=>{i.style.borderColor=''},1200)}
  catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla che Telegram sia collegato e riprova.'}}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    try{const sn=await getDocSdk(doc(db,'users',u.uid));me=sn.exists()?{id:u.uid,...sn.data()}:null}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.');return}
    if(!me||!me.admin){app.innerHTML=box('Solo admin','Le notifiche sono riservate all’amministratore.');return}
    if(!shell)costruisci();
    leggiRubrica(db).then(r=>{rubrica=r;lista()}).catch(()=>{});
    unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atleti=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>!a.kind||a.kind==='atleta');lista()},()=>{}));
    unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tessere={};s.docs.forEach(d=>{const t=d.data();if(t.kind==='tessera')tessere[t.atleta||d.id]=t});lista()},()=>{}))})}
