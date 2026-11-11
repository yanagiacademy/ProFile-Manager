/* Cifratura dei contenuti GIÀ presenti su Telegram (una tantum, solo admin).
   1) ogni file ancora in chiaro viene scaricato, cifrato, ricaricato con nome casuale; l'elemento punta al nuovo messaggio e il vecchio viene cancellato;
   2) ogni record del registro ancora in chiaro viene riscritto cifrato e i vecchi messaggi vengono cancellati.
   Si può interrompere e riavviare: salta quello che è già cifrato. Prima di avviare: pubblica le regole di firestore.rules (sezione "chiavi"). */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {getFirestore,doc,collection,getDocs,updateDoc,caricaDati,GRUPPO_DATI,statoRegistro,ricifraRegistro} from "./fsx.js";
import {hasSession,tgConfigured,tgClient,tgEntity,tgErrText,tgTopic} from "./telegram.js";
import {TG_FILES} from "./telegram-config.js";
import {tgSendCifrato,isCifrato} from "./cifra.js";
import {guessMime} from "./file-tools.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);
const SECS=['documenti','file-importanti','lezioni','esami','tecnici','atleti','eventi','video','foto','commercialista','mail','archivio','documenti-in-scadenza','tessere','richieste','ordini'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stop=false,running=false;

function ui(db){
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2>Cifratura dei contenuti su Telegram</h2></div>
  <div class="card"><p>Cifra, nel gruppo <b>${esc(GRUPPO_DATI)}</b> e in quello dei file, tutto ciò che oggi è ancora leggibile da chi è nel gruppo: <b>file</b> (scaricati, cifrati e ricaricati con nome casuale; il vecchio messaggio viene cancellato) e <b>registro dei dati</b> (schede, elenchi, note).</p>
  <p class="mu">Prima di avviare: pubblica le regole di <code>firestore.rules</code> (sezione «chiavi») e accedi a Telegram con l’account che ha creato i messaggi o è amministratore del gruppo, altrimenti i vecchi messaggi non si possono cancellare. Si può interrompere e riavviare. Tieni aperta la pagina finché non finisce: il lavoro è lento di proposito (limiti di Telegram).</p>
  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn ghost" id="chk">Controlla lo stato</button><button class="btn" id="go">Avvia cifratura</button><button class="btn ghost" id="st" disabled>Interrompi</button></div>
  <div id="log" role="log" aria-live="polite">Pronto.</div></div></div>`;
  $('#out').onclick=()=>signOut(getAuth()).then(()=>location.href='index.html');
  $('#st').onclick=()=>{stop=true;log('Interruzione richiesta…')};
  $('#go').onclick=()=>run(db);$('#chk').onclick=()=>check(db)}
function log(t){const l=$('#log');l.textContent+='\n'+t;l.scrollTop=l.scrollHeight}
const ready=()=>{if(!tgConfigured()||!hasSession()){log('Telegram non collegato: accedi dalla pagina Chat e riprova.');return false}return true};

async function elementi(db){
  const out=[];
  for(const sec of SECS){
    let snap;try{snap=await getDocs(collection(db,'sections',sec,'items'))}catch(e){continue}
    for(const d of snap.docs){const it={id:d.id,...d.data()};if(it.tg)out.push({sec,it})}}
  return out}

async function check(db){
  if(running||!ready())return;
  running=true;$('#chk').disabled=true;$('#go').disabled=true;
  try{
    log('Lettura dei dati…');await caricaDati();
    const r=await statoRegistro(),el=await elementi(db);
    const da=el.filter(x=>!x.it.enc);
    log('Registro: '+r.tot+' record, '+r.cifrati+' cifrati, '+r.chiaro+' ancora in chiaro'+(r.senzaChiave.length?' · non leggibili senza chiave: '+r.senzaChiave.join(', '):'')+'.');
    log('File su Telegram: '+el.length+', di cui '+da.length+' non ancora cifrati (quelli con marcatura «cifrato» sono già a posto).')
  }catch(e){console.error(e);log('Errore: '+tgErrText(e))}
  running=false;$('#chk').disabled=false;$('#go').disabled=false}

async function run(db){
  if(running||!ready())return;
  running=true;stop=false;$('#go').disabled=true;$('#chk').disabled=true;$('#st').disabled=false;
  let ok=0,skip=0,fail=0,noDel=0,mancanti=0;
  try{
    log('Lettura dei dati…');await caricaDati();
    const {client,tg}=await tgClient(),ent=await tgEntity(TG_FILES);
    const el=(await elementi(db)).filter(x=>!x.it.enc);
    log('FASE 1 – file da cifrare: '+el.length);
    for(const {sec,it} of el){
      if(stop)break;
      try{
        const [m]=await client.getMessages(ent,{ids:[it.tg]});
        if(!m||!m.media){mancanti++;log('  · '+(it.title||it.id)+': file non più presente su Telegram, saltato');continue}
        const buf=await client.downloadMedia(m,{}),bl=new Blob([buf]);
        if(await isCifrato(bl)){await updateDoc(doc(db,'sections',sec,'items',it.id),{enc:true});skip++;continue}
        const file=new File([bl],it.title||it.id,{type:guessMime(it.title||'',it.mime)});
        const r=await tgSendCifrato(tg,client,ent,file,()=>{},await tgTopic(TG_FILES,sec),sec);
        await updateDoc(doc(db,'sections',sec,'items',it.id),{tg:r.id,enc:true});     /* l'elemento punta al nuovo file prima di cancellare il vecchio */
        try{await client.deleteMessages(ent,[it.tg],{revoke:true})}catch(e){noDel++;console.warn(e)}
        ok++;if(ok%5===0)log('  … '+ok+' file cifrati');
        await sleep(700)
      }catch(e){fail++;log('  ✗ '+sec+'/'+(it.title||it.id)+': '+tgErrText(e));console.error(e)}}
    if(!stop){
      log('FASE 2 – registro dei dati');
      const r=await ricifraRegistro(log,()=>stop);
      fail+=r.fail;noDel+=r.noDel;log('  Registro: '+r.n+' record cifrati.')}
    log((stop?'Interrotto. ':'Finito. ')+ok+' file cifrati, '+skip+' già cifrati, '+mancanti+' mancanti'+(fail?', '+fail+' con errore (rilancia per riprovare)':'')+'.');
    if(noDel)log('ATTENZIONE: '+noDel+' vecchi messaggi in chiaro NON sono stati cancellati (serve l’account che li ha scritti o un amministratore del gruppo). Finché restano, sono leggibili dal gruppo: cancellali a mano da Telegram.')
  }catch(e){console.error(e);log('Errore: '+tgErrText(e))}
  running=false;$('#go').disabled=false;$('#chk').disabled=false;$('#st').disabled=true}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  const auth=getAuth(initializeApp(firebaseConfig)),db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    if(!u){location.href='index.html';return}
    try{const me=await getDoc(doc(db,'users',u.uid));
      if(!me.exists()||!me.data().admin){app.innerHTML=box('Solo admin','Questa pagina è riservata all’amministratore.');return}
      ui(db)}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.')}})}
