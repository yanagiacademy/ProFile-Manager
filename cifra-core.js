/* cifra-core.js – cifratura AES-256-GCM dei contenuti PRIMA che vadano su Telegram (codice puro, senza Firebase né Telegram).
   Chi è nel gruppo Telegram vede solo dati illeggibili: la chiave sta in Firestore (chiavi/<sezione>) e la legge solo chi ha il permesso su quella sezione.
   Formato (file e messaggi):  "PFM2" | lunghezza id (1 byte) | id chiave (testo) | nonce (8 byte) | blocchi
   Ogni blocco da 4 MiB è cifrato a parte (IV = nonce + numero del blocco; AAD = numero del blocco + flag "ultimo"), così non si possono
   riordinare, scambiare o troncare i blocchi senza che la decifratura fallisca. Ogni blocco aggiunge 16 byte (tag di autenticazione). */
export const CH=4*1024*1024;
const MAGIC=[0x50,0x46,0x4d,0x32];                 /* "PFM2" */
const te=new TextEncoder(),td=new TextDecoder();
let loader=async()=>null;
/* loader(idChiave, crea) → CryptoKey oppure null; con crea=true può creare la chiave se manca */
export const setKeyLoader=f=>{loader=f};
export const keyIdOf=sec=>String(sec).replace(/^meta-/,'');

const ivOf=(nonce,i)=>{const iv=new Uint8Array(12);iv.set(nonce,0);new DataView(iv.buffer).setUint32(8,i);return iv};
const aadOf=(i,fin)=>{const a=new Uint8Array(5);new DataView(a.buffer).setUint32(0,i);a[4]=fin?1:0;return a};
const noKey=id=>{const e=new Error('NOKEY');e.keyId=id;return e};
export const b64e=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)};
export const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

export async function cifraBlob(blob,id){
  const key=await loader(id,true);if(!key)throw noKey(id);
  const idb=te.encode(id);if(idb.length>200)throw new Error('ID_CHIAVE_LUNGO');
  const nonce=crypto.getRandomValues(new Uint8Array(8));
  const head=new Uint8Array(5+idb.length+8);head.set(MAGIC,0);head[4]=idb.length;head.set(idb,5);head.set(nonce,5+idb.length);
  const parts=[head],n=Math.max(1,Math.ceil(blob.size/CH));
  for(let i=0;i<n;i++){
    const plain=await blob.slice(i*CH,(i+1)*CH).arrayBuffer();
    parts.push(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:ivOf(nonce,i),additionalData:aadOf(i,i===n-1)},key,plain)))}
  return new Blob(parts,{type:'application/octet-stream'})}

export async function isCifrato(blob){
  if(!blob||blob.size<5+8+16)return false;
  const h=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  return MAGIC.every((b,i)=>h[i]===b)}

/* Se il blob è cifrato lo decifra, altrimenti lo restituisce com'è (contenuti vecchi non ancora migrati). */
export async function decifraBlob(blob,type){
  if(!await isCifrato(blob))return type&&blob.type!==type?new Blob([blob],{type}):blob;
  const L=new Uint8Array(await blob.slice(4,5).arrayBuffer())[0];
  const h=new Uint8Array(await blob.slice(0,5+L+8).arrayBuffer());
  const id=td.decode(h.slice(5,5+L)),nonce=h.slice(5+L,5+L+8);
  const key=await loader(id,false);if(!key)throw noKey(id);
  const total=blob.size,parts=[];let pos=5+L+8,i=0;
  if(pos>=total)throw new Error('CORROTTO');
  while(pos<total){
    const end=Math.min(pos+CH+16,total);
    try{parts.push(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:ivOf(nonce,i),additionalData:aadOf(i,end===total)},key,await blob.slice(pos,end).arrayBuffer())))}
    catch(e){throw new Error('CORROTTO')}
    pos=end;i++}
  return new Blob(parts,{type:type||'application/octet-stream'})}

/* testi brevi (registro dei dati): stringa → base64 del contenuto cifrato, e viceversa */
export async function cifraTesto(str,id){
  const b=await cifraBlob(new Blob([te.encode(str)]),id);
  return b64e(new Uint8Array(await b.arrayBuffer()))}
export async function decifraTesto(b64){
  const b=await decifraBlob(new Blob([b64d(b64)]));
  return td.decode(await b.arrayBuffer())}
