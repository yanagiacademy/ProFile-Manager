/* Atleta attivo: per gli account con 2 o più atleti collegati (genitore e figlio, due figli…) — stessa email in Atleti.
   Chi ha un solo atleta non vede nulla di diverso. Chi ne ha più sceglie «Stai guardando: …» e le sezioni (Esami, Eventi) mostrano
   i dati di QUELL'atleta: cintura e materiale d'esame del suo grado, iscrizioni agli eventi separate per ogni atleta.
   La scelta resta salvata nel dispositivo e vale per tutte le sezioni. */
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {livDaGrado} from "./gradi.js";
const K='pm_atleta_attivo';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const nomeAt=a=>a?(((a.cognome||'')+' '+(a.nome||'')).trim()||'Atleta'):'';
/* atleti collegati all'account (atletiEmail/<email> → atletiDati/<id>): [{id,nome,cognome,liv}] */
export async function caricaAtleti(db,email){
  const out=[];if(!email)return out;
  try{
    const k=await getDoc(doc(db,'atletiEmail',email.toLowerCase()));if(!k.exists())return out;
    const d=k.data(),ids=Array.isArray(d.atleti)&&d.atleti.length?d.atleti:(d.atleta?[d.atleta]:[]);
    for(const id of ids){
      try{const s=await getDoc(doc(db,'atletiDati',id));const v=s.exists()?s.data():{};
        out.push({id,nome:String(v.nome||'').trim(),cognome:String(v.cognome||'').trim(),liv:livDaGrado(v.grado)})}
      catch(x){out.push({id,nome:'',cognome:'',liv:0})}}
  }catch(x){console.error('atleti dell’account',x)}
  return out}
export function attivoDi(lista){let id='';try{id=localStorage.getItem(K)||''}catch(e){}return lista.find(a=>a.id===id)||lista[0]||null}
export function impostaAttivo(id){try{localStorage.setItem(K,id)}catch(e){}}
/* menu di scelta (solo se gli atleti sono 2 o più); l'elemento ha data-atlsel */
export const selettore=(lista,att)=>lista.length>1?`<div class="atlsel" style="margin:0 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="atlsel" style="margin:0"><b>Stai guardando</b></label><select id="atlsel" data-atlsel style="max-width:100%">${lista.map(a=>`<option value="${esc(a.id)}" ${att&&att.id===a.id?'selected':''}>${esc(nomeAt(a))}</option>`).join('')}</select></div>`:'';
