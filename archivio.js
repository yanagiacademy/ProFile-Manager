/* Archivio file di una sezione: salva, legge ed elimina i file allegati agli elementi di "sections/<sec>/items".
   Stessa logica di Documenti: su Telegram se è configurato, altrimenti a blocchi dentro Firestore (max 20 MB). */
import {collection,doc,setDoc,addDoc,getDocs,deleteDoc,updateDoc,deleteField,Bytes,serverTimestamp} from "./fsx.js";
import {tgConfigured,tgClient,tgEntity,hasSession,tgErrText,tgSendFile,tgTopic} from "./telegram.js";
import {TG_FILES} from "./telegram-config.js";
import {guessMime,makeThumb} from "./file-tools.js";

const MAX=20*1024*1024,CH=900000,MAX_TG=500*1024*1024;
export const limiteMB=()=>tgConfigured()?500:20;

export function archivio(db,sec,uid){
  const col=collection(db,'sections',sec,'items');
  /* copia del contenuto di un file su Firebase, a blocchi (max 20 MB) */
  const writeChunks=async(id,file)=>{
    const n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',sec,'items',id,'chunks');
    try{for(let k=0;k<n;k++){const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)})}return n}
    catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}};
  return {
    maxBytes:()=>tgConfigured()?MAX_TG:MAX,
    needsTelegram:()=>tgConfigured()&&!hasSession(),
    errText:e=>e&&e.message==='size'?'file troppo grande':e&&e.message==='MISSING'?'file non più presente su Telegram':e&&e.message==='EMPTY'?'file non leggibile':tgErrText(e),

    /* extra: campi aggiuntivi del documento (es. {lesson:id}). Restituisce l'id del documento creato */
    async save(file,extra={},onProgress=()=>{}){
      const th=await makeThumb(file,file.name,file.type),tx=th?{thumb:th}:{};
      const base={title:file.name,kind:'file',size:file.size,mime:file.type||'',note:'',by:uid,at:serverTimestamp(),...tx,...extra};
      if(tgConfigured()){
        if(file.size>MAX_TG)throw new Error('size');
        const {client,tg}=await tgClient(),ent=await tgEntity(TG_FILES);
        const r=await tgSendFile(tg,client,ent,file,pr=>onProgress(Math.round(pr*100)),'auto',undefined,await tgTopic(TG_FILES,sec));
        if(extra.fb&&file.size<=MAX){const dref=doc(col),n=await writeChunks(dref.id,file);await setDoc(dref,{...base,tg:r.id,chunks:n});return dref.id}
        return (await addDoc(col,{...base,tg:r.id})).id}
      if(file.size>MAX)throw new Error('size');
      const dref=doc(col),n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',sec,'items',dref.id,'chunks');
      try{
        for(let k=0;k<n;k++){
          const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());
          await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)});onProgress(Math.round((k+1)/n*100))}
        await setDoc(dref,{...base,chunks:n});return dref.id
      }catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}},

    async getBlob(it,say=()=>{}){
      if(it.tg&&!(it.chunks&&!hasSession())){try{
        say('Collegamento a Telegram…');
        const {client}=await tgClient(),ent=await tgEntity(TG_FILES),[m]=await client.getMessages(ent,{ids:[it.tg]});
        if(!m||!m.media)throw new Error('MISSING');
        const buf=await client.downloadMedia(m,{progressCallback:(r,t)=>say('Download: '+Math.round(Number(r)/Number(t)*100)+'%')});
        return new Blob([buf],{type:guessMime(it.title,it.mime)})}catch(e){if(!it.chunks)throw e}}
      say('Preparazione del file…');
      const sn=await getDocs(collection(db,'sections',sec,'items',it.id,'chunks'));
      const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
      if(!parts.length)throw new Error('EMPTY');
      return new Blob(parts,{type:guessMime(it.title,it.mime)})},

    /* Aggiunge (on) o toglie la copia su Firebase di un contenuto; per i file copia anche il contenuto (fino a 20 MB) */
    async fbSet(it,on,say=()=>{}){
      const ref=doc(db,'sections',sec,'items',it.id);
      if(!on){
        if(it.chunks&&it.tg){await Promise.all(Array.from({length:it.chunks},(_,k)=>deleteDoc(doc(db,'sections',sec,'items',it.id,'chunks','c'+k)).catch(()=>{})));return updateDoc(ref,{fb:false,chunks:deleteField()})}
        return updateDoc(ref,{fb:false})}
      if(it.kind==='file'&&it.tg&&!it.chunks){
        if(it.size>MAX)throw new Error('size');
        const n=await writeChunks(it.id,await this.getBlob(it,say));return updateDoc(ref,{fb:true,chunks:n})}
      return updateDoc(ref,{fb:true})},

    /* Elimina prima il documento (le regole lo rifiutano se è ancora in conservazione) e solo dopo il file: così un rifiuto non fa perdere nulla */
    async removeSafe(it){
      await deleteDoc(doc(db,'sections',sec,'items',it.id));
      if(it.tg){try{const {client}=await tgClient();await client.deleteMessages(await tgEntity(TG_FILES),[it.tg],{revoke:true})}catch(e){}}
      if(it.chunks)await Promise.all(Array.from({length:it.chunks},(_,k)=>deleteDoc(doc(db,'sections',sec,'items',it.id,'chunks','c'+k)).catch(()=>{})))},

    async remove(it){
      if(it.tg){try{const {client}=await tgClient();await client.deleteMessages(await tgEntity(TG_FILES),[it.tg],{revoke:true})}catch(e){}}
      if(it.chunks)await Promise.all(Array.from({length:it.chunks},(_,k)=>deleteDoc(doc(db,'sections',sec,'items',it.id,'chunks','c'+k)).catch(()=>{})));
      await deleteDoc(doc(db,'sections',sec,'items',it.id))}
  };
}
