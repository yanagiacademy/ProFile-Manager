/* cifra.js – collega la cifratura (cifra-core.js) a Firebase (dove stanno le chiavi) e a Telegram (dove vanno i file cifrati).
   Una chiave AES-256 per sezione in Firestore: chiavi/<sezione>. Si crea da sola al primo salvataggio di chi ha la scrittura su quella sezione;
   la legge solo chi ha almeno la lettura (vedi firestore.rules). Chi sta nel gruppo Telegram ma non ha la chiave vede solo dati illeggibili. */
import * as SDK from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {tgSendFile} from "./telegram.js";
import {setKeyLoader,setAsimLoaders,ASIM,cifraBlob,b64e,b64d,keyIdOf} from "./cifra-core.js";
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
export const haChiave=async id=>{try{return ASIM.has(id)?!!await privAs(id):!!await getKey(id)}catch(e){return false}};
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

/* ---- Cestino e Storico: chiavi asimmetriche (tutti scrivono, legge solo chi ha la chiave privata) ----
   app/pub-<id>  = chiave pubblica (la leggono tutti gli account)      chiavi/<id> = {priv}: chiave privata (regole: solo chi ha il permesso sulla sezione, per "storico" solo l'admin) */
const RSA={name:'RSA-OAEP',hash:'SHA-256'},pubC=new Map(),privC=new Map();
const pubAs=async id=>{
  if(pubC.has(id))return pubC.get(id);if(!db)return null;
  try{const sn=await SDK.getDoc(SDK.doc(db,'app','pub-'+id));if(!sn.exists())return null;
    const k=await crypto.subtle.importKey('spki',b64d(sn.data().k),RSA,false,['encrypt']);pubC.set(id,k);return k}catch(e){return null}};
const privAs=async id=>{
  if(privC.has(id))return privC.get(id);if(!db)return null;
  try{const sn=await SDK.getDoc(SDK.doc(db,'chiavi',id));if(!sn.exists()||!sn.data().priv)return null;
    const k=await crypto.subtle.importKey('pkcs8',b64d(sn.data().priv),RSA,false,['decrypt']);privC.set(id,k);return k}catch(e){return null}};
setAsimLoaders(pubAs,privAs);
/* Solo admin: crea la coppia di chiavi di una sezione se non esiste (e ripara la chiave pubblica se manca). Restituisce 'ok', 'creata' o 'riparata'. */
export async function assicuraCoppia(id){
  if(!db)throw new Error('NODB');
  const [ps,ks]=await Promise.all([SDK.getDoc(SDK.doc(db,'app','pub-'+id)),SDK.getDoc(SDK.doc(db,'chiavi',id))]);
  const hasPriv=ks.exists()&&!!ks.data().priv;
  if(ps.exists()&&hasPriv)return 'ok';
  if(hasPriv&&!ps.exists()){      /* la pubblica si ricava dalla privata */
    const pk=await crypto.subtle.importKey('pkcs8',b64d(ks.data().priv),RSA,true,['decrypt']),j=await crypto.subtle.exportKey('jwk',pk);
    const pub=await crypto.subtle.importKey('jwk',{kty:'RSA',n:j.n,e:j.e,alg:'RSA-OAEP-256',ext:true},RSA,true,['encrypt']);
    await SDK.setDoc(SDK.doc(db,'app','pub-'+id),{k:b64e(new Uint8Array(await crypto.subtle.exportKey('spki',pub))),at:SDK.serverTimestamp()});return 'riparata'}
  if(ps.exists()&&!hasPriv)throw new Error('CHIAVE_PRIVATA_MANCANTE');
  const kp=await crypto.subtle.generateKey({...RSA,modulusLength:3072,publicExponent:new Uint8Array([1,0,1])},true,['encrypt','decrypt']);
  await SDK.setDoc(SDK.doc(db,'chiavi',id),{priv:b64e(new Uint8Array(await crypto.subtle.exportKey('pkcs8',kp.privateKey))),at:SDK.serverTimestamp()});
  await SDK.setDoc(SDK.doc(db,'app','pub-'+id),{k:b64e(new Uint8Array(await crypto.subtle.exportKey('spki',kp.publicKey))),at:SDK.serverTimestamp()});
  return 'creata'}
/* true se la chiave pubblica della sezione è disponibile (Cestino e Storico possono ricevere dati) */
export const haPubblica=async id=>!!await pubAs(id);
