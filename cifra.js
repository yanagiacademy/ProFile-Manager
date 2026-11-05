/* cifra.js – collega la cifratura (cifra-core.js) a Firebase (dove stanno le chiavi) e a Telegram (dove vanno i file cifrati).
   Una chiave AES-256 per sezione in Firestore: chiavi/<sezione>. Si crea da sola al primo salvataggio di chi ha la scrittura su quella sezione;
   la legge solo chi ha almeno la lettura (vedi firestore.rules). Chi sta nel gruppo Telegram ma non ha la chiave vede solo dati illeggibili. */
import * as SDK from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {tgSendFile} from "./telegram.js";
import {setKeyLoader,cifraBlob,b64e,b64d,keyIdOf} from "./cifra-core.js";
export * from "./cifra-core.js";

/* Interruttore di emergenza: false = si torna a salvare in chiaro su Telegram (sconsigliato). */
export const CIFRA_ATTIVA=true;

let db=null;
export const setDb=d=>{db=d};
const cache=new Map();
setKeyLoader(async(id,crea)=>{
  if(cache.has(id))return cache.get(id);
  if(!db)return null;
  const ref=SDK.doc(db,'chiavi',id);
  let sn=null;
  try{sn=await SDK.getDoc(ref)}catch(e){if(!crea)return null}
  if((!sn||!sn.exists())&&crea){
    try{await SDK.setDoc(ref,{k:b64e(crypto.getRandomValues(new Uint8Array(32))),at:SDK.serverTimestamp()})}catch(e){console.warn('Creazione chiave',id,e&&e.code)}
    try{sn=await SDK.getDoc(ref)}catch(e){return null}}   /* se un altro l'ha creata nel frattempo, si usa la sua */
  if(!sn||!sn.exists())return null;
  const k=await crypto.subtle.importKey('raw',b64d(sn.data().k),'AES-GCM',false,['encrypt','decrypt']);
  cache.set(id,k);return k});
/* true se l'utente può leggere la chiave di questa sezione (usata per riprovare i contenuti che prima non si potevano decifrare) */
export const haChiave=async id=>{try{return !!await getKey(id)}catch(e){return false}};
const getKey=id=>cache.has(id)?cache.get(id):(async()=>{
  if(!db)return null;
  try{const sn=await SDK.getDoc(SDK.doc(db,'chiavi',id));if(!sn.exists())return null;
    const k=await crypto.subtle.importKey('raw',b64d(sn.data().k),'AES-GCM',false,['encrypt','decrypt']);cache.set(id,k);return k}catch(e){return null}})();

/* Invio di un file su Telegram: cifrato, con nome e didascalia casuali (il nome vero sta solo nel registro, anch'esso cifrato). */
export async function tgSendCifrato(tg,client,ent,file,onProgress,topic,sec){
  if(!CIFRA_ATTIVA)return tgSendFile(tg,client,ent,file,onProgress,'auto',undefined,topic);
  const blob=await cifraBlob(file,keyIdOf(sec));
  const nm='c'+Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('')+'.bin';
  return tgSendFile(tg,client,ent,new File([blob],nm,{type:'application/octet-stream'}),onProgress,'auto',undefined,topic)}
