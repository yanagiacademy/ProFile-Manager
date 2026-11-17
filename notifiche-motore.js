/* Notifiche via MAIL – motore (solo admin): legge i dati, calcola con notifiche-core.js, spedisce o mette in coda le mail dal Gmail dell'ASD
   (ponte Apps Script, vedi ponte-mail.gs) e tiene un registro di ciò che è già stato fatto (sezione cifrata "notifiche": mail-config, mail-registro).
   I promemoria sono mail IN CODA sul ponte: le spedisce Apps Script all'ora giusta anche con la suite chiusa.
   Gli indirizzi degli atleti sono quelli della scheda Atleti (raccolta atletiMail, leggibile solo dall'admin).
   Questo file sostituisce il vecchio motore Telegram: le funzioni usate dalle pagine (sincronizza, notificaSubito, autoSincronizza) hanno gli stessi nomi. */
import {doc,collection,getDoc,getDocs,setDoc,caricaDati,logEvento} from "./fsx.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {hasSession,tgConfigured} from "./telegram.js";
import {costruisci,confronta,cfgOk,CFG0} from "./notifiche-core.js";
export {cfgOk,CFG0};

const S='notifiche';
const rec=(db,id)=>doc(db,'sections',S,'items',id);
async function leggi(db,id){try{const s=await getDoc(rec(db,id));return s.exists()?s.data():{}}catch(e){return {}}}
const lista=async(db,sec)=>(await getDocs(collection(db,'sections',sec,'items'))).docs.map(d=>({id:d.id,...d.data()}));
const pausa=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- impostazioni ---------- */
/* Di default NIENTE parte da solo: l'admin attiva ciò che vuole dalla scheda Mail → Notifiche. */
export const CFGM0={atleti:false,admin:false,ricevute:false,esiti:false,eventiAuto:false,giorni:[30,7,1],ora:9,indirizziAdmin:[]};
const RX=/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export function listaMail(v){
  const t=Array.isArray(v)?v.join(' '):String(v||'');
  return [...new Set(t.split(/[\s,;]+/).map(s=>s.trim().toLowerCase()).filter(s=>RX.test(s)))]}
export function cfgMail(c){
  const b={...CFGM0,...(c||{})};
  const o=cfgOk({atleti:!!b.atleti,admin:!!b.admin,ricevute:!!b.ricevute,esiti:!!b.esiti,eventi:!!b.eventiAuto,giorni:b.giorni,ora:b.ora});
  o.eventiAuto=o.eventi;o.indirizziAdmin=listaMail(b.indirizziAdmin);return o}
export const leggiConfig=async db=>cfgMail(await leggi(db,'mail-config'));
export const salvaConfig=(db,c)=>setDoc(rec(db,'mail-config'),{...cfgMail(c),kind:'config',title:'Configurazione notifiche via mail'});
export async function leggiRegistro(db){const r=await leggi(db,'mail-registro');return {base:r.base||0,ult:r.ult||0,voci:{...(r.voci||{})}}}
const salvaRegistro=(db,reg)=>setDoc(rec(db,'mail-registro'),{base:reg.base,ult:reg.ult,voci:reg.voci,kind:'registro',title:'Registro notifiche via mail'});

/* ---------- ponte Apps Script ---------- */
export async function mailPronta(){try{const {MAIL_URL}=await import('./mail-config.js');return !!MAIL_URL&&MAIL_URL!=='INSERISCI'}catch(e){return false}}
async function ponte(db,a,p={}){
  let URL_;try{URL_=(await import('./mail-config.js')).MAIL_URL}catch(e){URL_=''}
  if(!URL_||URL_==='INSERISCI')throw new Error('La Mail non è ancora collegata: compila mail-config.js con l’indirizzo dell’app web di Apps Script (vedi ponte-mail.gs).');
  const au=getAuth(db.app);if(!au.currentUser)throw new Error('Accesso scaduto: rifai il login nella suite.');
  const t=await au.currentUser.getIdToken();
  let r;try{r=await fetch(URL_,{method:'POST',body:JSON.stringify({t,a,...p}),redirect:'follow'})}
  catch(e){throw new Error('Impossibile contattare il servizio Mail. Controlla la connessione e l’indirizzo in mail-config.js.')}
  let j;try{j=await r.json()}catch(e){throw new Error('Risposta non valida dal servizio Mail: controlla la distribuzione dello script (ponte-mail.gs aggiornato?).')}
  if(!j.ok)throw new Error(j.e||'Errore del servizio Mail');
  return j}
/* a blocchi: se un blocco fallisce (rete, script non aggiornato) i restanti risultano non inviati */
async function blocchi(db,items,az,n){
  const out=[];
  for(let i=0;i<items.length;i+=n){
    const parte=items.slice(i,i+n);
    try{const r=await ponte(db,az,{items:parte});const m=new Map((r.esiti||[]).map(e=>[e.key,e]));parte.forEach(v=>out.push(m.get(v.key)||{key:v.key,ok:false,e:'nessuna risposta'}))}
    catch(e){items.slice(i).forEach(v=>out.push({key:v.key,ok:false,e:e.message}));break}
    if(i+n<items.length)await pausa(300)}
  return out}
export async function statoMail(db){return await ponte(db,'n-stato')}

/* ---------- dati ---------- */
const nomeAt=a=>((a.cognome||'')+' '+(a.nome||'')).trim()||a.title||'atleta';
const DATI_KO='Per leggere atleti ed eventi serve l’accesso a Telegram in questo browser (pagina Chat): i dati dell’app stanno lì. Le notifiche, invece, partono per mail.';
const prontoDati=()=>tgConfigured()&&hasSession();
async function leggiMails(db){
  const sn=await getDocs(collection(db,'atletiMail')),m={};
  sn.docs.forEach(d=>{const e=String((d.data()||{}).email||'').trim().toLowerCase();if(RX.test(e))m[d.id]=e});return m}
export const leggiRubrica=leggiMails;                          /* {idAtleta: email} */
export async function elencoEventi(db){
  if(!prontoDati())throw new Error(DATI_KO);await caricaDati();
  return (await lista(db,'eventi')).filter(e=>e.kind==='evento').sort((a,b)=>String(a.data||'').localeCompare(String(b.data||'')))}
export async function elencoAtleti(db){
  if(!prontoDati())throw new Error(DATI_KO);await caricaDati();
  const [atleti,mails]=await Promise.all([lista(db,'atleti'),leggiMails(db)]);
  return atleti.filter(a=>mails[a.id]&&(!a.kind||a.kind==='atleta')).map(a=>({id:a.id,nome:nomeAt(a),email:mails[a.id]})).sort((a,b)=>a.nome.localeCompare(b.nome,'it'))}

/* ---------- oggetto delle mail ---------- */
function oggetto(x){
  const prima=String(x.text||'').split('\n')[0].replace(/^[^\p{L}\p{N}]+/u,'').trim();
  if(x.tipo==='evento')return prima||'Nuovo evento';
  if(x.tipo==='admin')return prima||'Scadenze';
  if(x.tipo==='atleta')return String(x.key).includes(':certScad:')?'Promemoria: certificato medico in scadenza':'Promemoria: tessera in scadenza';
  if(x.tipo==='ricevuta')return 'Nuova ricevuta di pagamento';
  if(x.tipo==='esito')return 'Esito delle tue richieste';
  return 'Yanagi Academy'}

/* ---------- invio di un evento scelto dall'admin ---------- */
export async function inviaEvento(db,ev,{a,oggetto:og,testo}){
  const rec_=listaMail(a);if(!rec_.length)throw new Error('Nessun destinatario valido.');
  if(!String(testo||'').trim())throw new Error('Il testo è vuoto.');
  const now=Date.now(),key='evm:'+ev.id+':'+now,sub=(og||'').trim()||('Evento: '+(ev.nome||ev.title||'senza nome'));
  const es=await blocchi(db,rec_.map(to=>({key:key+'|'+to,to,subject:sub,text:testo})),'n-invia',20);
  const ok=es.filter(e=>e.ok).length,ko=es.filter(e=>!e.ok);
  if(ok){const reg=await leggiRegistro(db);reg.voci[key]={k:'ev',t:now,n:ok,ev:ev.id};await salvaRegistro(db,{...reg,ult:now}).catch(e=>console.error('Registro notifiche non salvato',e))}
  logEvento('notifica','eventi',ev.id,'Evento inviato per mail: '+(ev.nome||ev.title||''),ok+' inviate'+(ko.length?', '+ko.length+' errori':''));
  return {ok,ko:ko.length,dettagli:ko.map(e=>String(e.key).split('|').pop()+': '+e.e)}}
export async function provaMail(db,indirizzi){
  const a=listaMail(indirizzi);if(!a.length)throw new Error('Indica almeno un indirizzo valido.');
  const es=await blocchi(db,a.map(to=>({key:'prova|'+to,to,subject:'Prova notifiche ProFile Manager',text:'✅ Se leggi questa mail, l’invio delle notifiche dal Gmail dell’ASD funziona.\n— Yanagi Academy'})),'n-invia',10);
  return {ok:es.filter(e=>e.ok).length,dettagli:es.filter(e=>!e.ok).map(e=>String(e.key).split('|').pop()+': '+e.e)}}

/* ---------- sincronizzazione ---------- */
/* anteprima=true: calcola e basta. solo: ['ricevuta'] ecc. per limitarsi ad alcuni tipi. */
export async function sincronizza(db,{log=()=>{},solo=null,anteprima=false}={}){
  const R={programmate:0,inviati:0,annullate:0,errori:0,gia:0,note:[],dettagli:[]};
  if(!(await mailPronta())){R.errore='La Mail non è ancora collegata: compila mail-config.js (vedi ponte-mail.gs).';return R}
  if(!prontoDati()){R.errore=DATI_KO;return R}
  await caricaDati();
  const cfg=await leggiConfig(db),rubrica=await leggiRubrica(db),reg=await leggiRegistro(db);
  const [atleti,tessere,documenti,eventi]=await Promise.all(['atleti','tessere','documenti','eventi'].map(s=>lista(db,s)));
  const [ricevute,esiti]=await Promise.all(['ricevute','richieste'].map(s=>lista(db,s).catch(()=>[])));
  const now=Date.now();
  let D=costruisci({atleti,tessere,documenti,eventi,ricevute,esiti,rubrica,cfg,now:new Date(now),url:new URL('index.html',location.href).href});
  const dest=x=>x.tipo==='admin'?cfg.indirizziAdmin:(x.peers||(x.peer?[x.peer]:[]));
  if(cfg.admin&&!cfg.indirizziAdmin.length){R.note.push('Riepilogo scadenze: indica gli indirizzi dell’admin per riceverlo.');D=D.filter(x=>x.tipo!=='admin')}
  let primo=false;
  if(!reg.base){primo=true;reg.base=now;D.filter(x=>x.tipo==='evento').forEach(x=>{reg.voci[x.key]={k:'ev',t:now}});if(cfg.eventiAuto)R.note.push('Primo avvio: gli eventi già esistenti non vengono inviati, solo quelli creati da ora.')}
  const {nuovi,annulla,gia}=confronta(D,reg,now,solo);R.gia=gia;
  if(anteprima){R.nuovi=nuovi;R.annulla=annulla;return R}
  if(!nuovi.length&&!annulla.length){if(primo)await salvaRegistro(db,{...reg,ult:now});return R}
  try{
    /* mail in coda da togliere (la data o il destinatario è cambiato) */
    const keys=annulla.flatMap(a=>a.voce.qk||[]);
    let annOk=true;
    if(keys.length){try{await ponte(db,'n-annulla',{keys})}catch(e){annOk=false;R.errori++;R.dettagli.push('Annullamento: '+e.message);log('✗ annullamento: '+e.message)}}
    for(const {key,voce} of annulla){if(annOk||!(voce.qk||[]).length){delete reg.voci[key];R.annullate++}}
    /* da inviare: subito o in coda */
    const imm=[],sch=[],per=new Map();
    for(const x of nuovi){
      const a=listaMail(dest(x));
      if(!a.length){if(x.tipo==='evento')R.note.push('Nuovo evento senza atleti con e-mail: nessuna mail.');continue}
      const sub=oggetto(x),ks=a.map(to=>x.key+'|'+to);per.set(x.key,{x,ks});
      a.forEach((to,i)=>(x.when?sch:imm).push({key:ks[i],to,subject:sub,text:x.text,at:x.when||undefined}))}
    const es=new Map();
    for(const e of await blocchi(db,imm,'n-invia',20))es.set(e.key,e);
    for(const e of await blocchi(db,sch,'n-programma',40))es.set(e.key,e);
    for(const [k,{x,ks}] of per){
      const res=ks.map(q=>es.get(q)||{key:q,ok:false,e:'nessuna risposta'}),ok=res.filter(r=>r.ok),ko=res.filter(r=>!r.ok);
      if(ok.length){
        if(x.when){reg.voci[k]={k:'sched',t:x.when,id:1,p:'mail',qk:ok.map(r=>r.key)};R.programmate+=ok.length}
        else{reg.voci[k]=x.tipo==='evento'?{k:'ev',t:now}:{k:'now',t:now,p:'mail'};R.inviati+=ok.length}}
      else reg.voci[k]={fail:now};
      ko.forEach(r=>{R.errori++;const m=String(r.key).split('|').pop()+': '+r.e;R.dettagli.push(m);log('✗ '+m)})}
  }finally{
    for(const [k,v] of Object.entries(reg.voci)){if((v.t&&v.t<now-400*864e5)||(v.fail&&v.fail<now-30*864e5))delete reg.voci[k]}
    try{await salvaRegistro(db,{...reg,ult:now})}catch(e){console.error('Registro notifiche non salvato',e)}}
  if(R.dettagli.some(d=>/limite giornaliero/.test(d)))R.note.push('Gmail ha raggiunto il limite giornaliero di invii: le mail non partite si ritentano domani.');
  if(R.programmate||R.inviati||R.annullate||R.errori)logEvento('notifica','','','Notifiche via mail',R.programmate+' in coda, '+R.inviati+' inviate, '+R.annullate+' annullate'+(R.errori?', '+R.errori+' errori':''));
  return R}

/* Riassunto di ciò che è in coda (dal registro) */
export async function riepilogoProgrammate(db){
  const reg=await leggiRegistro(db),now=Date.now();let atleti=0,admin=0,eventi=0,prossima=0;
  for(const [k,v] of Object.entries(reg.voci)){
    if(v.k==='sched'&&v.t>now){if(k.startsWith('ad:'))admin++;else atleti++;prossima=prossima?Math.min(prossima,v.t):v.t}
    if(v.k==='ev')eventi++}
  return {atleti,admin,eventi,prossima,ult:reg.ult}}

/* Subito, solo per alcuni tipi (['ricevuta'] dopo il caricamento di una ricevuta, ['esito'] dopo le decisioni sulle richieste). Solo admin. */
export async function notificaSubito(db,tipi){
  try{
    if(!(await mailPronta())||!prontoDati())return null;
    const cfg=await leggiConfig(db);
    if(!((tipi.includes('ricevuta')&&cfg.ricevute)||(tipi.includes('esito')&&cfg.esiti)))return null;
    return await sincronizza(db,{solo:tipi})
  }catch(e){console.warn('Notifiche immediate:',e&&e.message);return null}}

/* Per la Home (admin): sincronizzazione completa ogni 10 ore al massimo, in silenzio; nel frattempo, al massimo ogni 30 minuti, solo ricevute ed esiti nuovi.
   Non fa nulla se la Mail non è collegata o se è tutto disattivato. */
export async function autoSincronizza(db){
  try{
    if(!(await mailPronta())||!prontoDati())return null;
    const now=Date.now(),ts=Number(localStorage.getItem('pfm_mail_ts')||0);
    if(now-ts>=10*3600e3){
      const cfg=await leggiConfig(db);if(!cfg.eventi&&!cfg.atleti&&!cfg.admin&&!cfg.ricevute&&!cfg.esiti)return null;
      localStorage.setItem('pfm_mail_ts',String(now));
      return await sincronizza(db)}
    const t2=Number(localStorage.getItem('pfm_mail_ts2')||0);if(now-t2<30*60e3)return null;
    localStorage.setItem('pfm_mail_ts2',String(now));
    return await notificaSubito(db,['ricevuta','esito'])
  }catch(e){console.warn('Notifiche automatiche:',e&&e.message);return null}}
