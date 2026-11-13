/* Visibilità dei file di Documenti, Video e Foto.
   Ogni elemento può avere soloPer = elenco di uid degli account che possono vederlo. Assente o vuoto = tutti quelli che hanno accesso alla sezione.
   L'admin e chi ha caricato l'elemento lo vedono sempre. Per le cartelle vale anche per il contenuto: dentro una cartella nascosta non si vede nulla.
   ATTENZIONE: è un filtro dell'app. I contenuti su Telegram sono cifrati con la chiave della sezione, che hanno tutti gli account con accesso alla sezione:
   per dati davvero riservati non basta, serve una sezione a cui accedono solo le persone giuste. */
export const ristretto=i=>Array.isArray(i&&i.soloPer)&&i.soloPer.length>0;
const mio=(i,uid)=>!ristretto(i)||i.by===uid||i.soloPer.includes(uid);
export function visibile(i,all,uid,admin){
  if(admin)return true;
  const visti=new Set();let x=i;
  while(x&&!visti.has(x.id)){visti.add(x.id);if(!mio(x,uid))return false;x=x.parent?all.find(y=>y.id===x.parent):null}
  return true}
export const filtra=(items,uid,admin)=>admin?items:items.filter(i=>visibile(i,items,uid,admin));
