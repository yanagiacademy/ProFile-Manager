/* Notifiche Telegram – motore (solo admin): legge i dati, calcola con notifiche-core.js, programma/invia/annulla messaggi con l'account Telegram
   collegato in questo browser e tiene un registro di ciò che è già stato fatto (sezione cifrata "notifiche": config, rubrica, registro).
   I promemoria sono messaggi PROGRAMMATI su Telegram: li consegna Telegram all'ora giusta anche con l'app chiusa. */
import {doc,collection,getDoc,getDocs,setDoc,caricaDati,logEvento} from "./fsx.js";
import {tgClient,hasSession,tgConfigured} from "./telegram.js";
import {costruisci,confronta,cfgOk,parseHandle,CFG0} from "./notifiche-core.js";
export {parseHandle,cfgOk,CFG0};

const S='notifiche';
const rec=(db,id)=>doc(db,'sections',S,'items',id);
async function leggi(db,id){try{const s=await getDoc(rec(db,id));return s.exists()?s.data():{}}catch(e){return {}}}
export const leggiConfig=async db=>cfgOk(await leggi(db,'config'));
export const salvaConfig=(db,c)=>setDoc(rec(db,'config'),{...cfgOk(c),kind:'config',title:'Configurazione notifiche'});
export const leggiRubrica=async db=>({...(((await leggi(db,'rubrica')).map)||{})});
export const salvaRubrica=(db,map)=>setDoc(rec(db,'rubrica'),{map,kind:'rubrica',title:'Telegram degli atleti'});
export async function leggiRegistro(db){const r=await leggi(db,'registro');return {base:r.base||0,ult:r.ult||0,voci:{...(r.voci||{})}}}
const salvaRegistro=(db,reg)=>setDoc(rec(db,'registro'),{base:reg.base,ult:reg.ult,voci:reg.voci,kind:'registro',title:'Registro notifiche'});
const lista=async(db,sec)=>(await getDocs(collection(db,'sections',sec,'items'))).docs.map(d=>({id:d.id,...d.data()}));

/* Spiega in italiano gli errori di Telegram più comuni */
export function erroreTg(e){
  const m=String((e&&e.message)||e||'');
  if(/USERNAME_NOT_OCCUPIED|USERNAME_INVALID|Cannot find any entity|No user has/i.test(m))return 'nome utente Telegram non trovato';
  if(/USER_PRIVACY_RESTRICTED|PRIVACY/i.test(m))return 'le impostazioni di privacy non permettono di scrivergli';
  if(/PEER_FLOOD/.test(m))return 'Telegram ha limitato l’invio ai nuovi contatti (riprova tra qualche ora)';
  const f=m.match(/FLOOD_WAIT_(\d+)|wait of (\d+) seconds/i);if(f)return 'Telegram chiede di attendere '+(f[1]||f[2])+' secondi';
  if(/SCHEDULE_TOO_MUCH|SCHEDULE_DATE_TOO_LATE/.test(m))return 'troppi messaggi programmati in questa chat (limite di Telegram)';
  if(/SCHEDULE_DATE_INVALID/.test(m))return 'data di programmazione non valida';
  if(/MESSAGE_ID_INVALID/.test(m))return 'messaggio programmato non trovato (già consegnato o cancellato)';
  return m.slice(0,140)||'errore sconosciuto'}
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
const prontoTg=()=>tgConfigured()&&hasSession();

/* Messaggio di prova immediato nei "Messaggi salvati" dell'account Telegram collegato */
export async function provaMessaggio(){
  if(!prontoTg())throw new Error('Telegram non è collegato in questo browser: accedi dalla pagina Chat.');
  const {client}=await tgClient();await client.sendMessage('me',{message:'✅ Prova notifiche ProFile Manager: se leggi questo messaggio, l’invio funziona.'});return true}
/* Messaggio PROGRAMMATO fra qualche minuto: serve a verificare che i promemoria arrivino a app chiusa */
export async function provaProgrammata(minuti=2){
  if(!prontoTg())throw new Error('Telegram non è collegato in questo browser: accedi dalla pagina Chat.');
  const {client}=await tgClient(),when=Date.now()+minuti*60e3;
  const m=await client.sendMessage('me',{message:'⏰ Prova di promemoria programmato (ProFile Manager): se arriva alle '+new Date(when).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+' anche con l’app chiusa, i promemoria funzionano.',schedule:Math.floor(when/1000)});
  return {when,id:m&&m.id||0}}

/* anteprima=true: calcola e basta, senza inviare né scrivere nulla. solo: ['evento'] per limitarsi ai nuovi eventi. */
export async function sincronizza(db,{log=()=>{},solo=null,anteprima=false}={}){
  const R={programmate:0,inviati:0,annullate:0,errori:0,gia:0,note:[],dettagli:[]};
  if(!prontoTg()){R.errore='Telegram non è collegato in questo browser: accedi dalla pagina Chat.';return R}
  await caricaDati();
  const cfg=await leggiConfig(db),rubrica=await leggiRubrica(db),reg=await leggiRegistro(db);
  const [atleti,tessere,documenti,eventi]=await Promise.all(['atleti','tessere','documenti','eventi'].map(s=>lista(db,s)));
  /* ricevute ed esiti sono facoltativi: se non si leggono, semplicemente non ci sono messaggi di questo tipo (non si annulla nulla) */
  const [ricevute,esiti]=await Promise.all(['ricevute','richieste'].map(s=>lista(db,s).catch(()=>[])));
  const now=Date.now();
  const D=costruisci({atleti,tessere,documenti,eventi,ricevute,esiti,rubrica,cfg,now:new Date(now),url:new URL('index.html',location.href).href});
  /* primo avvio: gli eventi che esistono già non si notificano (altrimenti gli atleti riceverebbero tutto il passato) */
  let primo=false;
  if(!reg.base){primo=true;reg.base=now;D.filter(x=>x.tipo==='evento').forEach(x=>{reg.voci[x.key]={k:'ev',t:now}});R.note.push('Primo avvio: gli eventi già esistenti non vengono notificati, solo quelli creati da ora.')}
  const {nuovi,annulla,gia}=confronta(D,reg,now,solo);R.gia=gia;
  if(anteprima){R.nuovi=nuovi;R.annulla=annulla;return R}
  if(!nuovi.length&&!annulla.length){if(primo)await salvaRegistro(db,{...reg,ult:now});return R}
  const {client,tg}=await tgClient();let stop=false;const peerKo=new Set();       /* destinatari non raggiungibili in questa sincronizzazione */
  const sendTo=async(peer,opt)=>{
    try{return await client.sendMessage(peer,opt)}
    catch(e){const m=String((e&&e.message)||e),f=m.match(/FLOOD_WAIT_(\d+)/);
      if(f&&Number(f[1])<=30){await pausa((Number(f[1])+1)*1000);return await client.sendMessage(peer,opt)}
      if(/PEER_FLOOD|FLOOD_WAIT/.test(m))stop=true;
      throw e}};
  try{
    for(const {key,voce} of annulla){
      if(stop)break;
      try{const peer=await client.getInputEntity(voce.p||'me');await client.invoke(new tg.Api.messages.DeleteScheduledMessages({peer,id:[voce.id]}));delete reg.voci[key];R.annullate++}
      catch(e){const m=String((e&&e.message)||e);if(/MESSAGE_ID_INVALID/.test(m)){delete reg.voci[key]}else{R.errori++;R.dettagli.push('Annullamento: '+erroreTg(e));log('✗ annullamento: '+erroreTg(e))}}
      await pausa(400)}
    for(const x of nuovi){
      if(stop)break;
      if(x.peer&&peerKo.has(x.peer)){reg.voci[x.key]={fail:now};continue}      /* già fallito per questo atleta: riprova domani, senza ripetere l'errore */
      try{
        if(x.tipo==='evento'){
          if(!x.peers.length){R.note.push('Nuovo evento senza atleti con Telegram: nessun messaggio.');continue}
          let ok=0,ko=0;
          for(const p of x.peers){if(stop)break;try{await sendTo(p,{message:x.text});ok++;R.inviati++}catch(e){ko++;R.errori++;R.dettagli.push('@'+p+': '+erroreTg(e));log('✗ @'+p+': '+erroreTg(e))}await pausa(600)}
          if(ok>0)reg.voci[x.key]={k:'ev',t:now};else if(ko)reg.voci[x.key]={fail:now}}
        else if(x.when){
          const m=await sendTo(x.peer==='me'?'me':x.peer,{message:x.text,schedule:Math.floor(x.when/1000)});
          reg.voci[x.key]={k:'sched',t:x.when,id:(m&&m.id)||0,p:x.peer};R.programmate++;
          if(!(m&&m.id))R.note.push('Telegram non ha restituito l’id di un messaggio programmato: se la data cambia non si potrà annullare in automatico.')}
        else{await sendTo(x.peer,{message:x.text});reg.voci[x.key]={k:'now',t:now,p:x.peer};R.inviati++}
      }catch(e){R.errori++;reg.voci[x.key]={fail:now};if(x.peer)peerKo.add(x.peer);R.dettagli.push((x.peer==='me'?'admin':'@'+x.peer)+': '+erroreTg(e));log('✗ '+(x.peer==='me'?'admin':'@'+x.peer)+': '+erroreTg(e))}
      await pausa(500)}
  }finally{
    for(const [k,v] of Object.entries(reg.voci)){if((v.t&&v.t<now-400*864e5)||(v.fail&&v.fail<now-30*864e5))delete reg.voci[k]}
    try{await salvaRegistro(db,{...reg,ult:now})}catch(e){console.error('Registro notifiche non salvato',e)}}
  if(R.programmate||R.inviati||R.annullate||R.errori)logEvento('notifica','','','Notifiche Telegram',R.programmate+' programmate, '+R.inviati+' inviate, '+R.annullate+' annullate'+(R.errori?', '+R.errori+' errori':''));
  if(stop&&!R.errore)R.errore='Telegram ha limitato l’invio: il resto riprende alla prossima sincronizzazione.';
  return R}

/* Riassunto di ciò che è programmato (dal registro) */
export async function riepilogoProgrammate(db){
  const reg=await leggiRegistro(db),now=Date.now();let atleti=0,admin=0,eventi=0,prossima=0;
  for(const [k,v] of Object.entries(reg.voci)){
    if(v.k==='sched'&&v.t>now){if(k.startsWith('ad:'))admin++;else atleti++;prossima=prossima?Math.min(prossima,v.t):v.t}
    if(v.k==='ev')eventi++}
  return {atleti,admin,eventi,prossima,ult:reg.ult}}

/* Subito, solo per alcuni tipi (['ricevuta'] dopo il caricamento di una ricevuta, ['esito'] dopo le decisioni sulle richieste).
   Va chiamata da chi ha Telegram collegato e legge le notifiche (l'admin): per gli altri non fa nulla. */
export async function notificaSubito(db,tipi){
  try{
    if(!prontoTg())return null;
    if(!Object.keys(await leggiRubrica(db)).length)return null;
    const cfg=await leggiConfig(db);
    if(!((tipi.includes('ricevuta')&&cfg.ricevute)||(tipi.includes('esito')&&cfg.esiti)))return null;
    return await sincronizza(db,{solo:tipi})
  }catch(e){console.warn('Notifiche immediate:',e&&e.message);return null}}

/* Per la Home: sincronizzazione completa ogni 10 ore al massimo, in silenzio; nel frattempo, al massimo ogni 30 minuti, solo ricevute ed esiti nuovi.
   Non fa nulla se Telegram non è collegato o se è tutto disattivato. */
export async function autoSincronizza(db){
  try{
    if(!prontoTg())return null;
    const now=Date.now(),ts=Number(localStorage.getItem('pfm_notif_ts')||0);
    if(now-ts>=10*3600e3){
      const cfg=await leggiConfig(db);if(!cfg.eventi&&!cfg.atleti&&!cfg.admin&&!cfg.ricevute&&!cfg.esiti)return null;
      localStorage.setItem('pfm_notif_ts',String(now));
      return await sincronizza(db)}
    const t2=Number(localStorage.getItem('pfm_notif_ts2')||0);if(now-t2<30*60e3)return null;
    localStorage.setItem('pfm_notif_ts2',String(now));
    return await notificaSubito(db,['ricevuta','esito'])
  }catch(e){console.warn('Notifiche automatiche:',e&&e.message);return null}}
