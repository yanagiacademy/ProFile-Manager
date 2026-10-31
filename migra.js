/* Migrazione una tantum: porta su Telegram tutti i contenuti già presenti su Firebase.
   Solo admin. Si può interrompere e riavviare: salta quello che è già su Telegram.
   Su Firebase non si cancella nulla: i contenuti migrati restano lì come copia (fb:true). I file salvati a blocchi su Firebase vengono caricati anche su Telegram. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,getDocs,doc,getDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {caricaDati,haRecord,scriviRecord,GRUPPO_DATI} from "./fsx.js";
import {hasSession,tgConfigured,tgClient,tgEntity,tgSendFile,tgErrText,tgTopic,topicTitle} from "./telegram.js";
import {TG_FILES} from "./telegram-config.js";
import {guessMime} from "./file-tools.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);
const SECS=['documenti','file-importanti','lezioni','tecnici','atleti','eventi','video','foto','commercialista','mail','archivio','documenti-in-scadenza'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stop=false,running=false;

function ui(db){
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who" style="flex:1"></span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2>Migrazione su Telegram</h2></div>
  <div class="card"><p>Porta su Telegram, nel gruppo <b>${esc(GRUPPO_DATI)}</b>, tutti i contenuti che oggi sono solo su Firebase (schede, elenchi, note, cartelle e documenti, promemoria). Su Firebase non viene cancellato nulla: i contenuti restano anche lì come copia.</p>
  <p class="mu">Si può interrompere e riavviare: quello che è già su Telegram viene saltato. Tieni aperta la pagina finché non finisce. Per non superare i limiti di Telegram il lavoro è lento (circa un contenuto al secondo).</p>
  <div class="acts" style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="go">Avvia migrazione</button><button class="btn ghost" id="st" disabled>Interrompi</button></div>
  <div id="log" role="log" aria-live="polite">Pronto.</div></div></div>`;
  $('#out').onclick=()=>signOut(getAuth()).then(()=>location.href='index.html');
  $('#st').onclick=()=>{stop=true;log('Interruzione richiesta…')};
  $('#go').onclick=()=>run(db)}
function log(t){const l=$('#log');l.textContent+='\n'+t;l.scrollTop=l.scrollHeight}

async function run(db){
  if(running)return;
  if(!tgConfigured()||!hasSession()){log('Telegram non collegato: accedi dalla pagina Chat e riprova.');return}
  running=true;stop=false;$('#go').disabled=true;$('#st').disabled=false;
  let ok=0,skip=0,fail=0,files=0;
  try{
    log('Collegamento a Telegram e lettura dei dati già presenti…');
    await caricaDati();
    log('Argomenti del gruppo: controllo e creazione…');
    for(const sec of SECS){const t=await tgTopic(GRUPPO_DATI,sec);log('  '+topicTitle(sec)+(t?' ✓':' – non disponibile (si scrive nel gruppo)'))}
    for(const sec of SECS){
      if(stop)break;
      let snap;try{snap=await getDocs(collection(db,'sections',sec,'items'))}catch(e){log('· '+sec+': non leggibile ('+(e.code||e.message)+')');continue}
      if(!snap.docs.length)continue;
      log('· '+sec+': '+snap.docs.length+' elementi');
      for(const d of snap.docs){
        if(stop)break;
        if(haRecord(sec,d.id)){skip++;continue}
        const data={...d.data(),fb:true};
        try{
          if(data.kind==='file'&&!data.tg&&data.chunks){
            const cs=await getDocs(collection(db,'sections',sec,'items',d.id,'chunks'));
            const parts=cs.docs.map(x=>({i:x.data().i,b:x.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
            if(!parts.length)throw new Error('blocchi mancanti');
            const f=new File(parts,data.title||d.id,{type:guessMime(data.title||'',data.mime)});
            const {client,tg}=await tgClient(),ent=await tgEntity(TG_FILES);
            const r=await tgSendFile(tg,client,ent,f,()=>{},'auto',undefined,await tgTopic(TG_FILES,sec));data.tg=r.id;files++;await sleep(700)}
          await scriviRecord(sec,d.id,data,db);ok++;
          if(ok%10===0)log('  … '+ok+' migrati');
          await sleep(700)
        }catch(e){fail++;log('  ✗ '+sec+'/'+(data.title||d.id)+': '+tgErrText(e));console.error(e)}}
      if(stop)break;
      try{const m=await getDoc(doc(db,'sections',sec,'meta','promemoria'));
        if(m.exists()&&!haRecord('meta-'+sec,'promemoria')){await scriviRecord('meta-'+sec,'promemoria',m.data(),db);ok++;await sleep(700)}}catch(e){}}
    log((stop?'Interrotto. ':'Finito. ')+ok+' migrati ('+files+' file caricati su Telegram), '+skip+' già presenti'+(fail?', '+fail+' con errore (rilancia per riprovare)':'')+'.');
  }catch(e){console.error(e);log('Errore: '+tgErrText(e))}
  running=false;$('#go').disabled=false;$('#st').disabled=true}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  const auth=getAuth(initializeApp(firebaseConfig)),db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    if(!u){location.href='index.html';return}
    try{const me=await getDoc(doc(db,'users',u.uid));
      if(!me.exists()||!me.data().admin){app.innerHTML=box('Solo admin','Questa pagina è riservata all’amministratore.');return}
      ui(db)}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.')}})}
