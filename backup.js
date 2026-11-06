/* Backup (solo admin): crea una copia di tutti i dati (e, se si vuole, dei file), la CIFRA con una password scelta al momento
   e la invia su Telegram al contatto indicato in DESTINATARIO. Se la password si perde il backup non si può aprire.
   Contenuto del backup (ZIP, poi cifrato): dati/<sezione>.json (registro), firestore/<raccolta>.json (account, atleti collegati, iscrizioni…),
   file/<sezione>/… (i file, già decifrati), LEGGIMI.txt. Non include le chiavi di cifratura, le password degli account né i bonifici caricati dagli atleti
   (blocchi delle iscrizioni). Una "Apri un backup" su questa pagina decifra il file e lo scarica come ZIP. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getDoc as getDocSdk} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {getFirestore,doc,collection,getDocs,getDoc,setDoc,serverTimestamp,caricaDati,esportaRegistro,logEvento} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio} from "./archivio.js";
import {tgClient,tgErrText,hasSession,tgConfigured,tgSendFile} from "./telegram.js";
import {saveBlob} from "./file-tools.js";
import {cifraPassword,decifraPassword,isBackup} from "./cifra.js";

/* A chi si manda il backup (nome utente Telegram, senza @). Cambialo qui se serve. */
const DESTINATARIO='LorisAntolini';
const PARTE_MAX=200*1024*1024;                 /* ogni parte resta sotto questa dimensione: la cifratura tiene in memoria il file e la sua copia */
const RACCOLTE=['users','app','atletiMail','atletiEmail','atletiDati','atletiModifiche','iscrizioni'];

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);
const MB=b=>(b/1048576).toFixed(b<10485760?1:0)+' MB';
const pad=n=>String(n).padStart(2,'0');
const stamp=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes());
const safe=s=>String(s||'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').replace(/\s+/g,' ').trim().slice(0,90)||'file';

let zp=null;
const loadZip=()=>zp||(zp=new Promise((res,rej)=>{
  if(window.JSZip)return res(window.JSZip);
  const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload=()=>res(window.JSZip);s.onerror=()=>{zp=null;rej(new Error('Impossibile caricare lo strumento ZIP (serve la connessione)'))};document.head.append(s)}));

let auth,db,me=null,running=false,stop=false,logEl=null;
const log=t=>{if(!logEl)return;logEl.textContent+=(logEl.textContent?'\n':'')+t;logEl.scrollTop=logEl.scrollHeight};

function ui(){
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Backup</h2><span class="badge">Solo admin</span></div></div>
  <div class="card"><h2>Crea e invia un backup</h2>
    <div class="mu" id="ult">Ultimo backup: …</div>
    <p class="mu">Crea una copia di tutti i dati (e, se vuoi, dei file), la cifra con una password e la invia su Telegram a <b>@${esc(DESTINATARIO)}</b>.</p>
    <div class="pw"><div><label for="p1" style="margin-top:0">Password del backup</label><input id="p1" type="password" autocomplete="new-password"></div><div><label for="p2" style="margin-top:0">Ripeti la password</label><input id="p2" type="password" autocomplete="new-password"></div></div>
    <p class="mu" style="margin:6px 0 0"><b>Annotala in un posto sicuro:</b> non viene salvata da nessuna parte e senza di lei il backup non si può aprire. Minimo 8 caratteri.</p>
    <label class="ck" style="margin-top:12px"><input type="checkbox" id="cf" checked style="width:auto;min-height:0"> Includi anche i file</label>
    <div class="mu" id="stima"></div>
    <p class="err" id="er" role="alert"></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="go">Crea e invia il backup</button><button class="btn ghost" id="st" disabled>Interrompi</button></div>
    <div class="lg" id="log" role="log" aria-live="polite" hidden></div></div>
  <div class="card" style="margin-top:12px"><h2>Apri un backup</h2>
    <p class="mu">Scegli un file <code>.pfmb</code> scaricato da Telegram e inserisci la password: viene decifrato e scaricato come ZIP (apribile con il computer).</p>
    <label for="bf" style="margin-top:0">File del backup</label><input id="bf" type="file" accept=".pfmb">
    <label for="bp">Password</label><input id="bp" type="password" autocomplete="off">
    <p class="err" id="er2" role="alert"></p><button class="btn" id="ap">Decifra e scarica lo ZIP</button></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#go').onclick=crea;$('#st').onclick=()=>{stop=true;log('Interruzione richiesta: finisco la parte in corso…')};$('#ap').onclick=apri;
  $('#cf').onchange=stima;
  getDoc(doc(db,'app','backup')).then(s=>{if(s.exists()){const d=s.data(),t=d.at&&d.at.toDate?d.at.toDate():null;
    $('#ult').textContent='Ultimo backup: '+(t?t.toLocaleDateString('it-IT')+' alle '+t.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}):'data non disponibile')+(d.by?' · '+d.by:'')+(d.parti?' · '+d.parti+(d.parti===1?' parte':' parti'):'')+(d.conFile?' con i file':' solo dati')+'.'}
    else $('#ult').textContent='Nessun backup eseguito finora.'}).catch(()=>{$('#ult').textContent=''});
  stima()}
async function elencoFile(){
  await caricaDati();const reg=await esportaRegistro(),out=[];
  for(const sec in reg){if(sec==='cestino'||sec==='storico'||sec.startsWith('meta-'))continue;
    for(const id in reg[sec]){const st=reg[sec][id];if(st.kind==='file'&&(st.tg||st.chunks))out.push({sec,id,st})}}
  return {reg,files:out}}
async function stima(){
  const el=$('#stima');if(!el)return;
  if(!$('#cf').checked){el.textContent='Solo dati: pochi secondi.';return}
  if(!tgConfigured()||!hasSession()){el.textContent='';return}
  try{const {files}=await elencoFile(),b=files.reduce((s,f)=>s+(f.st.size||0),0);
    el.textContent=files.length+(files.length===1?' file':' file')+', circa '+MB(b)+(b>PARTE_MAX?' · verrà diviso in '+Math.ceil(b/PARTE_MAX)+' parti circa':'')+'.'}catch(e){el.textContent=''}}

async function crea(){
  if(running)return;
  const p1=$('#p1').value,p2=$('#p2').value,er=$('#er'),cf=$('#cf').checked;
  if(p1.length<8){er.textContent='La password deve avere almeno 8 caratteri.';return}
  if(p1!==p2){er.textContent='Le due password non coincidono.';return}
  if(!tgConfigured()||!hasSession()){er.textContent='Telegram non è collegato: accedi dalla pagina Chat e riprova.';return}
  er.textContent='';running=true;stop=false;logEl=$('#log');logEl.hidden=false;logEl.textContent='';
  $('#go').disabled=true;$('#st').disabled=false;
  const t0=new Date();let parti=0,nFile=0,tot=0,errori=[];
  try{
    const J=await loadZip();
    log('Lettura dei dati…');
    const {reg,files}=await elencoFile();
    const {client,tg}=await tgClient(),dest=await client.getEntity(DESTINATARIO);
    log('Destinatario: @'+DESTINATARIO);
    /* dati del registro e di Firebase */
    const dati={},fire={};
    for(const sec in reg)dati[sec]=reg[sec];
    for(const r of RACCOLTE){try{const sn=await getDocs(collection(db,r));fire[r]=sn.docs.map(d=>({id:d.id,...JSON.parse(JSON.stringify(d.data()))}))}catch(e){log('  (raccolta '+r+' non letta: '+(e&&e.code||'errore')+')')}}
    const nomeBase='pfm-backup-'+stamp(t0);
    let zip=new J(),bytes=0,inParte=[];
    const leggimi=`BACKUP PROFILE MANAGER — ${t0.toLocaleString('it-IT')}
Creato da: ${me.name||me.email||''}
Contenuto: ${cf?'dati e file':'solo dati'}

dati/<sezione>.json    registro di ogni sezione: {id elemento: campi}. Le date sono {"$ts": millisecondi dal 1970}.
firestore/<raccolta>.json   account, atleti collegati, iscrizioni… (senza chiavi di cifratura né password).
file/<sezione>/<id>_<nome>   i file, già decifrati. L'elenco di ogni parte è in indice-parteN.json.
Il backup è diviso in più parti se i file sono tanti: servono tutte le parti.
Non contiene le chiavi di cifratura, le password degli account né i bonifici caricati dagli atleti.
`;
    const chiudi=async(ultima)=>{
      parti++;
      if(ultima&&errori.length)zip.file('errori.txt',errori.join('\n'));
      zip.file('indice-parte'+parti+'.json',JSON.stringify(inParte,null,1));
      log('Parte '+parti+': creazione dello ZIP…');
      const zb=await zip.generateAsync({type:'blob',compression:'STORE'});
      log('Parte '+parti+': cifratura ('+MB(zb.size)+')…');
      const enc=await cifraPassword(zb,p1);tot+=enc.size;
      const nome=nomeBase+'-p'+parti+'.pfmb';
      log('Parte '+parti+': invio a Telegram…');
      await tgSendFile(tg,client,dest,new File([enc],nome,{type:'application/octet-stream'}),()=>{},'auto','Backup ProFile Manager '+t0.toLocaleDateString('it-IT')+' · parte '+parti);
      log('Parte '+parti+' inviata.');
      zip=new J();bytes=0;inParte=[]};
    zip.file('LEGGIMI.txt',leggimi);
    for(const s in dati)zip.file('dati/'+s+'.json',JSON.stringify(dati[s],null,1));
    for(const r in fire)zip.file('firestore/'+r+'.json',JSON.stringify(fire[r],null,1));
    if(cf){
      log('File da includere: '+files.length);
      for(const f of files){
        if(stop)break;
        const nome=f.st.title||f.id;
        try{
          const blob=await archivio(db,f.sec,me.id).getBlob({...f.st,id:f.id});
          if(bytes>0&&bytes+blob.size>PARTE_MAX)await chiudi(false);
          zip.file('file/'+f.sec+'/'+f.id+'_'+safe(nome),blob);bytes+=blob.size;nFile++;
          inParte.push({sezione:f.sec,id:f.id,nome,dimensione:blob.size,percorso:'file/'+f.sec+'/'+f.id+'_'+safe(nome)});
          if(nFile%10===0)log('  … '+nFile+' file preparati')
        }catch(e){errori.push(f.sec+'/'+f.id+' '+nome+': '+tgErrText(e));log('  ✗ '+nome+': '+tgErrText(e))}}}
    await chiudi(true);
    await client.sendMessage(dest,{message:'Backup ProFile Manager del '+t0.toLocaleString('it-IT')+' completo: '+parti+(parti===1?' parte':' parti')+(cf?', '+nFile+' file':', solo dati')+(stop?' (INTERROTTO: incompleto)':'')+'. Servono tutte le parti e la password.',silent:true});
    if(!stop)await setDoc(doc(db,'app','backup'),{at:serverTimestamp(),by:me.name||me.email||'',parti,conFile:cf,files:nFile,byte:tot});
    logEvento('backup','','', 'Backup '+(stop?'interrotto':'completato'),parti+(parti===1?' parte':' parti')+(cf?', '+nFile+' file':', solo dati')+(errori.length?', '+errori.length+' file non inclusi':''));
    log((stop?'Interrotto. ':'Finito. ')+parti+(parti===1?' parte inviata':' parti inviate')+' ('+MB(tot)+')'+(errori.length?' · '+errori.length+' file non inclusi (elenco in errori.txt)':'')+'.');
    $('#p1').value=$('#p2').value=''
  }catch(e){console.error(e);log('Errore: '+(e&&e.message==='PASSWORD'?'password mancante':tgErrText(e)));er.textContent='Backup non riuscito. Controlla che Telegram sia collegato e che @'+DESTINATARIO+' esista, poi riprova.'}
  running=false;$('#go').disabled=false;$('#st').disabled=true}

async function apri(){
  const f=$('#bf').files[0],pw=$('#bp').value,er=$('#er2');er.textContent='';
  if(!f){er.textContent='Scegli il file del backup.';return}
  if(!pw){er.textContent='Inserisci la password.';return}
  $('#ap').disabled=true;er.textContent='Decifratura in corso…';
  try{
    if(!await isBackup(f)){er.textContent='Questo file non è un backup di ProFile Manager.';$('#ap').disabled=false;return}
    const blob=await decifraPassword(f,pw,'application/zip');
    saveBlob(blob,f.name.replace(/\.pfmb$/i,'')+'.zip');er.textContent='Fatto: lo ZIP è stato scaricato.'
  }catch(e){er.textContent=e&&e.message==='PASSWORD'?'Password errata o file danneggiato.':'Impossibile aprire il backup.'}
  $('#ap').disabled=false}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    if(!u){location.href='index.html';return}
    try{const sn=await getDocSdk(doc(db,'users',u.uid));me=sn.exists()?{id:u.uid,...sn.data()}:null}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.');return}
    if(!me||!me.admin){app.innerHTML=box('Solo admin','Il backup è riservato all’amministratore.');return}
    ui()})}
