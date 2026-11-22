/* Eventi → eliminazione dell'evento: i bonifici (interni ed esterni) e un elenco degli iscritti passano in ARCHIVIO per 10 anni (obbligo A.S.D.),
   e gli account con accesso a Commercialista ricevono una notifica (mail dal Gmail dell'ASD + avviso nella Home).
   I file vanno nella raccolta sections/commercialista/items con i campi di conservazione (archiviatoIl, conservaFino…), così compaiono in Archivio, tipologia «Eventi»,
   a chiunque abbia la lettura su Commercialista. Ogni file porta evEli (id dell'evento) ed evArch (chiave): un secondo tentativo non crea doppioni.
   Va eseguito PRIMA di cancellare iscrizioni e bonifici: se qualcosa non riesce, l'evento non viene eliminato. */
import {collection as fcol,getDocs as fget,query,where} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {Timestamp} from "./fsx.js";
import {archivio} from "./archivio.js";
import {oggiISO,addMesi,ANNI} from "./conservazione.js";
import {guessMime} from "./file-tools.js";
import {calcola,couponTxt,euroTxt,fmtData,nomeP,ruoloTxt,isTec,num,quotaRuolo} from "./eventi-esterni-core.js";

const sicuro=s=>String(s||'').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
const ext=n=>{const m=/\.[A-Za-z0-9]{1,5}$/.exec(String(n||''));return m?m[0].toLowerCase():''};
const eur=n=>(+n||0).toFixed(2).replace('.',',');
const RX_MAIL=/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const b64=blob=>new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>ko(new Error('Lettura del file non riuscita.'));r.readAsDataURL(blob)});

/* importo dovuto di un'iscrizione esterna: con un limite di utilizzi il coupon vale per le prime iscrizioni arrivate (come nell'elenco dell'admin) */
export function dovutoReg(ev,r,regs,cps){
  const c=cps.find(x=>x.codice===r.coupon)||null;
  let cp=null,oltre=false;
  if(c){
    oltre=num(c.max)>0&&regs.filter(x=>x.coupon===c.codice).sort((a,b)=>(a.ts||0)-(b.ts||0)).findIndex(x=>x.id===r.id)>=num(c.max);
    if(!oltre)cp={...c,attivo:true}}
  return {...calcola(ev,r.persone||[],cp,r.ts||Date.now()),coupon:c,oltre}}

/* copia della prova di pagamento (a blocchi, come sono salvate nelle iscrizioni) */
async function bonificoBlob(db,coll,rid,f){
  const s=await fget(fcol(db,coll,rid,'chunks')),
    parts=s.docs.map(d=>d.data()).filter(x=>x.f===f.id).sort((a,b)=>a.i-b.i).map(x=>x.data.toUint8Array());
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(f.nome,f.mime)})}

/* ---------- elenco degli iscritti (CSV, separatore «;», si apre con Excel) ---------- */
function costruisciElenco(ev,{interni,regs,cps,chk,catL}){
  const R=[],riga=(...c)=>R.push(c),vuota=()=>R.push([]);
  const ext_=regs.map(r=>({r,d:dovutoReg(ev,r,regs,cps)}));
  const nI=interni.length,pI=interni.reduce((t,x)=>t+x.persE,0),totI=interni.reduce((t,x)=>t+x.tot,0),verI=interni.filter(x=>x.verificato).reduce((t,x)=>t+x.tot,0);
  const pe=regs.flatMap(r=>r.persone||[]),nA=pe.filter(p=>!isTec(p)).length,nT=pe.length-nA,
    lordoE=ext_.reduce((t,x)=>t+x.d.lordo,0),scE=ext_.reduce((t,x)=>t+x.d.sconto,0),totE=ext_.reduce((t,x)=>t+x.d.totale,0),
    totC=ext_.filter(x=>x.r.stato==='confermata').reduce((t,x)=>t+x.d.totale,0);
  riga('EVENTO',ev.nome||'');riga('Categoria',catL(ev));riga('Data evento',fmtData(ev.data));riga('Elenco generato il (eliminazione evento)',fmtData(oggiISO()));
  riga('Quota evento (€)',eur(num(ev.quota)),'Quota tecnici esterni (€)',String(ev.quotaTecnico??'').trim()===''?'come gli atleti':eur(num(ev.quotaTecnico)));
  vuota();
  riga('RIEPILOGO','Iscritti / associazioni','Persone','di cui atleti','di cui tecnici','Totale dovuto (€)','Incassato / verificato (€)','Sconti coupon (€)');
  riga('Interni',nI,pI,pI,0,eur(totI),eur(verI),'');
  riga('Esterni',regs.length+' associazioni',pe.length,nA,nT,eur(totE),eur(totC),eur(scE));
  riga('TOTALE','',pI+pe.length,pI+nA,nT,eur(totI+totE),eur(verI+totC),eur(scE));
  vuota();
  riga('ISCRITTI INTERNI');
  riga('Nome','Peso (kg)','Persone all’evento','Persone in hotel','Quota evento (€)','Quota hotel (€)','Totale dovuto (€)','Bonifico','Pagamento verificato');
  interni.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'it')).forEach(x=>riga(x.nome,x.peso,x.persE,x.persH,eur(x.e),eur(x.h),eur(x.tot),x.bonifici.map(f=>f.nome).join(' + ')||'nessuno',x.verificato?'Sì':'No'));
  if(!interni.length)riga('(nessuno)');
  vuota();
  riga('ISCRITTI ESTERNI');
  riga('Associazione','Mail','Referente','Ruolo','Cognome','Nome','Peso (kg)','Quota (€)','Coupon','Codice','Ingresso registrato');
  ext_.forEach(({r,d})=>(r.persone||[]).slice().sort((a,b)=>(isTec(a)-isTec(b))||nomeP(a).localeCompare(nomeP(b),'it')).forEach(p=>
    riga(r.assoc||'',r.email||'',r.referente||'',ruoloTxt(p.ruolo),p.cognome||'',p.nome||'',p.peso||'',eur(quotaRuolo(ev,p.ruolo)),r.coupon||'',p.codice||'',p.codice&&chk.has(p.codice)?'Sì':(p.codice?'No':''))));
  if(!regs.length)riga('(nessuno)');
  vuota();
  riga('ESTERNI – TOTALI PER ASSOCIAZIONE');
  riga('Associazione','Atleti','Tecnici','Importo lordo (€)','Coupon','Sconto (€)','Totale dovuto (€)','Iscrizione','Bonifici allegati');
  ext_.forEach(({r,d})=>riga(r.assoc||'',d.atl,d.tec,eur(d.lordo),r.coupon?r.coupon+(d.oltre?' (oltre il limite: non applicato)':d.coupon?'':' (non trovato)'):'',eur(d.sconto),eur(d.totale),r.stato==='confermata'?'Confermata':'In attesa',(r.bonifici||[]).length));
  vuota();
  riga('UTILIZZO COUPON');
  riga('Codice','Tipo','Limite utilizzi','Utilizzi (iscrizioni)','Sconto totale (€)','Associazioni');
  cps.forEach(c=>{const u=ext_.filter(x=>x.r.coupon===c.codice);riga(c.codice,couponTxt(c),num(c.max)>0?num(c.max):'illimitati',u.length,eur(u.reduce((t,x)=>t+x.d.sconto,0)),u.map(x=>x.r.assoc).join(' + '))});
  if(!cps.length)riga('(nessun coupon)');
  const testo='\ufeff'+R.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
  return {testo,sommario:{nI,pI,totI,nE:regs.length,pE:pe.length,nA,nT,totE,scE,tot:totI+totE,coupon:cps.map(c=>({codice:c.codice,tipo:couponTxt(c),usi:ext_.filter(x=>x.r.coupon===c.codice).length,max:num(c.max)}))}}}

/* ---------- archiviazione + notifica ---------- */
/* interni = [{r,nome,peso,persE,persH,e,h,tot,verificato,bonifici:[meta]}] (preparato da eventi.js, che conosce le sue quote); utenti = account (solo l'admin li legge) */
export async function archiviaEvento(db,ev,{uid,interni=[],utenti=[],catL=()=>'' ,say=()=>{}}){
  const q=c=>query(fcol(db,c),where('evento','==',ev.id)),
    [rg,cp,ck]=await Promise.all([fget(q('iscrizioniEsterne')),fget(q('eventiCoupon')),fget(q('eventiCheckin'))]),
    regs=rg.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.ts||0)-(b.ts||0)),cps=cp.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.ts||0)-(b.ts||0)),chk=new Map(ck.docs.map(d=>[d.data().codice,1]));
  const nBon=interni.reduce((t,x)=>t+x.bonifici.length,0)+regs.reduce((t,r)=>t+(r.bonifici||[]).length,0);
  if(!interni.length&&!regs.length)return {archiviati:0,vuoto:true,notifica:{inviate:0,ko:0,nota:''}};
  const arch=archivio(db,'commercialista',uid);
  if(arch.needsTelegram())throw new Error('Per archiviare serve il collegamento a Telegram: apri le impostazioni di Telegram e accedi, poi riprova.');
  const gia=new Set((await fget(query(fcol(db,'sections','commercialista','items'),where('evEli','==',ev.id)))).docs.map(d=>d.data().evArch));
  const oggi=oggiISO(),fino=addMesi(oggi,12*ANNI),{testo,sommario:S}=costruisciElenco(ev,{interni,regs,cps,chk,catL}),nome=sicuro(ev.nome)||'evento';
  const base={fb:true,tipo:'Eventi',archiviatoIl:oggi,conservaFino:fino,conservaFinoTs:Timestamp.fromDate(new Date(fino+'T23:59:59')),evEli:ev.id,daEvento:true,
    storico:[oggi+': archiviato (evento «'+ev.nome+'» eliminato), da conservare fino al '+fino.split('-').reverse().join('/')]};
  let n=0,tot=1+nBon;
  const salva=async(chiave,blob,titolo,origine,note)=>{
    if(gia.has(chiave)){n++;return}
    say('Archiviazione '+(n+1)+' di '+tot+'…');
    await arch.save(new File([blob],titolo,{type:blob.type||'application/octet-stream'}),{...base,evArch:chiave,origine,note});n++};
  /* 1) l'elenco degli iscritti */
  const csvBlob=new Blob([testo],{type:'text/csv;charset=utf-8'});
  await salva(ev.id+':elenco',csvBlob,'Elenco iscritti - '+nome+'.csv','Eventi / '+ev.nome,
    ev.nome+' · '+S.nI+' interni e '+S.pE+' esterni ('+S.nE+' associazioni) · totale dovuto '+euroTxt(S.tot));
  /* 2) i bonifici degli iscritti interni e delle associazioni esterne */
  for(const x of interni)for(const [k,f] of x.bonifici.entries()){
    const bl=await bonificoBlob(db,'iscrizioni',x.r.id,f);
    await salva(ev.id+':i:'+x.r.id+':'+f.id,bl,'Bonifico interno - '+sicuro(x.nome)+' - '+nome+(x.bonifici.length>1?' ('+(k+1)+')':'')+(ext(f.nome)||'.bin'),'Eventi / '+ev.nome+' / Bonifici interni',ev.nome+' · '+x.nome+' · '+euroTxt(x.tot))}
  for(const r of regs)for(const [k,f] of (r.bonifici||[]).entries()){
    const bl=await bonificoBlob(db,'iscrizioniEsterne',r.id,f),d=dovutoReg(ev,r,regs,cps);
    await salva(ev.id+':e:'+r.id+':'+f.id,bl,'Bonifico esterno - '+sicuro(r.assoc)+' - '+nome+((r.bonifici||[]).length>1?' ('+(k+1)+')':'')+(ext(f.nome)||'.bin'),'Eventi / '+ev.nome+' / Bonifici esterni',ev.nome+' · '+(r.assoc||'')+' · '+euroTxt(d.totale)+(r.coupon?' · coupon '+r.coupon:''))}
  /* 3) notifica a chi ha accesso a Commercialista */
  const notifica=await avvisa(db,ev,{utenti,uid,S,csvBlob,nomeFile:'Elenco iscritti - '+nome+'.csv',nBon});
  return {archiviati:n,notifica,riepilogo:S}}

async function avvisa(db,ev,{utenti,uid,S,csvBlob,nomeFile,nBon}){
  const dest=[...new Set(utenti.filter(u=>!u.admin&&u.id!==uid&&['r','w'].includes((u.perms||{}).commercialista)).map(u=>String(u.email||'').trim().toLowerCase()).filter(e=>RX_MAIL.test(e)))];
  if(!dest.length)return {inviate:0,ko:0,nota:'Nessun altro account ha accesso a Commercialista (o manca la sua mail): i file sono in Archivio, nessuna mail inviata.'};
  let m;try{m=await import('./notifiche-motore.js')}catch(e){return {inviate:0,ko:dest.length,nota:'Mail non disponibile.'}}
  if(!(await m.mailPronta()))return {inviate:0,ko:dest.length,nota:'La Mail non è collegata (mail-config.js): i file sono in Archivio ma la notifica non è partita.'};
  const cup=S.coupon.length?S.coupon.map(c=>'• '+c.codice+' ('+c.tipo+'): usato '+c.usi+(c.max>0?' su '+c.max:'')+(c.usi===1?' volta':' volte')).join('\n'):'• nessun coupon';
  const text=`Buongiorno,

l’evento «${ev.nome}»${ev.data?' ('+fmtData(ev.data)+')':''} è stato eliminato dalla suite e i suoi documenti contabili sono stati archiviati per 10 anni.

In Archivio (tipologia «Eventi») trovi:
• l’elenco degli iscritti, diviso tra interni ed esterni, con quote e utilizzo dei coupon (allegato anche a questa mail);
• ${nBon} ${nBon===1?'copia di bonifico':'copie dei bonifici'} (interni ed esterni).

RIEPILOGO
• Iscritti interni: ${S.nI} (${S.pI} ${S.pI===1?'persona':'persone'}) · dovuto ${euroTxt(S.totI)}
• Esterni: ${S.nE} ${S.nE===1?'associazione':'associazioni'}, ${S.nA} atleti e ${S.nT} tecnici · dovuto ${euroTxt(S.totE)} (sconti coupon ${euroTxt(S.scE)})
• Totale dovuto: ${euroTxt(S.tot)}

COUPON
${cup}

— Yanagi Academy`;
  const files=[{name:nomeFile,type:'text/csv',data:await b64(csvBlob)}];
  let inviate=0,ko=0;
  for(const to of dest){
    try{const es=await m.inviaDiretta(db,{key:'evarch:'+ev.id+':'+to+':'+Date.now(),to,subject:'Archivio: bonifici ed elenco iscritti di «'+ev.nome+'»',text,files});es.ok?inviate++:ko++}
    catch(e){console.error(e);ko++}}
  return {inviate,ko,nota:ko?ko+' mail non partite.':''}}
