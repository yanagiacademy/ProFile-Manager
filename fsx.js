/* fsx.js – archiviazione dei contenuti su TELEGRAM, con copia facoltativa su Firebase.
   Sostituisce l'import di "firebase-firestore.js": espone le stesse funzioni (doc, collection, onSnapshot, addDoc, setDoc, updateDoc,
   deleteDoc, getDocs, serverTimestamp, deleteField, arrayUnion…), ma
     • sections/<sezione>/items/…  e  sections/<sezione>/meta/…  → registro su Telegram (gruppo TG_DATI, altrimenti TG_FILES)
     • tutto il resto (users, app, blocchi dei file copiati: …/chunks)  → Firestore, come prima.
   Registro: ogni scrittura è un messaggio "#pfm #s_<sezione> #r_<id>" + JSON (in base64 se sta nel messaggio, altrimenti file .json).
   Le versioni si sommano in ordine di messaggio; le cancellazioni sono messaggi "del". Cache locale (IndexedDB) e sincronizzazione incrementale.
   Un contenuto con campo fb:true viene copiato anche su Firestore (stesso percorso) e, se Telegram non è raggiungibile, si legge da lì.
   Se Telegram non è configurato tutto resta su Firestore come prima. */
import * as SDK from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {tgConfigured,hasSession,tgClient,tgEntity,tgSendFile,tgErrText,tgTopic,tgReset,withTimeout} from "./telegram.js";
import * as CFG from "./telegram-config.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {setDb,CIFRA_ATTIVA,cifraBlob,cifraTesto,decifraBlob,decifraTesto,keyIdOf,haChiave,b64e} from "./cifra.js";

let DB=null;
export const getFirestore=(...a)=>{const d=SDK.getFirestore(...a);DB=d;setDb(d);return d},Bytes=SDK.Bytes,Timestamp=SDK.Timestamp;
const okName=v=>typeof v==='string'&&v.trim()!==''&&v.trim()!=='INSERISCI';
export const GRUPPO_DATI=okName(CFG.TG_DATI)?CFG.TG_DATI:CFG.TG_FILES;
const TAG='#pfm',COMPACT=12,FULL_MS=24*3600*1000;

/* ---------- valori speciali ---------- */
class Sent{constructor(k,v){this.k=k;this.v=v}}
export const serverTimestamp=()=>new Sent('ts');
export const deleteField=()=>new Sent('del');
export const arrayUnion=(...v)=>new Sent('union',v);
const plain=v=>v&&typeof v==='object'&&(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype);
const isTs=v=>v&&typeof v==='object'&&typeof v.toMillis==='function'&&'seconds' in v;
/* verso il registro (formato "wire": JSON semplice, date come {$ts:millisecondi}) */
function ser(v){
  if(v instanceof Sent){if(v.k==='ts')return {$ts:Date.now()};if(v.k==='del')return {$del:1};return {$union:v.v.map(ser)}}
  if(isTs(v))return {$ts:v.toMillis()};
  if(v instanceof Date)return {$ts:v.getTime()};
  if(Array.isArray(v))return v.map(ser);
  if(plain(v)){const o={};for(const k in v)if(v[k]!==undefined)o[k]=ser(v[k]);return o}
  return v}
/* dal registro verso l'app (le date tornano Timestamp, come con Firestore) */
function rev(v){
  if(Array.isArray(v))return v.map(rev);
  if(v&&typeof v==='object'){
    if(Object.keys(v).length===1&&typeof v.$ts==='number')return SDK.Timestamp.fromMillis(v.$ts);
    const o={};for(const k in v)o[k]=rev(v[k]);return o}
  return v}
/* verso Firestore reale (modalità senza Telegram e copia) */
function toSdk(v){
  if(v instanceof Sent){if(v.k==='ts')return SDK.serverTimestamp();if(v.k==='del')return SDK.deleteField();return SDK.arrayUnion(...v.v.map(toSdk))}
  if(Array.isArray(v))return v.map(toSdk);
  if(plain(v)){const o={};for(const k in v)if(v[k]!==undefined)o[k]=toSdk(v[k]);return o}
  return v}
const clone=o=>JSON.parse(JSON.stringify(o));
function applyUpd(st,d){for(const k in d){const v=d[k];
  if(v&&v.$del)delete st[k];
  else if(v&&Array.isArray(v.$union)){const a=Array.isArray(st[k])?st[k]:[];for(const x of v.$union)if(!a.some(y=>JSON.stringify(y)===JSON.stringify(x)))a.push(x);st[k]=a}
  else st[k]=v}}
const cleanSet=d=>{const o={};for(const k in d){const v=d[k];if(v&&(v.$del||v.$union))continue;o[k]=v}return o};

/* ---------- messaggi e avvisi ---------- */
let warnEl=null;
/* ---------- LED di stato nella barra in alto: verde = sincronizzato, giallo = in corso, rosso = problema, grigio = Telegram non collegato ---------- */
const LED={ok:['#2E9E5B','Sincronizzato con Telegram'],busy:['#E0A800','Sincronizzazione in corso…'],err:['#D93025','Problema di sincronizzazione'],off:['#8A94A6','Telegram non collegato']};
let ledEl=null,ledSt='ok',ledMsg='',busyN=0,lastErr='',ledObs=null;
function ledPlace(){
  if(!ledEl)return;const t=document.querySelector('.top');
  if(t){if(ledEl.parentElement!==t){ledEl.style.position='';ledEl.style.top=ledEl.style.right='';t.append(ledEl)}}
  else if(ledEl.parentElement!==document.body){ledEl.style.cssText+=';position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);right:8px;z-index:70';document.body.append(ledEl)}}
function ledInit(){
  if(ledEl||typeof document==='undefined'||!document.body)return;
  if(!document.getElementById('pfm-led-css')){const st=document.createElement('style');st.id='pfm-led-css';
    st.textContent='.pfm-led{flex:none;width:26px;height:26px;padding:0;border:0;background:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin-left:auto}.pfm-led i{display:block;width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px var(--sf,#fff),0 0 7px 1px var(--c)}.pfm-led[data-s=busy] i{animation:pfmled 1s ease-in-out infinite}@keyframes pfmled{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.pfm-led[data-s=busy] i{animation:none}}';
    document.head.append(st)}
  ledEl=document.createElement('button');ledEl.type='button';ledEl.className='pfm-led';ledEl.innerHTML='<i></i>';
  ledEl.onclick=()=>{
    const t=ledMsg||LED[ledSt][1];
    if(ledSt==='err'){avviso(t+' Riprovo ora…');sync(false).then(()=>avviso('Sincronizzato.')).catch(()=>{})}
    else avviso(t)};
  ledPlace();ledShow();
  let raf=0;ledObs=new MutationObserver(()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;ledPlace()})});
  ledObs.observe(document.body,{childList:true,subtree:true})}
function ledShow(){
  if(!ledEl)return;const c=LED[ledSt];
  ledEl.dataset.s=ledSt;ledEl.style.setProperty('--c',c[0]);
  const t=(ledMsg||c[1]);ledEl.title=t;ledEl.setAttribute('aria-label','Stato sincronizzazione: '+t)}
function ledSet(st,msg){ledSt=st;ledMsg=msg||'';ledInit();ledShow()}
/* stato calcolato: errore > lavoro in corso > ok */
function ledCalc(){
  if(!hasSession()){ledSet('off','Telegram non collegato: accedi dalla Chat.');return}
  if(lastErr)ledSet('err',lastErr+' Tocca per riprovare.');
  else if(busyN>0)ledSet('busy','');else ledSet('ok','')}
const busyIn=()=>{busyN++;ledCalc()},busyOut=()=>{busyN=Math.max(0,busyN-1);ledCalc()};
function avviso(html,link){
  if(!warnEl){warnEl=document.createElement('div');warnEl.setAttribute('role','alert');
    warnEl.style.cssText='position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 52px);z-index:60;max-width:560px;margin:0 auto;padding:10px 14px;border-radius:10px;font-size:.85rem;background:var(--sf,#fff);color:var(--tx,#14213D);border:2px solid var(--ac2,#B8A24A);display:flex;gap:10px;align-items:center';document.body.append(warnEl)}
  warnEl.innerHTML='';const s=document.createElement('span');s.style.flex='1';s.textContent=html;warnEl.append(s);
  if(link){const a=document.createElement('a');a.href=link[1];a.textContent=link[0];a.style.cssText='font-weight:700;color:inherit;white-space:nowrap';warnEl.append(a)}
  const x=document.createElement('button');x.textContent='✕';x.setAttribute('aria-label','Chiudi avviso');x.style.cssText='background:none;border:0;font-size:1rem;padding:2px 6px';x.onclick=()=>{warnEl.style.display='none'};warnEl.append(x);
  warnEl.style.display='flex'}

/* ---------- cache locale (IndexedDB) ---------- */
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('pfm_dati',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function kvGet(k){try{const d=await idb();return await new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}catch(e){return undefined}}
async function kvSet(k,v){try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}catch(e){}}

/* ---------- stato: registro sommato ---------- */
let auto=true;
export const setAutoSync=v=>{auto=!!v};
let C={v:1,lastId:0,full:0,recs:{}},loaded=false,firstDone=false,startP=null,syncP=null,timer=null;
const subs=new Set();
const recOf=(sec,id)=>(C.recs[sec]||{})[id];
function apply(sec,rid,mid,o,d,enc){
  const S=C.recs[sec]||(C.recs[sec]={});let r=S[rid];
  if(r&&r.mids.includes(mid))return;
  if(o==='set'){S[rid]={st:cleanSet(d||{}),mids:[mid],x:0,pl:enc?0:1};return}
  if(!r)r=S[rid]={st:{},mids:[],x:0,pl:0};
  r.mids.push(mid);if(!enc)r.pl=(r.pl||0)+1;
  if(o==='del'){r.x=1;return}
  if(r.x)return;
  applyUpd(r.st,d||{})}
const fireAll=()=>{for(const s of subs)s.fire()};
const ready=()=>loaded&&firstDone;

async function decode(client,m){
  let raw,enc=false;
  try{
    if(m.media&&m.media.document){
      const buf=await client.downloadMedia(m,{});          /* un errore di rete qui interrompe la sincronizzazione: niente va perso */
      const bl=new Blob([buf]),dl=await decifraBlob(bl);enc=dl!==bl;
      raw=new TextDecoder().decode(await dl.arrayBuffer())}
    else{
      const t=m.message||'',i=t.indexOf('\n');if(i<0)return null;
      const body=t.slice(i+1).trim();
      if(body.startsWith('E1:')){raw=await decifraTesto(body.slice(3));enc=true}
      else raw=decodeURIComponent(escape(atob(body)))}
  }catch(e){
    if(e&&e.message==='NOKEY')return {noKey:e.keyId||'?'};     /* messaggio cifrato con una chiave che questo utente non può leggere */
    if(e&&e.message==='CORROTTO'){console.warn('Messaggio cifrato non valido',m.id);return null}
    if(m.media&&m.media.document)throw e;return null}
  try{const j=JSON.parse(raw);if(!j||!j.s||!j.r||!j.o)return null;return {s:j.s,r:j.r,o:j.o,d:j.d,mid:m.id,enc}}catch(e){return null}}
async function pool(list,n,fn){const out=new Array(list.length);let i=0;await Promise.all(Array.from({length:Math.min(n,list.length)},async()=>{while(i<list.length){const k=i++;out[k]=await fn(list[k])}}));return out}

let gen=0;
async function doSync(full,g){
  {
    /* se ora si ha la chiave di una sezione che prima non si poteva leggere, si rilegge tutto */
    if(!full&&C.miss&&C.miss.length&&Date.now()-(C.missChk||0)>5*60*1000){
      C.missChk=Date.now();
      for(const id of C.miss){if(await haChiave(id)){full=true;break}}}
    const {client}=await tgClient(),ent=await tgEntity(GRUPPO_DATI);
    const base=full?{v:1,lastId:0,full:Date.now(),recs:{}}:C;
    const msgs=[];let maxSeen=base.lastId||0;
    const opt={limit:undefined};if(base.lastId)opt.minId=base.lastId;
    for await(const m of client.iterMessages(ent,opt)){if(g!==gen)return;if(m.id>maxSeen)maxSeen=m.id;if(m.message&&m.message.startsWith(TAG))msgs.push(m)}
    msgs.sort((a,b)=>a.id-b.id);
    const dec=await pool(msgs,5,m=>decode(client,m));      /* un errore di rete interrompe: niente va perso */
    if(g!==gen)return;      /* sincronizzazione scaduta nel frattempo: il suo risultato si scarta */
    if(full)C=base;
    const miss=new Set(full?[]:(C.miss||[]));
    for(const x of dec){if(!x)continue;if(x.noKey){miss.add(x.noKey);continue}apply(x.s,x.r,x.mid,x.o,x.d,x.enc)}
    C.miss=[...miss];
    C.lastId=Math.max(C.lastId||0,maxSeen);if(!C.full)C.full=Date.now();
    kvSet('cache:'+GRUPPO_DATI,C);
    firstDone=true;fireAll();
  }}
/* Una chiamata di rete rimasta appesa non deve bloccare per sempre: dopo il tempo massimo si abbandona, si riapre la connessione e si ritenta. */
function sync(full=false){
  if(syncP)return syncP;
  const g=++gen;busyIn();
  syncP=withTimeout(doSync(full,g),full?300000:75000,'TIMEOUT_SYNC')
    .then(r=>{lastErr='';return r})
    .catch(e=>{if(g===gen)gen++;lastErr=tgErrText(e);if(/^TIMEOUT|CONNECTION|disconnect/i.test((e&&e.message)||''))tgReset();throw e})
    .finally(()=>{syncP=null;busyOut()});
  return syncP}
async function syncUntil(mid){for(let i=0;i<4;i++){await sync(false);if((C.lastId||0)>=mid)return}}

function startOnce(){
  if(startP)return startP;
  startP=(async()=>{
    const saved=await kvGet('cache:'+GRUPPO_DATI);
    if(saved&&saved.v===1&&saved.recs)C=saved;
    loaded=true;if(C.lastId>0)firstDone=true;
    if(firstDone)fireAll();
    try{await sync(!C.full||Date.now()-C.full>FULL_MS)}
    catch(e){console.error(e);if(!firstDone){startP=null;throw e}avviso('Telegram non raggiungibile: vedi i dati dell’ultima sincronizzazione ('+tgErrText(e)+').')}
    if(!timer)timer=setInterval(()=>{if(auto&&document.visibilityState==='visible'&&subs.size)sync(false).catch(e=>console.error(e))},20000);
  })();
  return startP}
export const caricaDati=startOnce;
/* ricarica subito i dati da Telegram (usata quando cambia una stella) */
export const syncNow=()=>startOnce().then(()=>sync(false));
export const datiPronti=ready;

/* ---------- riferimenti ---------- */
const newId=()=>{const a=new Uint8Array(16);crypto.getRandomValues(a);return Array.from(a,b=>(b%36).toString(36)).join('')};
const isTgArgs=a=>tgConfigured()&&a[1]==='sections'&&(a[3]==='items'||a[3]==='meta')&&typeof a[2]==='string';
const tgRef=(db,S,coll,id)=>({__tg:1,db,S,coll,id,sec:coll==='meta'?'meta-'+S:S});
const sdkRef=r=>r.id?SDK.doc(r.db,'sections',r.S,r.coll,r.id):SDK.collection(r.db,'sections',r.S,r.coll);
export function doc(...a){
  if(a[0]&&a[0].__tg){const c=a[0];return tgRef(c.db,c.S,c.coll,a[1]||newId())}
  if(isTgArgs(a)&&a.length===5)return tgRef(a[0],a[2],a[3],a[4]);
  return SDK.doc(...a)}
export function collection(...a){
  if(isTgArgs(a)&&a.length===4)return tgRef(a[0],a[2],a[3],null);
  return SDK.collection(...a)}

/* ---------- lettura ---------- */
function snapOf(ref){
  if(!ref.id)return {docs:Object.entries(C.recs[ref.sec]||{}).filter(([,r])=>!r.x).map(([id,r])=>({id,exists:()=>true,data:()=>rev(r.st)})),size:0};
  const r=recOf(ref.sec,ref.id),ok=!!r&&!r.x;
  return {id:ref.id,exists:()=>ok,data:()=>ok?rev(r.st):undefined}}
export function onSnapshot(ref,cb,err){
  if(!ref||!ref.__tg)return SDK.onSnapshot(ref,cb,err);
  let un=null,dead=false;
  const toSdk_=(e,msg)=>{if(un||dead)return;
    if(msg)avviso(msg[0],msg[1]);
    un=SDK.onSnapshot(sdkRef(ref),cb,err)};
  const sub={fire(){if(un||dead||!ready())return;const s=snapOf(ref);if(!ref.id)s.size=s.docs.length;cb(s)}};
  if(!hasSession()){ledCalc();toSdk_(null,['Telegram non collegato: vedi solo i contenuti salvati anche su Firebase. Per vedere e modificare tutto accedi a Telegram.',['Accedi','chat.html']])}
  else{
    subs.add(sub);
    startOnce().then(()=>sub.fire(),e=>{subs.delete(sub);toSdk_(e,['Telegram non raggiungibile ('+tgErrText(e)+'): vedi solo i contenuti salvati anche su Firebase.',['Chat','chat.html']])});
    if(ready())sub.fire()}
  return ()=>{dead=true;subs.delete(sub);if(un)un()}}
export async function getDocs(ref){
  if(!ref||!ref.__tg)return SDK.getDocs(ref);
  await startOnce();const s=snapOf(ref);s.size=s.docs.length;return s}
export const getDoc=async ref=>{if(!ref||!ref.__tg)return SDK.getDoc(ref);await startOnce();return snapOf(ref)};

/* ---------- scrittura ---------- */
async function tgSend(sec,rid,o,d){
  if(!hasSession())throw new Error('NO_SESSION');
  const {client,tg}=await tgClient(),ent=await tgEntity(GRUPPO_DATI),topic=await tgTopic(GRUPPO_DATI,sec);
  const body=JSON.stringify({s:sec,r:rid,o,t:Date.now(),d});
  const head=TAG+' #s_'+sec.replace(/[^a-z0-9]/gi,'_')+' #r_'+rid;
  if(CIFRA_ATTIVA){
    /* cifrato: se la chiave non è disponibile si ferma con errore, non si scrive mai in chiaro */
    const id=keyIdOf(sec),bytes=new TextEncoder().encode(body);
    const blob=await cifraBlob(new Blob([bytes]),id),b64=b64e(new Uint8Array(await blob.arrayBuffer()));
    if(head.length+4+b64.length<=3800){const m=await client.sendMessage(ent,{message:head+'\nE1:'+b64,silent:true,...(topic?{replyTo:topic}:{})});return m.id}
    const f=new File([blob],rid+'.bin',{type:'application/octet-stream'});
    const m=await tgSendFile(tg,client,ent,f,()=>{},'auto',head,topic);return m.id}
  const b64=btoa(unescape(encodeURIComponent(body)));
  if(head.length+1+b64.length<=3800){const m=await client.sendMessage(ent,{message:head+'\n'+b64,silent:true,...(topic?{replyTo:topic}:{})});return m.id}
  const f=new File([body],rid+'.json',{type:'application/json'});
  const m=await tgSendFile(tg,client,ent,f,()=>{},'auto',head,topic);return m.id}
/* invio con tempo massimo e un secondo tentativo dopo aver riaperto la connessione (i messaggi del registro sono idempotenti: un doppione non cambia il risultato) */
async function tgSendSicuro(sec,rid,o,d){
  for(let i=0;;i++){
    try{return await withTimeout(tgSend(sec,rid,o,d),60000,'TIMEOUT_SEND')}
    catch(e){const m=(e&&e.message)||'';
      if(i>=1||!/^TIMEOUT|CONNECTION|disconnect|Not connected|network/i.test(m))throw e;
      await tgReset()}}}
async function tgDeleteMsgs(ids){
  if(!ids.length)return;
  try{const {client}=await tgClient(),ent=await tgEntity(GRUPPO_DATI);await client.deleteMessages(ent,ids,{revoke:true})}catch(e){}}
const protetto=r=>{const t=r&&r.st&&r.st.conservaFinoTs;return !!(t&&typeof t.$ts==='number'&&t.$ts>Date.now())};
const errProt=()=>{const e=new Error('PROTETTO');e.code='permission-denied';return e};

/* copia facoltativa su Firebase (stesso percorso): fb:true = salvato anche lì */
async function mirror(ref,prevFb){
  try{
    const r=recOf(ref.sec,ref.id),d=sdkRef(ref);
    if(r&&!r.x&&r.st.fb)await SDK.setDoc(d,rev(r.st));
    else if(prevFb)await SDK.deleteDoc(d)
  }catch(e){console.error(e);avviso('Salvato su Telegram, ma la copia su Firebase non è riuscita'+(e&&e.code?' ('+e.code+')':'')+'.')}}

async function write(ref,o,d,noMirror){
  busyIn();
  try{
    await startOnce();
    const r0=recOf(ref.sec,ref.id),prevFb=!!(r0&&!r0.x&&r0.st.fb);
    let mid,old=[],so=o,sd=d;
    try{
      if(o==='upd'&&r0&&r0.mids.length>=COMPACT){
        const st=clone(r0.st);applyUpd(st,d);old=r0.mids.slice();so='set';sd=st;
        mid=await tgSendSicuro(ref.sec,ref.id,'set',st)}
      else mid=await tgSendSicuro(ref.sec,ref.id,o,d)}
    catch(e){lastErr='Modifica non salvata: '+tgErrText(e);ledCalc();throw e}
    lastErr='';
    /* il messaggio è su Telegram: la modifica è al sicuro. Se la rilettura non riesce la si applica qui in locale e si riallinea dopo. */
    try{await syncUntil(mid)}
    catch(e){console.warn('Rilettura dopo il salvataggio non riuscita:',e&&e.message);
      try{apply(ref.sec,ref.id,mid,so,sd,CIFRA_ATTIVA);fireAll()}catch(e2){console.error(e2)}
      setTimeout(()=>sync(false).catch(()=>{}),4000)}
    if(old.length)tgDeleteMsgs(old);
    if(o==='del'){const r=recOf(ref.sec,ref.id);if(r)tgDeleteMsgs(r.mids.filter(x=>x!==mid))}
    if(!noMirror)await mirror(ref,prevFb)
  }finally{busyOut()}}
/* ---------- storico dei movimenti (solo l'admin lo legge: cifrato con la chiave pubblica "storico") ---------- */
const titoloDi=(st,id)=>String((st&&(st.title||st.titolo||st.nome||st.descr))||id||'').slice(0,160);
let uCache=null;
async function utente(){
  try{const u=getAuth(DB.app).currentUser;if(!u)return {uid:'?',nome:''};
    if(uCache&&uCache.uid===u.uid)return uCache.p;
    const p=(async()=>{let nome='';try{const sn=await SDK.getDoc(SDK.doc(DB,'users',u.uid));if(sn.exists())nome=sn.data().name||sn.data().email||''}catch(e){}return {uid:u.uid,nome:nome||u.email||''}})();
    uCache={uid:u.uid,p};return p}catch(e){return {uid:'?',nome:''}}}
let logQ=Promise.resolve();
/* azione: crea, modifica, elimina, ripristina, accesso, account, backup… Non blocca mai l'operazione: se lo storico non è pronto, la voce si perde. */
export function logEvento(azione,sec,id,titolo,dett){
  if(!CIFRA_ATTIVA||sec==='storico')return;
  logQ=logQ.then(async()=>{
    const u=await utente();
    const voce={t:Date.now(),u:u.uid,n:u.nome,a:azione,s:sec||'',i:id||'',T:String(titolo||'').slice(0,160),c:String(dett||'').slice(0,300)};
    /* chi ha la sessione Telegram scrive subito nello Storico; tutti gli altri (atleti, tecnici, operatori) accodano la voce su Firestore, cifrata: la porta nello Storico l'admin alla prossima apertura */
    if(tgConfigured()&&hasSession()){try{await tgSendSicuro('storico',newId(),'set',voce);return}catch(e){console.warn('Storico su Telegram non scritto, uso la coda:',e&&e.message)}}
    const u2=getAuth(DB.app).currentUser;if(!u2)return;
    await SDK.setDoc(SDK.doc(DB,'storicoCoda',newId()),{by:u2.uid,t:voce.t,enc:await cifraTesto(JSON.stringify(voce),'storico')})
  }).catch(e=>console.warn('Storico non scritto:',e&&e.message))}
/* solo admin con sessione Telegram: porta nello Storico le voci accodate dagli altri account, poi le toglie dalla coda (id uguale = nessun doppione) */
export async function svuotaCodaStorico(){
  if(!tgConfigured()||!hasSession()||!CIFRA_ATTIVA)return 0;
  let n=0;
  try{const sn=await SDK.getDocs(SDK.collection(DB,'storicoCoda'));
    for(const d of sn.docs){
      try{const v=JSON.parse(await decifraTesto(d.data().enc));
        if(!v||typeof v.t!=='number')throw new Error('voce non valida');
        await tgSendSicuro('storico',d.id,'set',v);await SDK.deleteDoc(d.ref);n++}
      catch(e){console.warn('Voce in coda non trasferita:',d.id,e&&e.message)}}}
  catch(e){console.warn('Coda storico non letta:',e&&e.message)}
  return n}
const loggabile=ref=>ref.coll==='items'&&ref.S!=='storico'&&ref.S!=='cestino'&&ref.S!=='notifiche'&&ref.S!=='account';

/* ---------- Cestino: ogni elemento eliminato viene prima copiato in "cestino" (e il file resta su Telegram) ---------- */
let lotto={id:'',t:0,u:''};
async function nelCestino(ref,r){
  const u=await utente(),now=Date.now();
  if(now-lotto.t>8000||lotto.u!==u.uid)lotto={id:newId(),t:now,u:u.uid};else lotto.t=now;      /* eliminati insieme = stesso lotto */
  const st=clone(r.st);
  await write(tgRef(DB,'cestino','items',newId()),'set',{sec:ref.S,id:ref.id,titolo:titoloDi(st,ref.id),kind:st.kind||'',dati:st,
    tg:st.tg||0,chunks:st.chunks||0,fbc:!!st.fb,da:u.uid,daNome:u.nome,il:{$ts:now},lotto:lotto.id},true);lotto.t=Date.now()}

export async function addDoc(col,data){
  if(!col||!col.__tg)return SDK.addDoc(col,toSdk(data));
  const ref=tgRef(col.db,col.S,col.coll,newId());await write(ref,'set',ser(data));
  if(loggabile(ref))logEvento('crea',ref.S,ref.id,titoloDi(data,ref.id));
  return {id:ref.id}}
export async function setDoc(ref,data,opts){
  if(!ref||!ref.__tg)return SDK.setDoc(ref,toSdk(data),opts);
  await startOnce();const r0=recOf(ref.sec,ref.id),esisteva=!!r0&&!r0.x;
  await write(ref,opts&&opts.merge?'upd':'set',ser(data));
  if(loggabile(ref)){const r=recOf(ref.sec,ref.id);logEvento(esisteva?'modifica':'crea',ref.S,ref.id,titoloDi(r&&r.st,ref.id))}}
export async function updateDoc(ref,patch,...rest){
  if(!ref||!ref.__tg)return SDK.updateDoc(ref,toSdk(patch),...rest);
  await startOnce();
  const r=recOf(ref.sec,ref.id);
  if(r&&r.x){const e=new Error('NOT_FOUND');e.code='not-found';throw e}
  const d=ser(patch);
  if(protetto(r)){const n=d.conservaFinoTs;if('conservaFinoTs' in d&&!(n&&typeof n.$ts==='number'&&n.$ts>=r.st.conservaFinoTs.$ts))throw errProt()}
  await write(ref,'upd',d);
  if(loggabile(ref)){const campi=Object.keys(d).filter(k=>!['at','by','thumb'].includes(k)).slice(0,8).join(', ');
    const r2=recOf(ref.sec,ref.id);logEvento('modifica',ref.S,ref.id,titoloDi(r2&&r2.st,ref.id),campi?'campi: '+campi:'')}}
export async function deleteDoc(ref,opts){
  if(!ref||!ref.__tg)return SDK.deleteDoc(ref);
  await startOnce();
  const r=recOf(ref.sec,ref.id);if(protetto(r))throw errProt();
  const titolo=titoloDi(r&&r.st,ref.id),daCestino=loggabile(ref)&&r&&!r.x&&!(opts&&opts.definitivo);
  if(daCestino){
    /* se il Cestino non è pronto (chiave pubblica mancante) si ferma: meglio non eliminare che perdere il dato */
    try{await nelCestino(ref,r)}catch(e){console.error(e);const x=new Error(e&&e.message==='NOPUB'?'NOPUB':'CESTINO');x.code='failed-precondition';throw x}}
  await write(ref,'del',{});
  if(loggabile(ref))logEvento('elimina',ref.S,ref.id,titolo,daCestino?'spostato nel Cestino':'definitivo')}
/* Rimette al suo posto un elemento del Cestino (stesso id, stessa sezione) e toglie la voce dal Cestino. Se esiste già un elemento con quell'id si ferma. */
export async function ripristinaVoce(entryId,patch){
  await startOnce();
  const r=recOf('cestino',entryId);if(!r||r.x)throw new Error('NON_TROVATO');
  const e=r.st,orig=recOf(e.sec,e.id);
  if(orig&&!orig.x)throw new Error('ESISTE');
  await write(tgRef(DB,e.sec,'items',e.id),'set',{...clone(e.dati),...(patch||{})});
  await write(tgRef(DB,'cestino','items',entryId),'del',{},true);
  logEvento('ripristina',e.sec,e.id,e.titolo||e.id,'dal Cestino')}
/* Per il backup: tutto il registro in forma semplice (le date sono {$ts:millisecondi}) */
export async function esportaRegistro(){
  await startOnce();await sync(false);
  const out={};for(const sec in C.recs){for(const id in C.recs[sec]){const r=C.recs[sec][id];if(r.x)continue;(out[sec]||(out[sec]={}))[id]=clone(r.st)}}
  return out}

/* ---------- uso diretto (strumento di migrazione) ---------- */
export const haRecord=(sec,id)=>{const r=recOf(sec,id);return !!r&&!r.x};
export async function scriviRecord(sec,id,data,db){const ref=tgRef(db,sec,'items',id);return write(ref,'set',ser(data),true)}

/* ---------- cifratura dei dati già presenti (strumento di migrazione, solo admin) ---------- */
export async function statoRegistro(){
  await startOnce();await sync(true);
  let tot=0,chiaro=0,cifrati=0;
  for(const sec in C.recs)for(const id in C.recs[sec]){const r=C.recs[sec][id];if(r.x)continue;tot++;if(r.pl>0)chiaro++;else cifrati++}
  return {tot,chiaro,cifrati,senzaChiave:(C.miss||[]).slice()}}
/* Riscrive in forma cifrata ogni record ancora in chiaro, poi cancella i vecchi messaggi. Restituisce quanti record e quanti messaggi non cancellabili. */
export async function ricifraRegistro(log=()=>{},stopped=()=>false){
  await startOnce();await sync(true);
  const lista=[];for(const sec in C.recs)for(const id in C.recs[sec]){const r=C.recs[sec][id];if(!r.x&&r.pl>0)lista.push([sec,id])}
  let n=0,fail=0,noDel=0;
  log('Record da cifrare: '+lista.length);
  for(const [sec,id] of lista){
    if(stopped())break;
    try{
      const r=recOf(sec,id);if(!r||r.x)continue;
      const old=r.mids.slice(),mid=await tgSend(sec,id,'set',clone(r.st));
      await syncUntil(mid);
      try{const {client}=await tgClient(),ent=await tgEntity(GRUPPO_DATI);await client.deleteMessages(ent,old,{revoke:true})}catch(e){noDel+=old.length;console.warn(e)}
      n++;if(n%10===0)log('  … '+n+' record cifrati');
      await new Promise(r=>setTimeout(r,700))
    }catch(e){fail++;log('  ✗ '+sec+'/'+id+': '+tgErrText(e));console.error(e)}}
  return {n,fail,noDel}}
