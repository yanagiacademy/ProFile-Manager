/* Cadenza dei test degli atleti: logica condivisa da Home (index.html) e dalla pagina Atleti.
   Ogni atleta ha una cadenza (ogni N settimane/mesi) e una data "prossimo test" (data alert).
   Se la data non è scritta a mano, è calcolata: ultimo test + cadenza.
   Dalla data alert (meno i giorni di preavviso, se impostati) la scheda diventa rossa nella Home. */
export const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
export const fmtD=d=>String(d||'').split('-').reverse().join('/');
const p2=n=>String(n).padStart(2,'0');
const ymd=x=>x.getFullYear()+'-'+p2(x.getMonth()+1)+'-'+p2(x.getDate());
const oggi=()=>{const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate())};
export const giorni=d=>isD(d)?Math.round((new Date(d+'T00:00:00')-oggi())/864e5):null;

/* data + N settimane ('s') oppure N mesi ('m') */
export function addCad(d,n,u){
  if(!isD(d)||!(n>0))return '';
  const x=new Date(d+'T12:00:00');
  if(u==='m'){const g=x.getDate();x.setMonth(x.getMonth()+n);if(x.getDate()!==g)x.setDate(0)}
  else x.setDate(x.getDate()+7*n);
  return ymd(x)}

/* data dell'ultima rilevazione dei test */
export const ultimoTest=i=>(i.test||[]).map(t=>t.data).filter(isD).sort().pop()||'';

/* data alert: quella scritta a mano, altrimenti ultimo test + cadenza */
export function prossimoTest(i){
  if(isD(i.prossimo))return i.prossimo;
  const u=ultimoTest(i);
  return isD(u)?addCad(u,+i.cadN,i.cadU):''}

/* {data, g (giorni mancanti, negativo se in ritardo), due (da fare: alert attivo), late (in ritardo)} oppure null */
export function testStato(i){
  const d=prossimoTest(i);if(!d)return null;
  const g=giorni(d),pre=Math.max(0,+i.preavviso||0);
  return {data:d,g,due:g<=pre,late:g<0}}
export const testDaFare=i=>{const s=i&&testStato(i);return !!s&&s.due};
export const testTesto=g=>g===null?'':g<0?'in ritardo di '+(-g)+(g===-1?' giorno':' giorni'):g===0?'oggi':g===1?'domani':'tra '+g+' giorni';

/* Eventi: scadenza di iscrizione (o hotel) entro 10 giorni, evento non chiuso né concluso (usato dalla Home) */
export const eventoInScadenza=(ev,gg=10)=>{
  if(!ev||ev.kind!=='evento'||ev.chiuso)return false;
  if(isD(ev.data)&&giorni(ev.data)<0)return false;
  const u=d=>isD(d)&&giorni(d)>=0&&giorni(d)<=gg;
  return u(ev.scadReg)||(!!ev.hotel&&u(ev.scadHotel))};

/* Tessere: scadenza della tessera e del certificato medico, avviso a 30 giorni (e se già scaduti) */
export const GG_TESSERA=30;
export function scadStato(d,gg=GG_TESSERA){
  if(!isD(d))return null;
  const g=giorni(d);
  return {data:d,g,late:g<0,soon:g>=0&&g<=gg,alert:g<=gg}}
export const tesseraAlert=t=>{
  if(t&&t.kind==='tesserino'){const a=scadStato(t.scadenza);return !!(a&&a.alert)}      /* tesserino di un tecnico: solo se ha una scadenza */
  if(!t||t.kind!=='tessera')return false;
  const a=scadStato(t.scadenza),b=scadStato(t.certScad);
  return !!((a&&a.alert)||(b&&b.alert))};
