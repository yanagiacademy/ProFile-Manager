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
import {tgConfigured,hasSession,tgClient,tgEntity,tgSendFile,tgErrText,tgTopic} from "./telegram.js";
import * as CFG from "./telegram-config.js";

export const getFirestore=SDK.getFirestore,Bytes=SDK.Bytes,Timestamp=SDK.Timestamp;
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
let barEl=null,warnEl=null;
function status(t){
  if(!barEl){barEl=document.createElement('div');barEl.setAttribute('role','status');
    barEl.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 6px);z-index:70;max-width:92vw;padding:5px 14px;border-radius:99px;font-size:.8rem;background:var(--ac,#1B2A4A);color:var(--bg,#fff);display:none;text-align:center;pointer-events:none';document.body.append(barEl)}
  barEl.textContent=t||'';barEl.style.display=t?'block':'none'}
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
let C={v:1,lastId:0,full:0,recs:{}},loaded=false,firstDone=false,startP=null,syncP=null,timer=null;
const subs=new Set();
const recOf=(sec,id)=>(C.recs[sec]||{})[id];
function apply(sec,rid,mid,o,d){
  const S=C.recs[sec]||(C.recs[sec]={});let r=S[rid];
  if(r&&r.mids.includes(mid))return;
  if(o==='set'){S[rid]={st:cleanSet(d||{}),mids:[mid],x:0};return}
  if(!r)r=S[rid]={st:{},mids:[],x:0};
  r.mids.push(mid);
  if(o==='del'){r.x=1;return}
  if(r.x)return;
  applyUpd(r.st,d||{})}
const fireAll=()=>{for(const s of subs)s.fire()};
const ready=()=>loaded&&firstDone;

async function decode(client,m){
  let raw;
  if(m.media&&m.media.document){const buf=await client.downloadMedia(m,{});raw=new TextDecoder().decode(buf)}
  else{const t=m.message||'',i=t.indexOf('\n');if(i<0)return null;try{raw=decodeURIComponent(escape(atob(t.slice(i+1).trim())))}catch(e){return null}}
  try{const j=JSON.parse(raw);if(!j||!j.s||!j.r||!j.o)return null;return {s:j.s,r:j.r,o:j.o,d:j.d,mid:m.id}}catch(e){return null}}
async function pool(list,n,fn){const out=new Array(list.length);let i=0;await Promise.all(Array.from({length:Math.min(n,list.length)},async()=>{while(i<list.length){const k=i++;out[k]=await fn(list[k])}}));return out}

async function doSync(full){
  status('Sincronizzazione con Telegram…');
  try{
    const {client}=await tgClient(),ent=await tgEntity(GRUPPO_DATI);
    const base=full?{v:1,lastId:0,full:Date.now(),recs:{}}:C;
    const msgs=[];let maxSeen=base.lastId||0;
    const opt={limit:undefined};if(base.lastId)opt.minId=base.lastId;
    for await(const m of client.iterMessages(ent,opt)){if(m.id>maxSeen)maxSeen=m.id;if(m.message&&m.message.startsWith(TAG))msgs.push(m)}
    msgs.sort((a,b)=>a.id-b.id);
    const dec=await pool(msgs,5,m=>decode(client,m));      /* un errore di rete interrompe: niente va perso */
    if(full)C=base;
    for(const x of dec)if(x)apply(x.s,x.r,x.mid,x.o,x.d);
    C.lastId=Math.max(C.lastId||0,maxSeen);if(!C.full)C.full=Date.now();
    kvSet('cache:'+GRUPPO_DATI,C);
    firstDone=true;fireAll();
  }finally{status('')}}
function sync(full=false){if(syncP)return syncP;syncP=doSync(full).finally(()=>{syncP=null});return syncP}
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
    if(!timer)timer=setInterval(()=>{if(document.visibilityState==='visible'&&subs.size)sync(false).catch(e=>console.error(e))},20000);
  })();
  return startP}
export const caricaDati=startOnce;
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
  if(!hasSession()){toSdk_(null,['Telegram non collegato: vedi solo i contenuti salvati anche su Firebase. Per vedere e modificare tutto accedi a Telegram.',['Accedi','chat.html']])}
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
  const b64=btoa(unescape(encodeURIComponent(body)));
  const head=TAG+' #s_'+sec.replace(/[^a-z0-9]/gi,'_')+' #r_'+rid;
  if(head.length+1+b64.length<=3800){const m=await client.sendMessage(ent,{message:head+'\n'+b64,silent:true,...(topic?{replyTo:topic}:{})});return m.id}
  const f=new File([body],rid+'.json',{type:'application/json'});
  const m=await tgSendFile(tg,client,ent,f,()=>{},'auto',head,topic);return m.id}
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
  await startOnce();
  const r0=recOf(ref.sec,ref.id),prevFb=!!(r0&&!r0.x&&r0.st.fb);
  let mid,old=[];
  if(o==='upd'&&r0&&r0.mids.length>=COMPACT){
    const st=clone(r0.st);applyUpd(st,d);old=r0.mids.slice();
    mid=await tgSend(ref.sec,ref.id,'set',st)}
  else mid=await tgSend(ref.sec,ref.id,o,d);
  await syncUntil(mid);
  if(old.length)tgDeleteMsgs(old);
  if(o==='del'){const r=recOf(ref.sec,ref.id);if(r)tgDeleteMsgs(r.mids.filter(x=>x!==mid))}
  if(!noMirror)await mirror(ref,prevFb)}
export async function addDoc(col,data){
  if(!col||!col.__tg)return SDK.addDoc(col,toSdk(data));
  const ref=tgRef(col.db,col.S,col.coll,newId());await write(ref,'set',ser(data));return {id:ref.id}}
export async function setDoc(ref,data,opts){
  if(!ref||!ref.__tg)return SDK.setDoc(ref,toSdk(data),opts);
  return write(ref,opts&&opts.merge?'upd':'set',ser(data))}
export async function updateDoc(ref,patch,...rest){
  if(!ref||!ref.__tg)return SDK.updateDoc(ref,toSdk(patch),...rest);
  await startOnce();
  const r=recOf(ref.sec,ref.id);
  if(r&&r.x){const e=new Error('NOT_FOUND');e.code='not-found';throw e}
  const d=ser(patch);
  if(protetto(r)){const n=d.conservaFinoTs;if('conservaFinoTs' in d&&!(n&&typeof n.$ts==='number'&&n.$ts>=r.st.conservaFinoTs.$ts))throw errProt()}
  return write(ref,'upd',d)}
export async function deleteDoc(ref){
  if(!ref||!ref.__tg)return SDK.deleteDoc(ref);
  await startOnce();
  const r=recOf(ref.sec,ref.id);if(protetto(r))throw errProt();
  return write(ref,'del',{})}

/* ---------- uso diretto (strumento di migrazione) ---------- */
export const haRecord=(sec,id)=>{const r=recOf(sec,id);return !!r&&!r.x};
export async function scriviRecord(sec,id,data,db){const ref=tgRef(db,sec,'items',id);return write(ref,'set',ser(data),true)}
