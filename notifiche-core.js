/* Notifiche Telegram – parte di calcolo (nessun accesso a Firebase né a Telegram: si può provare da sola).
   Decide COSA mandare, A CHI e QUANDO, e confronta con il registro di ciò che è già stato programmato/inviato.
   • Atleti: promemoria al loro Telegram quando scadono tessera e certificato medico (di default 30, 7 e 1 giorno prima, alle 9).
   • Admin: un riepilogo per ogni giorno con scadenze (documenti, tessere e certificati di tutti gli atleti, iscrizioni/hotel degli eventi, test)
     programmato nei "Messaggi salvati" dell'admin: Telegram lo consegna all'ora giusta anche se l'app è chiusa.
   • Eventi: alla creazione di un evento, messaggio subito a tutti gli atleti con Telegram. */
import {prossimoTest} from "./atleti-scadenze.js";

export const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
export const fmtD=d=>String(d||'').split('-').reverse().join('/');
const p2=n=>String(n).padStart(2,'0');
export const CFG0={eventi:true,atleti:true,admin:true,ricevute:true,esiti:true,giorni:[30,7,1],ora:9};
export const MIN_ANTICIPO=150*1000;                 /* Telegram vuole almeno qualche decina di secondi di anticipo */
export const FINESTRA_ADMIN=90;                     /* giorni: i riepiloghi dell'admin si programmano al massimo 90 giorni avanti (limite di 100 messaggi programmati per chat) */
export const RECENTI=14*864e5;                    /* ricevute ed esiti si notificano solo se recenti (ultimi 14 giorni): niente messaggi sul passato */
export const RITENTA=24*3600e3;                     /* un invio fallito si ritenta dopo 24 ore */
export const CATCHUP_MAX_RITARDO=14;                /* un promemoria "già scaduto" si manda solo se la scadenza è di meno di 14 giorni fa */

export function cfgOk(c){
  const o={...CFG0,...(c||{})};
  o.eventi=o.eventi!==false;o.atleti=o.atleti!==false;o.admin=o.admin!==false;o.ricevute=o.ricevute!==false;o.esiti=o.esiti!==false;
  const g=[...new Set((Array.isArray(o.giorni)?o.giorni:String(o.giorni||'').split(/[,\s;]+/)).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=90))].sort((a,b)=>b-a);
  o.giorni=g.length?g.slice(0,6):CFG0.giorni.slice();
  o.ora=Math.min(21,Math.max(6,Math.round(Number(o.ora))||CFG0.ora));
  return o}
/* Accetta @nome, nome, t.me/nome, https://t.me/nome. I numeri di telefono non sono supportati. */
export function parseHandle(s){
  let t=String(s||'').trim().replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i,'').replace(/^t\.me\//i,'').replace(/^@/,'').replace(/[\/?#].*$/,'');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(t)?t:''}
export const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};
const midnight=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
export const giorniA=(date,now)=>Math.round((new Date(date+'T00:00:00')-midnight(now))/864e5);
const alle=(date,k,ora)=>{const [y,m,d]=date.split('-').map(Number);return new Date(y,m-1,d-k,ora,0,0)};
const dayIso=t=>{const d=new Date(t);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())};
const GIORNO=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const quando=k=>k<0?'scaduto da '+(-k)+(k===-1?' giorno':' giorni'):k===0?'scade oggi':k===1?'scade domani':'scade tra '+k+' giorni';
const quandoAdm=k=>k<0?'scaduto da '+(-k)+' g':k===0?'oggi':k===1?'domani':'tra '+k+' giorni';
const euro=n=>Number(n).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
const nomeAt=a=>((a.cognome||'')+' '+(a.nome||'')).trim()||a.title||'atleta';
const FIRMA='\n— Yanagi Academy';
/* rubrica: {idAtleta: 'nomeutente'} oppure {idAtleta:{h:'nomeutente',g:1}} (g = genitore: messaggi riferiti all'atleta) */
const hOf=v=>typeof v==='string'?v:(v&&v.h)||'';
const gOf=v=>!!(v&&typeof v==='object'&&v.g);

export function testoEvento(ev,url){
  const r=['🏆 Nuovo evento: '+(ev.nome||ev.title||'senza nome'),'📅 '+fmtD(ev.data)+(ev.cat&&ev.cat!=='altro'?'':'')];
  if(isD(ev.scadReg))r.push('📝 Iscrizioni entro il '+fmtD(ev.scadReg));
  if(ev.quota&&!isNaN(Number(ev.quota)))r.push('💶 Quota: '+euro(ev.quota));
  if(ev.hotel&&isD(ev.scadHotel))r.push('🏨 Prenotazione hotel entro il '+fmtD(ev.scadHotel));
  if(ev.nota)r.push(String(ev.nota).slice(0,200));
  r.push('Apri l’app per iscriverti: '+url);
  return r.join('\n')+FIRMA}

/* dati: {atleti, tessere, documenti, eventi} (liste di elementi con id), rubrica: {idAtleta: handle}, cfg, now, url.
   Restituisce la lista di tutto ciò che DEVE esistere: [{key,tipo:'atleta'|'admin'|'evento',peer,peers,when,text}] */
export function costruisci({atleti=[],tessere=[],documenti=[],eventi=[],ricevute=[],esiti=[],rubrica={},cfg,now=new Date(),url=''}){
  cfg=cfgOk(cfg);now=new Date(+now);const t0=+now,out=[],nomi={};
  atleti.forEach(a=>{nomi[a.id]=nomeAt(a)});
  tessere.forEach(t=>{const id=t.atleta||t.id;if(id&&!nomi[id])nomi[id]=nomeAt(t)});
  const conta={};Object.values(rubrica).map(hOf).filter(Boolean).forEach(h=>{conta[h]=(conta[h]||0)+1});      /* stesso Telegram su più atleti = famiglia */
  const CAMPI=[['scadenza','tessera','la tessera','la tua tessera','🪪 Tessera'],['certScad','certificato medico','il certificato medico','il tuo certificato medico','🩺 Certificato medico']];
  /* --- atleti --- */
  const adm=[];                                  /* [{label,date}] per i riepiloghi dell'admin */
  for(const t of tessere){
    if(t.kind!=='tessera')continue;
    const aid=t.atleta||t.id,rv=rubrica[aid],h=hOf(rv),nome=(t.nome||'').trim(),fam=!!h&&(gOf(rv)||conta[h]>1);
    for(const [campo,,la,tuo,lab] of CAMPI){
      const date=t[campo];if(!isD(date))continue;
      adm.push({label:lab+' di '+(nomi[aid]||nomeAt(t)),date});
      if(!cfg.atleti||!h)continue;
      const g=giorniA(date,now);let passato=false;
      for(const k of cfg.giorni){
        const quando_=alle(date,k,cfg.ora);
        if(+quando_-t0>MIN_ANTICIPO&&+quando_-t0<360*864e5)
          out.push({key:`a:${aid}:${campo}:${date}:${k}`,tipo:'atleta',peer:h,when:+quando_,
            text:`Ciao${fam?'':nome?' '+nome:''}, ${fam?la+' di '+(nomi[aid]||nome):tuo} scade il ${fmtD(date)} (${k===1?'domani':'tra '+k+' giorni'}). Ricordati di rinnovarlo/a e di aggiornarlo nell’app.${FIRMA}`});
        else passato=true}
      /* già dentro la finestra di preavviso quando si attiva: un solo messaggio subito (poi il registro evita ripetizioni) */
      if(passato&&g>=-CATCHUP_MAX_RITARDO)
        out.push({key:`a:${aid}:${campo}:${date}:c`,tipo:'atleta',peer:h,when:null,
          text:`Ciao${fam?'':nome?' '+nome:''}, ${fam?la+' di '+(nomi[aid]||nome):tuo} ${g<0?'è scaduto/a il '+fmtD(date)+' (da '+(-g)+(g===-1?' giorno':' giorni')+')':g===0?'scade oggi ('+fmtD(date)+')':'scade il '+fmtD(date)+' ('+(g===1?'domani':'tra '+g+' giorni')+')'}. Ricordati di rinnovarlo/a e di aggiornarlo nell’app.${FIRMA}`})}}
  /* tesserini dei tecnici con scadenza: solo nel riepilogo dell'admin */
  for(const t of tessere){if(t.kind==='tesserino'&&isD(t.scadenza))adm.push({label:'🥋 Tesserino '+(t.title||'di un tecnico'),date:t.scadenza})}
  /* --- elementi per l'admin --- */
  for(const d of documenti){if(d.kind==='file'&&!d.archiviatoIl&&isD(d.scadenza))adm.push({label:'📄 '+(d.title||'Documento'),date:d.scadenza})}
  for(const e of eventi){
    if(e.kind!=='evento'||e.chiuso||(isD(e.data)&&giorniA(e.data,now)<0))continue;
    const n=e.nome||e.title||'Evento';
    if(isD(e.scadReg))adm.push({label:'🏆 '+n+' — iscrizioni',date:e.scadReg});
    if(e.hotel&&isD(e.scadHotel))adm.push({label:'🏨 '+n+' — hotel',date:e.scadHotel})}
  for(const a of atleti){if(a.kind&&a.kind!=='atleta')continue;const d=prossimoTest(a);if(isD(d))adm.push({label:'📋 Test di '+nomeAt(a),date:d})}
  if(cfg.admin){
    const giorniAdm=[...new Set([...cfg.giorni,0])];const perGiorno={};
    for(const it of adm)for(const k of giorniAdm){
      const q=alle(it.date,k,cfg.ora);
      if(+q-t0<=MIN_ANTICIPO||+q-t0>FINESTRA_ADMIN*864e5)continue;
      (perGiorno[dayIso(q)]=perGiorno[dayIso(q)]||{when:+q,righe:[]}).righe.push({k,t:'• '+it.label+': '+quandoAdm(k)+' ('+fmtD(it.date)+')'})}
    for(const [dIso,g] of Object.entries(perGiorno).sort()){
      const dd=new Date(g.when),righe=g.righe.sort((a,b)=>a.k-b.k||a.t.localeCompare(b.t)).map(r=>r.t);
      const text='🔔 Scadenze — '+GIORNO[dd.getDay()]+' '+p2(dd.getDate())+'/'+p2(dd.getMonth()+1)+'\n'+righe.join('\n');
      out.push({key:`ad:${dIso}:${hash(text)}`,tipo:'admin',peer:'me',when:g.when,text})}}
  /* --- eventi nuovi: subito a tutti gli atleti con Telegram --- */
  if(cfg.eventi){
    const peers=[...new Set(Object.values(rubrica).map(hOf).filter(Boolean))];
    for(const e of eventi){
      if(e.kind!=='evento'||e.chiuso||(isD(e.data)&&giorniA(e.data,now)<0))continue;
      out.push({key:'ev:'+e.id,tipo:'evento',peers,when:null,text:testoEvento(e,url)})}}
  /* --- ricevute di pagamento: subito all'atleta (solo se caricate negli ultimi 14 giorni; una ricevuta sostituita non si rinotifica: stessa rcKey) --- */
  if(cfg.ricevute){
    const visti=new Set();
    for(const r of ricevute){
      if(!r.ricAtl||!r.ricTs||r.archiviatoIl||t0-r.ricTs>RECENTI)continue;
      const k='rc:'+(r.rcKey||r.id);if(visti.has(k))continue;visti.add(k);
      const rv=rubrica[r.ricAtl],h=hOf(rv);if(!h)continue;
      const nome=(r.nome||'').trim(),fam=!!h&&(gOf(rv)||conta[h]>1);
      const imp=typeof r.importo==='number'?' di '+euro(r.importo):'',cau=r.causale?' ('+r.causale+')':'';
      out.push({key:k,tipo:'ricevuta',peer:h,when:null,
        text:`Ciao${fam?'':nome?' '+nome:''}, è stata caricata${fam?' per '+(nomi[r.ricAtl]||nome||'l’atleta'):''} una ricevuta di pagamento${imp}${cau}${isD(r.ricData)?' del '+fmtD(r.ricData):''}. La trovi nell’app, in «Le mie ricevute»: ${url}${FIRMA}`})}}
  /* --- esito delle richieste (dati, file, medaglie, test): all'atleta, un messaggio per ogni gruppo di decisioni --- */
  if(cfg.esiti){
    const per={};
    for(const e of esiti){if(e.kind!=='esito'||!e.sogg||!e.ts||t0-e.ts>RECENTI)continue;(per[e.sogg]=per[e.sogg]||[]).push(e)}
    for(const [sid,L] of Object.entries(per)){
      const rv=rubrica[sid],h=hOf(rv);if(!h)continue;
      const at=atleti.find(a=>a.id===sid),nome=((at&&at.nome)||'').trim(),fam=!!h&&(gOf(rv)||conta[h]>1);
      L.sort((a,b)=>a.ts-b.ts);
      const righe=L.slice(0,10).map(e=>{const acc=e.esito==='accettato',cosa=e.campo||(e.file?'file '+e.file:'')||'richiesta';return (acc?'✅ ':'❌ ')+cosa+(acc?' accettato':' rifiutato')});
      out.push({key:'es:'+sid+':'+hash(L.map(e=>e.id||e.ts).join(',')),tipo:'esito',peer:h,when:null,
        text:`Ciao${fam?'':nome?' '+nome:''}, l’admin ha esaminato ${fam?'le richieste di '+(nomi[sid]||nome||'un atleta'):'le tue richieste'}:\n${righe.join('\n')}${L.length>10?'\n… e altre '+(L.length-10):''}\nI dettagli sono nell’app: ${url}${FIRMA}`})}}
  return out}

/* Confronto con il registro: reg = {base, voci:{chiave:{k:'sched'|'now'|'ev',t,id,p,fail}}} */
export function confronta(D,reg,now=Date.now(),solo=null){
  const voci=(reg&&reg.voci)||{},ok=x=>!solo||solo.includes(x.tipo);
  const chiavi=new Set(D.map(x=>x.key));
  const nuovi=D.filter(x=>ok(x)&&(!voci[x.key]||(voci[x.key].fail&&now-voci[x.key].fail>RITENTA)));
  const annulla=solo?[]:Object.entries(voci).filter(([k,v])=>!chiavi.has(k)&&v.k==='sched'&&v.id&&v.t>now+60e3).map(([key,voce])=>({key,voce}));
  return {nuovi,annulla,gia:D.filter(x=>voci[x.key]&&!voci[x.key].fail).length}}
