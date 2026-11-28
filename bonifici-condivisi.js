/* Eventi → copie dei bonifici caricate dall'admin e bonifico collegato a più iscrizioni (altri eventi, altri atleti dello stesso account).
   Funziona sia per gli interni (raccolta «iscrizioni») sia per gli esterni («iscrizioniEsterne»).
   • La copia (a blocchi) sta UNA SOLA volta, nei /chunks dell'iscrizione «proprietaria».
   • Le altre iscrizioni collegate hanno solo la scheda del file con ref = id dell'iscrizione proprietaria.
   • Se si toglie la copia dalla proprietaria, si toglie da tutte; se si toglie da una collegata, si scollega soltanto.
   • Se si elimina l'iscrizione proprietaria (es. evento eliminato) mentre altre la usano, i blocchi passano a una delle collegate. */
import {collection as fcol,doc as fdoc,setDoc as fset,updateDoc as fupd,deleteDoc as fdel,getDocs as fget,arrayUnion,Bytes} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const CH=900000,MAXB=20*1024*1024;
export const newId=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return Array.from(a,b=>(b%36).toString(36)).join('')};
export const bonificiOf=r=>[...((r&&r.bonifici)||[])].sort((a,b)=>(a.t||0)-(b.t||0));
/* id dell'iscrizione che custodisce i blocchi del file */
export const proprietaria=(r,f)=>f.ref||r.id;
/* altre iscrizioni che usano la copia custodita da r */
export const collegateA=(r,f,tutte)=>tutte.filter(x=>x.id!==r.id&&bonificiOf(x).some(b=>b.id===f.id&&b.ref===r.id));
/* altre iscrizioni con cui la copia f di r è condivisa (da qualunque lato: se r è collegata, include anche la proprietaria) */
export function condivisaCon(r,f,tutte){
  const own=f.ref?tutte.find(x=>x.id===f.ref):r;
  if(!own)return [];
  const fo=bonificiOf(own).find(b=>b.id===f.id&&!b.ref);
  const altre=fo?collegateA(own,fo,tutte).filter(x=>x.id!==r.id):[];
  return f.ref?[own,...altre]:altre}

export async function delChunks(db,coll,rid,f){
  await Promise.all(Array.from({length:f.n||1},(_,k)=>fdel(fdoc(db,coll,rid,'chunks',f.id+'k'+k)).catch(()=>{})))}

/* carica un file nei blocchi dell'iscrizione rid e restituisce la scheda (senza salvarla nell'iscrizione) */
export async function caricaBlocchi(db,coll,rid,file,say){
  if(file.size>MAXB)throw new Error('“'+file.name+'” supera il limite di 20 MB.');
  const fid=newId(),n=Math.max(1,Math.ceil(file.size/CH)),meta={id:fid,nome:file.name,size:file.size,mime:file.type||'',n,t:Date.now()};
  try{
    for(let k=0;k<n;k++){
      const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());
      await fset(fdoc(db,coll,rid,'chunks',fid+'k'+k),{f:fid,i:k,data:Bytes.fromUint8Array(buf)});
      if(say)say('Caricamento '+Math.round((k+1)/n*100)+'%')}}
  catch(e){await delChunks(db,coll,rid,meta);throw e}
  return meta}

/* parti (Uint8Array) del file f dell'iscrizione r, anche se i blocchi stanno in un'altra iscrizione */
export async function leggiParti(db,coll,r,f){
  const s=await fget(fcol(db,coll,proprietaria(r,f),'chunks')),
    parts=s.docs.map(d=>d.data()).filter(x=>x.f===f.id).sort((a,b)=>a.i-b.i).map(x=>x.data.toUint8Array());
  if(!parts.length)throw new Error('EMPTY');
  return parts}

/* aggiunge a r la copia già custodita da owner (scheda con ref) */
export async function collega(db,coll,owner,meta,target){
  const m={...meta,ref:owner.id};
  await fupd(fdoc(db,coll,target.id),{bonifici:arrayUnion(m)});
  target.bonifici=[...(target.bonifici||[]),m]}

/* carica un nuovo file su r e lo collega alle iscrizioni scelte (targets) */
export async function caricaECollega(db,coll,r,file,targets,say){
  const meta=await caricaBlocchi(db,coll,r.id,file,say);
  await fupd(fdoc(db,coll,r.id),{bonifici:arrayUnion(meta)});
  r.bonifici=[...(r.bonifici||[]),meta];
  const ko=[];
  for(const t of targets){try{await collega(db,coll,r,meta,t)}catch(e){console.error(e);ko.push(t)}}
  return {meta,ko}}

const senza=(r,id)=>(r.bonifici||[]).filter(x=>x.id!==id);
/* toglie la copia f da r: se r la custodisce la toglie anche dalle iscrizioni collegate e cancella i blocchi; se è solo collegata la scollega */
export async function togli(db,coll,r,f,tutte){
  if(f.ref){const l=senza(r,f.id);await fupd(fdoc(db,coll,r.id),{bonifici:l});r.bonifici=l;return 0}
  const lk=collegateA(r,f,tutte);
  for(const x of lk){const l=senza(x,f.id);await fupd(fdoc(db,coll,x.id),{bonifici:l});x.bonifici=l}
  await delChunks(db,coll,r.id,f);
  const l=senza(r,f.id);await fupd(fdoc(db,coll,r.id),{bonifici:l});r.bonifici=l;
  return lk.length}

/* prima di ELIMINARE l'iscrizione r: libera i suoi blocchi, passandoli a un'iscrizione collegata se ce n'è una */
export async function liberaPrimaDiEliminare(db,coll,r,tutte){
  for(const f of bonificiOf(r)){
    if(f.ref)continue;
    const lk=collegateA(r,f,tutte);
    if(!lk.length){await delChunks(db,coll,r.id,f);continue}
    const nuova=lk[0],s=await fget(fcol(db,coll,r.id,'chunks')),parti=s.docs.map(d=>d.data()).filter(x=>x.f===f.id);
    if(!parti.length)throw new Error('EMPTY');
    for(const p of parti)await fset(fdoc(db,coll,nuova.id,'chunks',f.id+'k'+p.i),{f:f.id,i:p.i,data:p.data});
    for(const x of lk){
      const l=(x.bonifici||[]).map(b=>b.id!==f.id?b:x.id===nuova.id?(({ref,...m})=>m)(b):{...b,ref:nuova.id});
      await fupd(fdoc(db,coll,x.id),{bonifici:l});x.bonifici=l}
    await delChunks(db,coll,r.id,f)}}
