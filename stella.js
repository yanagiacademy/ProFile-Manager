/* Documenti e File importanti: niente ricalcolo ogni 20 secondi.
   I dati si ricaricano da Telegram solo quando una stella viene messa o tolta (qui o in un'altra scheda del browser):
   chi cambia la stella avvisa le altre schede aperte, che si aggiornano subito. */
import {setAutoSync,syncNow} from "./fsx.js";
export function stelle(){
  setAutoSync(false);
  const bc='BroadcastChannel' in window?new BroadcastChannel('pfm-stella'):null;
  if(bc)bc.onmessage=()=>{syncNow().catch(e=>console.error(e))};
  return {cambiata:()=>{if(bc)bc.postMessage(Date.now())}}}
