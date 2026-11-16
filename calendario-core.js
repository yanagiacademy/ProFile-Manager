/* calendario-core.js – calcolo del programma (routine frequenti, allenamenti straordinari, eventi). Usato da index.html (riga sotto il saluto) e da calendario.js.
   Dati: sections/calendario/items (kind 'routine' | 'straordinario'), eventi da sections/eventi/items (kind 'evento'), pausa globale in app/routine
   = {sospesa:bool, motivo, dal, finoAl, by, at}. Le date sono stringhe AAAA-MM-GG, gli orari HH:MM.
   Pausa: vale per le sole ROUTINE (gli straordinari e gli eventi restano). Se sospesa=true, le routine saltano i giorni da «dal» (se indicato) a «finoAl» compreso (se indicato);
   passato «finoAl» ripartono da sole. */
export const GIORNI=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
export const ORDINE=[1,2,3,4,5,6,0];
export const ETICHETTE={routine:'Allenamento',straordinario:'Allenamento straordinario',evento:'Evento'};
const pad=n=>String(n).padStart(2,'0');
export const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
export const parseYmd=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));return m?new Date(+m[1],+m[2]-1,+m[3]):null};
const hm=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||''));return m?(+m[1])*60+(+m[2]):null};
export const fmtGiorno=(ds,opz)=>{const d=parseYmd(ds);return d?d.toLocaleDateString('it-IT',opz||{day:'numeric',month:'long',year:'numeric'}):''};

/* 'off' | 'programmata' | 'attiva' | 'scaduta' */
export function statoPausa(cfg,oggi){
  if(!cfg||!cfg.sospesa)return 'off';
  if(cfg.finoAl&&oggi>cfg.finoAl)return 'scaduta';
  if(cfg.dal&&oggi<cfg.dal)return 'programmata';
  return 'attiva'}
export const pausaGiorno=(cfg,ds)=>!!(cfg&&cfg.sospesa&&(!cfg.dal||ds>=cfg.dal)&&(!cfg.finoAl||ds<=cfg.finoAl));

function occ(tipo,x,ds){
  const d=parseYmd(ds),base=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),a=hm(x.ora),b=hm(x.oraFine);
  return {tipo,id:x.id,titolo:x.titolo||x.nome||'',data:ds,ora:x.ora||'',oraFine:x.oraFine||'',luogo:x.luogo||'',nota:x.nota||'',
    ini:base+(a||0)*6e4,fine:b!=null?base+b*6e4:a!=null?base+(a+120)*6e4:base+864e5-1}}

/* Occorrenze future (non ancora finite) nei prossimi `giorni` giorni, in ordine di inizio.
   visibile(x) = false per escludere ciò che non riguarda l'atleta scelto (solo anteprima dell'admin). */
export function occorrenze({routine=[],straord=[],eventi=[],cfg=null,adesso=new Date(),giorni=120,visibile=()=>true}={}){
  const out=[],t0=new Date(adesso.getFullYear(),adesso.getMonth(),adesso.getDate()),oggi=ymd(t0),lim=ymd(new Date(t0.getFullYear(),t0.getMonth(),t0.getDate()+giorni));
  for(let i=0;i<=giorni;i++){
    const d=new Date(t0.getFullYear(),t0.getMonth(),t0.getDate()+i),ds=ymd(d);
    if(pausaGiorno(cfg,ds))continue;
    for(const r of routine){
      if(r.attivo===false||!visibile(r)||!Array.isArray(r.giorni)||!r.giorni.includes(d.getDay()))continue;
      if((r.dal&&ds<r.dal)||(r.al&&ds>r.al))continue;
      out.push(occ('routine',r,ds))}}
  for(const s of straord)if(visibile(s)&&s.data&&s.data>=oggi&&s.data<=lim)out.push(occ('straordinario',s,s.data));
  for(const e of eventi)if(visibile(e)&&e.data&&e.data>=oggi&&e.data<=lim)out.push(occ('evento',e,e.data));
  return out.filter(o=>o.fine>=adesso.getTime()).sort((a,b)=>a.ini-b.ini||a.tipo.localeCompare(b.tipo))}
export const prossimo=o=>occorrenze(o)[0]||null;

/* «oggi · 18:30–20:00», «domani · 18:30», «martedì 18 novembre · 18:30» */
export function quando(o,adesso=new Date()){
  const d=parseYmd(o.data),t=new Date(adesso.getFullYear(),adesso.getMonth(),adesso.getDate()),diff=Math.round((d-t)/864e5);
  const g=diff===0?'oggi':diff===1?'domani':d.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  return g+(o.ora?' · '+o.ora+(o.oraFine?'–'+o.oraFine:''):'')}
