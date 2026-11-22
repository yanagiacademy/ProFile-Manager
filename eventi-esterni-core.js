/* Iscrizioni per gli esterni (Eventi): funzioni condivise dalla pagina pubblica (iscrizione.js) e da quella dell'admin (eventi-esterni.js).
   Nessun accesso a Firebase qui: solo calcoli, così l'importo si calcola allo stesso modo dappertutto.
   Importo: atleti × quota + tecnici × quota tecnici (se vuota = come gli atleti, 0 = gratis) − coupon (gratis, % o € sul totale). */
export const ALFA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';       /* niente I, O, 0, 1: non si confondono a voce o a mano */
export const num=v=>{const n=parseFloat(String(v??'').replace(',','.'));return isFinite(n)&&n>0?n:0};
export const r2=n=>Math.round((+n||0)*100)/100;
export const euroTxt=n=>(+n||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
export const fmtData=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?String(d).split('-').reverse().join('/'):'';
export const nomeP=p=>[p&&p.cognome,p&&p.nome].filter(Boolean).join(' ')||'—';
export const ruoloTxt=r=>r==='tecnico'?'Tecnico':'Atleta';
export const isTec=p=>!!p&&p.ruolo==='tecnico';

/* id casuale (non indovinabile): è anche la «chiave» del link di stato dell'iscrizione */
export const newId=(n=20)=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,b=>(b%36).toString(36)).join('')};

/* codice personale: 8 caratteri a gruppi di 4 (es. K7M2-Q9XP); 256 è multiplo di 32, quindi nessuna distorsione */
export function nuovoCodice(usati=new Set()){
  for(let k=0;k<50;k++){
    const a=new Uint8Array(8);crypto.getRandomValues(a);
    const s=Array.from(a,b=>ALFA[b%32]).join(''),c=s.slice(0,4)+'-'+s.slice(4);
    if(!usati.has(c)){usati.add(c);return c}}
  throw new Error('Impossibile generare un codice nuovo.')}
/* il codice letto dal QR o scritto a mano: maiuscole, senza spazi, trattino al posto giusto */
export function normCodice(s){
  const t=String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  return t.length===8?t.slice(0,4)+'-'+t.slice(4):String(s||'').trim().toUpperCase()}

/* coupon */
export const normCoupon=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24);
export const couponId=(ev,codice)=>ev+'_'+normCoupon(codice);
export const couponTxt=c=>!c?'':c.tipo==='gratis'?'Gratuito':c.tipo==='perc'?'Sconto '+(+c.valore||0)+'%':'Sconto '+euroTxt(c.valore);
/* coupon con limite di utilizzi (max > 0): esaurito quando gli usi hanno raggiunto il limite */
export const couponEsaurito=(c,usi)=>!!c&&num(c.max)>0&&(+usi||0)>=num(c.max);
/* un coupon vale se è attivo e non scaduto (alla data indicata) */
export function couponOk(c,adesso=Date.now()){
  if(!c)return {ok:false,motivo:'Coupon non valido.'};
  if(c.attivo===false)return {ok:false,motivo:'Questo coupon non è più attivo.'};
  if(c.scadenzaMs&&adesso>c.scadenzaMs)return {ok:false,motivo:'Questo coupon è scaduto.'};
  return {ok:true,motivo:''}}

/* quota di una persona: i tecnici pagano la «quota tecnici» se l'admin l'ha indicata (0 = gratis), altrimenti come gli atleti */
export function quotaRuolo(m,ruolo){
  if(ruolo==='tecnico'&&String(m.quotaTecnico??'').trim()!=='')return num(m.quotaTecnico);
  return num(m.quota)}
/* m = dati dell'evento (quota, quotaTecnico); persone = [{ruolo,…}]; coupon = documento coupon (o null) */
export function calcola(m,persone,coupon,adesso=Date.now()){
  const tec=persone.filter(isTec).length,atl=persone.length-tec,
    sa=r2(atl*quotaRuolo(m,'atleta')),st=r2(tec*quotaRuolo(m,'tecnico')),lordo=r2(sa+st),cp=coupon?couponOk(coupon,adesso):{ok:false,motivo:''};
  let sconto=0;
  if(cp.ok){
    if(coupon.tipo==='gratis')sconto=lordo;
    else if(coupon.tipo==='perc')sconto=lordo*Math.min(100,num(coupon.valore))/100;
    else sconto=Math.min(lordo,num(coupon.valore))}
  sconto=r2(sconto);
  return {atl,tec,sa,st,lordo,sconto,totale:r2(Math.max(0,lordo-sconto)),coupon:cp}}
