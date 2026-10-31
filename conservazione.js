/* Archivio e conservazione dei documenti (obbligo A.S.D.: 10 anni).
   Un documento archiviato resta nella raccolta di Documenti, ma con questi campi:
     archiviatoIl    data di archiviazione (AAAA-MM-GG)
     conservaFino    ultimo giorno di conservazione (AAAA-MM-GG)
     conservaFinoTs  stesso giorno, a fine giornata, come Timestamp: lo usano le regole di Firestore per bloccare l'eliminazione
     origine         percorso della cartella da cui proviene
     storico         cronologia delle operazioni
   Zona "Da conservare" = fino a conservaFino compreso. Dal giorno dopo il documento è in "Verifica". */
import {doc,updateDoc,arrayUnion,Timestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {isD,giorni,fmtD} from "./scadenze.js";

export const ANNI=10;
const p2=n=>String(n).padStart(2,'0');
export const oggiISO=()=>{const n=new Date();return n.getFullYear()+'-'+p2(n.getMonth()+1)+'-'+p2(n.getDate())};
/* aggiunge mesi a una data senza sforare a fine mese (31 ago + 6 mesi = 28 feb) */
export function addMesi(iso,n){
  const [y,m,d]=iso.split('-').map(Number),t=new Date(y,m-1+n,1),last=new Date(t.getFullYear(),t.getMonth()+1,0).getDate();
  return t.getFullYear()+'-'+p2(t.getMonth()+1)+'-'+p2(Math.min(d,last))}
const ts=iso=>Timestamp.fromDate(new Date(iso+'T23:59:59'));
export const archiviato=i=>!!i&&i.kind==='file'&&isD(i.archiviatoIl);
/* '' = non archiviato; 'conservare' = da conservare (anche se manca la data di fine: nel dubbio non si elimina); 'verifica' = periodo concluso */
export const zona=i=>!archiviato(i)?'':(isD(i.conservaFino)&&giorni(i.conservaFino)<0?'verifica':'conservare');
const ref=(db,it)=>doc(db,'sections','documenti','items',it.id);
const cartelle=(items,id)=>{const a=[];let x=items.find(i=>i.id===id);while(x){a.unshift(x.title);x=items.find(i=>i.id===x.parent)}return a.join(' / ')};

/* Archivia un documento per 10 anni dalla data di oggi. items = elenco di Documenti (serve a ricostruire la cartella d'origine) */
export async function archiviaDoc(db,it,items,motivo){
  const oggi=oggiISO(),fino=addMesi(oggi,12*ANNI);
  await updateDoc(ref(db,it),{archiviatoIl:oggi,conservaFino:fino,conservaFinoTs:ts(fino),origine:cartelle(items,it.parent||''),parent:'',star:false,
    storico:arrayUnion(oggi+': archiviato ('+motivo+'), da conservare fino al '+fmtD(fino))})}

/* Dalla Verifica di nuovo in archivio per un periodo (in mesi). Restituisce la nuova data di fine conservazione */
export async function riarchiviaDoc(db,it,mesi,etichetta){
  const oggi=oggiISO(),fino=addMesi(oggi,mesi);
  await updateDoc(ref(db,it),{conservaFino:fino,conservaFinoTs:ts(fino),storico:arrayUnion(oggi+': riarchiviato per '+etichetta+', da conservare fino al '+fmtD(fino))});
  return fino}

/* I documenti scaduti (scadenza passata) vanno in archivio. Viene eseguito da chi ha la scrittura su Documenti quando apre le pagine;
   è sicuro eseguirlo più volte e da più dispositivi. */
let busy=false;const tried=new Set();
export async function archiviaScaduti(db,items){
  if(busy)return 0;
  const due=items.filter(i=>i.kind==='file'&&!i.archiviatoIl&&isD(i.scadenza)&&giorni(i.scadenza)<0&&!tried.has(i.id));
  if(!due.length)return 0;
  busy=true;let n=0;
  for(const i of due){tried.add(i.id);try{await archiviaDoc(db,i,items,'scaduto il '+fmtD(i.scadenza));n++}catch(e){console.error(e)}}
  busy=false;return n}
