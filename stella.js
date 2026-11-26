/* Documenti e File importanti: la sincronizzazione automatica resta ATTIVA (prima era spenta e le modifiche degli altri account
   non arrivavano finché non si riapriva la pagina). Non lampeggia: la pagina si ridisegna solo se i dati sono davvero cambiati.
   Quando una stella cambia, le altre schede aperte dello stesso browser si aggiornano subito. */
import {setAutoSync,syncNow} from "./fsx.js";
export function stelle(){
  setAutoSync(true);
  const bc='BroadcastChannel' in window?new BroadcastChannel('pfm-stella'):null;
  if(bc)bc.onmessage=()=>{syncNow().catch(e=>console.error(e))};
  return {cambiata:()=>{if(bc)bc.postMessage(Date.now())}}}
