/* cifra-core.js – cifratura AES-256-GCM dei contenuti PRIMA che vadano su Telegram (codice puro, senza Firebase né Telegram).
   Chi è nel gruppo Telegram vede solo dati illeggibili: la chiave sta in Firestore (chiavi/<sezione>) e la legge solo chi ha il permesso su quella sezione.
   Tre formati, tutti a blocchi da 4 MiB (IV = nonce + numero del blocco; AAD = numero del blocco + flag "ultimo": nessun blocco si può
   riordinare, scambiare o troncare senza che la decifratura fallisca; ogni blocco aggiunge 16 byte di tag):
   • PFM2  chiave simmetrica di sezione:   "PFM2" | lung. id (1) | id | nonce (8) | blocchi
   • PFM3  "scrittura libera, lettura riservata" (Cestino, Storico): chiave AES casuale per ogni messaggio, protetta con la chiave PUBBLICA RSA della sezione;
           la leggono solo i possessori della chiave privata:  "PFM3" | lung. id (1) | id | lung. chiave protetta (2) | chiave protetta | nonce (8) | blocchi
   • PFMB  backup protetto da password (PBKDF2 + AES-GCM):  "PFMB" | versione (1) | iterazioni (4) | salt (16) | nonce (8) | blocchi */
export const CH=4*1024*1024;
const M2=[0x50,0x46,0x4d,0x32],M3=[0x50,0x46,0x4d,0x33],MB=[0x50,0x46,0x4d,0x42];
const te=new TextEncoder(),td=new TextDecoder();
let loader=async()=>null,pubLoader=async()=>null,privLoader=async()=>null;
/* loader(idChiave, crea) → CryptoKey oppure null; con crea=true può creare la chiave se manca */
export const setKeyLoader=f=>{loader=f};
/* pub(id) → chiave pubblica RSA-OAEP (encrypt) o null;  priv(id) → chiave privata (decrypt) o null */
export const setAsimLoaders=(pub,priv)=>{pubLoader=pub;privLoader=priv};
/* sezioni con cifratura asimmetrica: tutti possono scrivere, solo chi ha la chiave privata legge */
export const ASIM=new Set(['cestino','storico']);
export const keyIdOf=sec=>String(sec).replace(/^meta-/,'');

const ivOf=(nonce,i)=>{const iv=new Uint8Array(12);iv.set(nonce,0);new DataView(iv.buffer).setUint32(8,i);return iv};
const aadOf=(i,fin)=>{const a=new Uint8Array(5);new DataView(a.buffer).setUint32(0,i);a[4]=fin?1:0;return a};
const err=(m,id)=>{const e=new Error(m);if(id!==undefined)e.keyId=id;return e};
export const b64e=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)};
export const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const has=(h,m)=>m.every((b,i)=>h[i]===b);
const rd=async(blob,a,b)=>new Uint8Array(await blob.slice(a,b).arrayBuffer());

async function cifraBlocchi(blob,key,nonce){
  const out=[],n=Math.max(1,Math.ceil(blob.size/CH));
  for(let i=0;i<n;i++){
    const plain=await blob.slice(i*CH,(i+1)*CH).arrayBuffer();
    out.push(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:ivOf(nonce,i),additionalData:aadOf(i,i===n-1)},key,plain)))}
  return out}
async function decifraBlocchi(blob,pos,key,nonce,type){
  const total=blob.size,parts=[];let i=0;
  if(pos>=total)throw err('CORROTTO');
  while(pos<total){
    const end=Math.min(pos+CH+16,total);
    try{parts.push(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:ivOf(nonce,i),additionalData:aadOf(i,end===total)},key,await blob.slice(pos,end).arrayBuffer())))}
    catch(e){throw err('CORROTTO')}
    pos=end;i++}
  return new Blob(parts,{type:type||'application/octet-stream'})}
const blobOf=parts=>new Blob(parts,{type:'application/octet-stream'});

export async function cifraBlob(blob,id){
  const idb=te.encode(id);if(idb.length>200)throw err('ID_CHIAVE_LUNGO');
  const nonce=crypto.getRandomValues(new Uint8Array(8));
  if(ASIM.has(id)){
    const pub=await pubLoader(id);if(!pub)throw err('NOPUB',id);
    const raw=crypto.getRandomValues(new Uint8Array(32));
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
    const w=new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,raw));
    const head=new Uint8Array(5+idb.length+2+w.length+8);let p=0;
    head.set(M3,p);p=4;head[p++]=idb.length;head.set(idb,p);p+=idb.length;
    new DataView(head.buffer).setUint16(p,w.length);p+=2;head.set(w,p);p+=w.length;head.set(nonce,p);
    return blobOf([head,...await cifraBlocchi(blob,key,nonce)])}
  const key=await loader(id,true);if(!key)throw err('NOKEY',id);
  const head=new Uint8Array(5+idb.length+8);head.set(M2,0);head[4]=idb.length;head.set(idb,5);head.set(nonce,5+idb.length);
  return blobOf([head,...await cifraBlocchi(blob,key,nonce)])}

export async function isCifrato(blob){
  if(!blob||blob.size<5+8+16)return false;
  const h=await rd(blob,0,4);
  return has(h,M2)||has(h,M3)||has(h,MB)}

/* Se il blob è cifrato lo decifra, altrimenti lo restituisce com'è (contenuti vecchi non ancora migrati). */
export async function decifraBlob(blob,type){
  if(!blob||blob.size<5+8+16)return type&&blob.type!==type?new Blob([blob],{type}):blob;
  const m=await rd(blob,0,4);
  if(has(m,M2)){
    const L=(await rd(blob,4,5))[0],h=await rd(blob,0,5+L+8);
    const id=td.decode(h.slice(5,5+L)),nonce=h.slice(5+L,5+L+8);
    const key=await loader(id,false);if(!key)throw err('NOKEY',id);
    return decifraBlocchi(blob,5+L+8,key,nonce,type)}
  if(has(m,M3)){
    const L=(await rd(blob,4,5))[0],h1=await rd(blob,0,5+L+2);
    const id=td.decode(h1.slice(5,5+L)),W=new DataView(h1.buffer).getUint16(5+L);
    const h=await rd(blob,0,5+L+2+W+8);
    const wrapped=h.slice(5+L+2,5+L+2+W),nonce=h.slice(5+L+2+W,5+L+2+W+8);
    const priv=await privLoader(id);if(!priv)throw err('NOKEY',id);
    let raw;try{raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},priv,wrapped)}catch(e){throw err('CORROTTO')}
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    return decifraBlocchi(blob,5+L+2+W+8,key,nonce,type)}
  return type&&blob.type!==type?new Blob([blob],{type}):blob}

/* testi brevi (registro dei dati): stringa → base64 del contenuto cifrato, e viceversa */
export async function cifraTesto(str,id){
  const b=await cifraBlob(new Blob([te.encode(str)]),id);
  return b64e(new Uint8Array(await b.arrayBuffer()))}
export async function decifraTesto(b64){
  const b=await decifraBlob(new Blob([b64d(b64)]));
  return td.decode(await b.arrayBuffer())}

/* ---- backup protetto da password ---- */
const ITER=600000;
const keyPw=async(pw,salt,iter,usage)=>crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},
  await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,[usage]);
export async function cifraPassword(blob,pw,iter=ITER){
  if(!pw)throw err('PASSWORD');
  const salt=crypto.getRandomValues(new Uint8Array(16)),nonce=crypto.getRandomValues(new Uint8Array(8));
  const key=await keyPw(pw,salt,iter,'encrypt');
  const head=new Uint8Array(4+1+4+16+8);head.set(MB,0);head[4]=1;new DataView(head.buffer).setUint32(5,iter);head.set(salt,9);head.set(nonce,25);
  return blobOf([head,...await cifraBlocchi(blob,key,nonce)])}
export async function isBackup(blob){return !!blob&&blob.size>=4+1+4+16+8+16&&has(await rd(blob,0,4),MB)}
export async function decifraPassword(blob,pw,type){
  if(!await isBackup(blob))throw err('NONBACKUP');
  const h=await rd(blob,0,33),iter=new DataView(h.buffer).getUint32(5);
  if(iter<1000||iter>5000000)throw err('CORROTTO');
  const key=await keyPw(pw,h.slice(9,25),iter,'decrypt');
  try{return await decifraBlocchi(blob,33,key,h.slice(25,33),type)}catch(e){throw err('PASSWORD')}}
