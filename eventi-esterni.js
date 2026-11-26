/* Eventi → iscrizioni per gli ESTERNI (lato admin). Lo usa eventi.js.
   • Link pubblico: se l'evento ha «esterni» si scrive la copia pubblica eventiPubblici/<evento> (solo i dati che servono al modulo, comprese le coordinate di pagamento);
     il modulo è iscrizione.html?e=<evento>. La copia si riallinea da sola quando cambiano evento o «Come pagare» (sync).
   • Elenco: le iscrizioni arrivano in iscrizioniEsterne (stato «attesa»). L'admin controlla il bonifico e preme «Conferma ricezione»: si creano i codici (uno per iscritto),
     si salva lo stato «confermata» e si invia alla mail dell'associazione il testo con i codici + un'immagine QR per persona (dal Gmail dell'ASD, ponte-mail.gs).
   • Coupon: eventiCoupon/<evento>_<CODICE> (gratis, sconto in % o in €). L'importo dovuto si ricalcola qui con i dati veri, non si fida di quello scritto dal modulo.
   • Check-in: si scansiona il QR (fotocamera) o si scrive il codice/si cerca per nome; ogni ingresso è un documento eventiCheckin/<evento>_<codice>. */
import {collection as fcol,doc as fdoc,onSnapshot as fon,setDoc as fset,updateDoc as fupd,deleteDoc as fdel,getDocs as fget,getDoc as fgetDoc,query,where} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {showPreview,saveBlob,guessMime} from "./file-tools.js";
import {qrPng} from "./qr.js";
import {calcola,couponOk,couponEsaurito,couponTxt,couponId,normCoupon,euroTxt,fmtData,nomeP,ruoloTxt,isTec,nuovoCodice,normCodice,ALFA,num} from "./eventi-esterni-core.js";

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
const hhmm=t=>{const d=new Date(t);return isNaN(d)?'':d.toLocaleDateString('it-IT',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})};
const b64=blob=>new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>ko(new Error('Lettura del file non riuscita.'));r.readAsDataURL(blob)});
const sicuro=s=>String(s||'').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
const PERM='Se vedi questo errore, l’admin deve pubblicare le regole di Firestore aggiornate (firestore.rules).';

/* ---------- link e copia pubblica ---------- */
export const linkEsterno=id=>new URL('iscrizione.html?e='+encodeURIComponent(id),location.href).href;
export async function copiaLink(ev){
  const l=linkEsterno(ev.id);
  try{await navigator.clipboard.writeText(l);return true}catch(e){window.prompt('Copia il link:',l);return false}}
export async function condividiLink(ev){
  const l=linkEsterno(ev.id);
  if(navigator.share){try{await navigator.share({title:ev.nome,text:'Iscrizione a «'+ev.nome+'»',url:l});return}catch(e){if(e&&e.name==='AbortError')return}}
  await copiaLink(ev)}
/* le iscrizioni si chiudono a fine giornata della scadenza (o dell'evento, se non c'è scadenza) */
export function mirrorDi(ev,{cat='',pagamento='',locandina=null}={}){
  const fine=isD(ev.scadReg)?ev.scadReg:(isD(ev.data)?ev.data:'');
  return {esterni:true,nome:ev.nome||'',cat,data:ev.data||'',scadReg:ev.scadReg||'',chiudeMs:fine?new Date(fine+'T23:59:59').getTime():0,
    chiuso:!!ev.chiuso,chiusoMotivo:ev.chiuso?(ev.chiusoMotivo||''):'',quota:String(ev.quota||''),quotaTecnico:String(ev.quotaTecnico??''),gara:ev.cat==='gara',nota:ev.notaEsterni||'',pagamento:pagamento||'',causale:ev.causaleEsterni||'',locandina:locandina||null}}
const CHIAVI=['esterni','nome','cat','data','scadReg','chiudeMs','chiuso','chiusoMotivo','quota','quotaTecnico','gara','nota','pagamento','causale','locandina'];
const uguale=(a,b)=>CHIAVI.every(k=>JSON.stringify(a[k]??null)===JSON.stringify(b[k]??null));
let pubs=new Map(),pubOk=false,ctx=null;const tent=new Map();
export function seguiPubblici(db){
  return fon(fcol(db,'eventiPubblici'),s=>{pubs=new Map(s.docs.map(d=>[d.id,d.data()]));pubOk=true;ripubblica()},e=>console.warn('Copia pubblica eventi:',e&&e.message,PERM))}
export function sync(db,eventi,pagamento,catL,docOf){ctx={db,eventi,pagamento,catL,docOf};ripubblica()}

/* Locandina (documento allegato all'evento): per gli esterni, che non hanno login, se ne tiene una copia a blocchi in eventiPubblici/<evento>/chunks
   (si copiano i blocchi già salvati su Firebase dall'admin: non serve Telegram). Max 20 MB, come il documento. */
const locDi=d=>d&&d.chunks>0&&d.size<=20*1024*1024?{id:d.id,nome:String(d.title||'locandina').slice(0,120),mime:d.mime||'',size:d.size||0,n:d.chunks}:null;
async function delLoc(db,evId,l){if(l)await Promise.all(Array.from({length:l.n||0},(_,k)=>fdel(fdoc(db,'eventiPubblici',evId,'chunks','c'+k)).catch(()=>{})))}
async function copiaLoc(db,evId,l,vecchia){
  await delLoc(db,evId,vecchia);
  for(let k=0;k<l.n;k++){
    const s=await fgetDoc(fdoc(db,'sections','eventi','items',l.id,'chunks','c'+k));
    if(!s.exists())throw new Error('Blocco '+k+' della locandina non trovato su Firebase');
    await fset(fdoc(db,'eventiPubblici',evId,'chunks','c'+k),{i:k,data:s.data().data})}}

function ripubblica(){
  if(!ctx||!pubOk)return;
  const {db,eventi,pagamento,catL,docOf}=ctx;
  for(const ev of eventi){
    const pub=pubs.get(ev.id);
    if(ev.esterni){
      const loc=locDi(docOf&&docOf(ev)),m=mirrorDi(ev,{cat:catL(ev),pagamento,locandina:loc}),k=JSON.stringify(m);
      if(pub&&uguale(m,pub))continue;
      if(tent.get(ev.id)===k)continue;
      tent.set(ev.id,k);
      (async()=>{
        const vecchia=pub&&pub.locandina||null;
        if(loc&&(!vecchia||vecchia.id!==loc.id||vecchia.n!==loc.n))await copiaLoc(db,ev.id,loc,vecchia);
        else if(!loc&&vecchia)await delLoc(db,ev.id,vecchia);
        await fset(fdoc(db,'eventiPubblici',ev.id),m)})()
      .catch(e=>{tent.delete(ev.id);console.warn('Copia pubblica non scritta:',e&&e.message,PERM)})}
    else if(pub&&pub.esterni&&!tent.has('d'+ev.id)){
      tent.set('d'+ev.id,1);
      delLoc(db,ev.id,pub.locandina).then(()=>fdel(fdoc(db,'eventiPubblici',ev.id))).catch(e=>{tent.delete('d'+ev.id);console.warn(e&&e.message)})}}}

/* elimina tutto ciò che riguarda l'evento tra gli esterni (iscrizioni, copie dei bonifici, coupon, check-in, copia pubblica) */
export async function purge(db,ev){
  const q=c=>query(fcol(db,c),where('evento','==',ev.id));
  const regs=await fget(q('iscrizioniEsterne'));
  for(const d of regs.docs){
    const r=d.data();
    for(const f of (r.bonifici||[]))await delChunks(db,d.id,f);
    await fdel(d.ref)}
  for(const c of ['eventiCoupon','eventiCheckin']){const s=await fget(q(c));for(const d of s.docs)await fdel(d.ref)}
  const pb=await fgetDoc(fdoc(db,'eventiPubblici',ev.id)).catch(()=>null);
  if(pb&&pb.exists())await delLoc(db,ev.id,pb.data().locandina);
  await fdel(fdoc(db,'eventiPubblici',ev.id)).catch(()=>{})}

/* ---------- finestra di dialogo ---------- */
function modal(titolo,onClose){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=40;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(titolo)}" style="max-width:700px"><h2 style="margin:0 0 4px">${esc(titolo)}</h2><div data-b></div><div class="dact"><button class="btn" data-x>Chiudi</button></div></div>`;
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{window.removeEventListener('keydown',k,true);o.remove();try{onClose&&onClose()}catch(e){}};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  document.body.append(o);
  return {o,body:o.querySelector('[data-b]'),close}}

/* dati in tempo reale dell'evento: iscrizioni, coupon, check-in */
function live(db,evId,quali,ridisegna){
  const S={regs:[],cps:[],chk:new Map(),err:'',stop:()=>un.forEach(f=>f())},un=[];
  const q=c=>query(fcol(db,c),where('evento','==',evId)),er=n=>e=>{console.error(n,e);S.err=(e&&e.code==='permission-denied')?PERM:'Errore di lettura ('+n+').';ridisegna()};
  if(quali.reg)un.push(fon(q('iscrizioniEsterne'),s=>{S.regs=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.ts||0)-(b.ts||0));ridisegna()},er('iscrizioni')));
  if(quali.cpn)un.push(fon(q('eventiCoupon'),s=>{S.cps=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.ts||0)-(b.ts||0));ridisegna()},er('coupon')));
  if(quali.chk)un.push(fon(q('eventiCheckin'),s=>{S.chk=new Map(s.docs.map(d=>[d.data().codice,{id:d.id,...d.data()}]));ridisegna()},er('check-in')));
  return S}
const bonificiOf=r=>[...((r&&r.bonifici)||[])].sort((a,b)=>(a.t||0)-(b.t||0));
/* importo dovuto: ricalcolato con quota dell'evento e coupon vero (un coupon disattivato dopo l'invio non annulla lo sconto già concordato; la scadenza si guarda alla data di invio) */
/* con un limite di utilizzi il coupon vale per le prime iscrizioni arrivate (per data di invio): chi arriva dopo il limite paga l'importo intero */
const cpRaw=(S,r)=>S.cps.find(x=>x.codice===r.coupon)||null;
const cpOltre=(S,r)=>{const c=cpRaw(S,r);if(!c||!(num(c.max)>0))return false;return S.regs.filter(x=>x.coupon===c.codice).findIndex(x=>x.id===r.id)>=num(c.max)};
const cpDi=(S,r)=>{const c=cpRaw(S,r);return c&&!cpOltre(S,r)?{...c,attivo:true}:null};
const dovutoDi=(ev,S,r)=>calcola(ev,r.persone||[],cpDi(S,r),r.ts||Date.now());
const confermata=r=>r.stato==='confermata';
async function delChunks(db,rid,f){await Promise.all(Array.from({length:f.n||1},(_,k)=>fdel(fdoc(db,'iscrizioniEsterne',rid,'chunks',f.id+'k'+k)).catch(()=>{})))}
function apriBonifico(db,r,f){
  showPreview({title:f.nome,mime:f.mime,errText:e=>'Impossibile aprire il file ('+(e&&e.message==='EMPTY'?'non trovato':'errore di lettura')+').',
    load:async say=>{
      say('Preparazione del file…');
      const s=await fget(fcol(db,'iscrizioniEsterne',r.id,'chunks')),
        parts=s.docs.map(d=>d.data()).filter(x=>x.f===f.id).sort((a,b)=>a.i-b.i).map(x=>x.data.toUint8Array());
      if(!parts.length)throw new Error('EMPTY');
      return new Blob(parts,{type:guessMime(f.nome,f.mime)})}})}

/* ---------- mail con i codici ---------- */
function testoCodici(ev,r){
  const pe=r.persone||[],atl=pe.filter(p=>!isTec(p)),tec=pe.filter(isTec),riga=p=>'• '+nomeP(p)+' — '+p.codice,
    blocco=(t,a)=>a.length?'\n'+t+' ('+a.length+')\n'+a.map(riga).join('\n')+'\n':'';
  return `Buongiorno ${r.referente||r.assoc||''},

abbiamo verificato il pagamento: l’iscrizione di ${r.assoc||'—'} a «${ev.nome}»${isD(ev.data)?' ('+fmtData(ev.data)+')':''} è confermata.

A ogni partecipante corrisponde un codice personale, scritto qui sotto e allegato anche come QR code (un’immagine per persona). All’ingresso basta mostrare il QR code dal telefono o stampato, oppure dire il codice.
${blocco('ATLETI',atl)}${blocco('TECNICI',tec)}
Conservate questa mail. Per qualsiasi problema rispondete a questo messaggio.

— Yanagi Academy`}
async function inviaCodici(db,ev,r){
  const m=await import('./notifiche-motore.js');
  if(!(await m.mailPronta()))throw new Error('La Mail non è collegata: compila mail-config.js (vedi ponte-mail.gs).');
  const files=[];
  for(const p of (r.persone||[]).filter(x=>x.codice)){
    const bl=await qrPng(p.codice,{titolo:nomeP(p),sotto:p.codice});
    files.push({name:'QR '+sicuro(nomeP(p))+' '+p.codice+'.png',type:'image/png',data:await b64(bl)})}
  if(!files.length)throw new Error('Nessun codice da inviare.');
  const es=await m.inviaDiretta(db,{key:'evext:'+ev.id+':'+r.id+':'+Date.now(),to:r.email,subject:'Iscrizione confermata: '+ev.nome+' – codici di ingresso',text:testoCodici(ev,r),files});
  if(!es.ok)throw new Error(es.e||'Invio non riuscito');
  return files.length}

/* ---------- elenco delle iscrizioni esterne ---------- */
export function apriEsterni(db,ev,{uid}){
  let filtro='tutte',aperto=new Set(),busy=false,msg='';
  const M=modal('Iscrizioni esterne · '+ev.nome,()=>S.stop());
  const S=live(db,ev.id,{reg:true,cpn:true,chk:true},disegna);
  M.body.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b||busy)return;
    const a=b.dataset.a,r=S.regs.find(x=>x.id===b.dataset.i);
    try{
      if(a==='lnk'){msg=(await copiaLink(ev))?'Link copiato.':'';disegna()}
      else if(a==='shr')await condividiLink(ev);
      else if(a==='f'){filtro=b.dataset.f;disegna()}
      else if(a==='csv')csv();
      else if(!r)return;
      else if(a==='tg'){aperto.has(r.id)?aperto.delete(r.id):aperto.add(r.id);disegna()}
      else if(a==='ob'){const f=bonificiOf(r).find(x=>x.id===b.dataset.f);if(f)apriBonifico(db,r,f)}
      else if(a==='cf')await conferma(r);
      else if(a==='rei')await reinvia(r);
      else if(a==='rm')await elimina(r)}
    catch(x){console.error(x);busy=false;msg='Operazione non riuscita: '+(x&&x.message||x);disegna()}});

  async function conferma(r){
    const d=dovutoDi(ev,S,r),n=(r.persone||[]).length;
    if(!n){alert('Questa iscrizione non ha persone.');return}
    if(d.totale>0&&!bonificiOf(r).length&&!confirm('Nessuna copia del bonifico allegata. Confermare comunque?'))return;
    const testo=d.totale>0?'Confermi di aver ricevuto '+euroTxt(d.totale)+' da «'+r.assoc+'»?':'Confermi l’iscrizione di «'+r.assoc+'» (nulla da pagare)?';
    if(!confirm(testo+'\nVerranno creati '+n+(n===1?' codice':' codici')+' e inviati a '+r.email+'.'))return;
    busy=true;msg='Conferma in corso…';disegna();
    const usati=new Set(S.regs.flatMap(x=>(x.persone||[]).map(p=>p.codice).filter(Boolean)));
    const persone=(r.persone||[]).map(p=>({...p,codice:p.codice||nuovoCodice(usati)}));
    await fupd(fdoc(db,'iscrizioniEsterne',r.id),{stato:'confermata',persone,confermataTs:Date.now(),confermataDa:uid,importoDovuto:d.totale});
    Object.assign(r,{stato:'confermata',persone});
    try{const k=await inviaCodici(db,ev,r);await fupd(fdoc(db,'iscrizioniEsterne',r.id),{mailTs:Date.now(),mailErr:''});msg='Confermata: inviati '+k+(k===1?' codice':' codici')+' a '+r.email+'.'}
    catch(x){console.error(x);await fupd(fdoc(db,'iscrizioniEsterne',r.id),{mailErr:String(x&&x.message||x).slice(0,200)}).catch(()=>{});msg='Iscrizione confermata e codici creati, ma la mail NON è partita ('+(x&&x.message||x)+'). Usa «Reinvia codici».'}
    busy=false;disegna()}
  async function reinvia(r){
    if(!confirm('Reinviare i codici a '+r.email+'?'))return;
    busy=true;msg='Invio in corso…';disegna();
    try{const k=await inviaCodici(db,ev,r);await fupd(fdoc(db,'iscrizioniEsterne',r.id),{mailTs:Date.now(),mailErr:''});msg='Reinviati '+k+(k===1?' codice':' codici')+' a '+r.email+'.'}
    catch(x){console.error(x);await fupd(fdoc(db,'iscrizioniEsterne',r.id),{mailErr:String(x&&x.message||x).slice(0,200)}).catch(()=>{});msg='Invio non riuscito: '+(x&&x.message||x)}
    busy=false;disegna()}
  async function elimina(r){
    if(!confirm('Eliminare l’iscrizione di «'+r.assoc+'»? Si cancellano anche la copia del bonifico e gli eventuali ingressi registrati. Non si recupera.'))return;
    for(const f of bonificiOf(r))await delChunks(db,r.id,f);
    for(const p of (r.persone||[])){const c=p.codice&&S.chk.get(p.codice);if(c)await fdel(fdoc(db,'eventiCheckin',c.id)).catch(()=>{})}
    const cc=r.coupon&&cpRaw(S,r);if(cc&&num(cc.max)>0&&(+cc.usi||0)>0)await fupd(fdoc(db,'eventiCoupon',cc.id),{usi:(+cc.usi||0)-1}).catch(x=>console.warn(x));
    await fdel(fdoc(db,'iscrizioniEsterne',r.id))}
  function csv(){
    const rows=[['Associazione','Mail','Referente','Telefono','Ruolo','Cognome','Nome','Peso (kg)','Codice','Iscrizione','Coupon','Importo dovuto (€)','Ingresso']];
    for(const r of S.regs){const d=dovutoDi(ev,S,r);
      for(const p of (r.persone||[]).slice().sort((a,b)=>(isTec(a)-isTec(b))||nomeP(a).localeCompare(nomeP(b),'it'))){
        const c=p.codice&&S.chk.get(p.codice);
        rows.push([r.assoc||'',r.email||'',r.referente||'',r.tel||'',ruoloTxt(p.ruolo),p.cognome||'',p.nome||'',p.peso||'',p.codice||'',confermata(r)?'Confermata':'In attesa',r.coupon||'',d.totale.toFixed(2).replace('.',','),c?hhmm(c.t):''])}}
    const t='\ufeff'+rows.map(x=>x.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
    saveBlob(new Blob([t],{type:'text/csv;charset=utf-8'}),'Iscritti esterni - '+sicuro(ev.nome)+'.csv')}

  function riga(r){
    const d=dovutoDi(ev,S,r),bs=bonificiOf(r),conf=confermata(r),pe=r.persone||[],atl=pe.filter(p=>!isTec(p)),tec=pe.filter(isTec);
    const cp=r.coupon?cpDi(S,r):null,oltre=r.coupon&&cpOltre(S,r),diff=Math.abs(d.totale-(+r.importo||0))>0.005;
    const grp=(t,a)=>a.length?`<div class="mu" style="margin-top:4px"><b>${t} (${a.length}):</b> ${a.map(p=>esc(nomeP(p))+(p.peso?' · '+esc(p.peso)+' kg':'')+(p.codice?` <span class="chip ${S.chk.has(p.codice)?'ok':''}">${esc(p.codice)}${S.chk.has(p.codice)?' ✔ entrato':''}</span>`:'')).join('<br>')}</div>`:'';
    const ap=aperto.has(r.id);
    return `<div class="ir"><div class="l1"><b>${esc(r.assoc||'—')}</b><span class="chip ${conf?'ok':'warn'}">${conf?'Confermata':'In attesa'}</span></div>
      <div class="l2"><span class="chip">${atl.length} atleti</span><span class="chip">${tec.length} tecnici</span><span class="chip">${d.totale>0?esc(euroTxt(d.totale)):'nulla da pagare'}</span>${r.coupon?`<span class="chip ${cp?'ok':'bad'}">coupon ${esc(r.coupon)}${cp?' · '+esc(couponTxt(cp)):oltre?' oltre il limite: importo intero':' non trovato'}</span>`:''}${diff?`<span class="chip bad" title="Importo scritto dall’associazione nel modulo">modulo: ${esc(euroTxt(r.importo))}</span>`:''}${d.totale>0&&!bs.length?'<span class="chip bad">nessun bonifico</span>':''}${conf&&r.mailErr?`<span class="chip bad">mail non inviata</span>`:''}${conf&&r.mailTs&&!r.mailErr?`<span class="chip ok">codici inviati ${esc(hhmm(r.mailTs))}</span>`:''}</div>
      <div class="mu" style="margin-top:4px;overflow-wrap:anywhere">${esc(r.referente||'')}${r.tel?' · '+esc(r.tel):''} · ${esc(r.email||'')} · inviata ${esc(hhmm(r.ts))}</div>
      ${r.nota?`<div class="mu" style="margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere">Nota: ${esc(r.nota)}</div>`:''}
      ${ap||conf?grp('Atleti',atl)+grp('Tecnici',tec):''}
      <div class="l2" style="margin-top:6px">${bs.map((f,k)=>`<button class="btn ghost sm" data-a="ob" data-i="${esc(r.id)}" data-f="${esc(f.id)}">Bonifico${bs.length>1?' '+(k+1):''}</button>`).join('')}${conf?`<button class="btn ghost sm" data-a="rei" data-i="${esc(r.id)}">Reinvia codici</button>`:`<button class="btn sm" data-a="cf" data-i="${esc(r.id)}">${d.totale>0?'Conferma ricezione bonifico':'Conferma iscrizione'}</button>`}${conf?'':`<button class="btn ghost sm" data-a="tg" data-i="${esc(r.id)}">${ap?'Nascondi persone':'Vedi persone'}</button>`}<button class="btn ghost sm" data-a="rm" data-i="${esc(r.id)}">Elimina</button></div></div>`}

  function disegna(){
    const all=S.regs,at=all.filter(r=>!confermata(r)),cf=all.filter(confermata),pe=all.flatMap(r=>r.persone||[]),
      na=pe.filter(p=>!isTec(p)).length,nt=pe.filter(isTec).length,ent=[...S.chk.values()].length,
      inc=cf.reduce((t,r)=>t+dovutoDi(ev,S,r).totale,0),att=at.reduce((t,r)=>t+dovutoDi(ev,S,r).totale,0);
    const lista=filtro==='attesa'?at:filtro==='conf'?cf:all;
    M.body.innerHTML=`<div class="mu" style="margin:6px 0 4px">Link da inviare alle altre associazioni (nessun login):</div>
      <div class="fr" style="gap:6px"><input type="text" readonly value="${esc(linkEsterno(ev.id))}" onclick="this.select()" aria-label="Link del modulo" style="min-width:0;flex:1 1 auto"><button class="btn ghost sm" data-a="lnk">Copia</button>${navigator.share?'<button class="btn ghost sm" data-a="shr">Condividi</button>':''}</div>
      ${S.err?`<p class="err">${esc(S.err)}</p>`:''}${msg?`<p class="mu" role="status" style="margin:8px 0 0">${esc(msg)}</p>`:''}
      <div class="kpi" style="margin-top:10px"><span>Associazioni: <b>${all.length}</b></span><span>Atleti: <b>${na}</b></span><span>Tecnici: <b>${nt}</b></span><span>In attesa: <b>${at.length}</b></span><span>Confermate: <b>${cf.length}</b></span><span>Entrati: <b>${ent}</b></span>${inc+att>0?`<span>Incassato: <b>${esc(euroTxt(inc))}</b></span><span>Da incassare: <b>${esc(euroTxt(att))}</b></span>`:''}</div>
      <div class="tabs" role="group" aria-label="Filtro">${[['tutte','Tutte',all.length],['attesa','In attesa',at.length],['conf','Confermate',cf.length]].map(([k,l,n])=>`<button data-a="f" data-f="${k}" aria-pressed="${filtro===k}">${l} (${n})</button>`).join('')}<button data-a="csv" style="margin-left:auto">Scarica CSV</button></div>
      ${lista.length?lista.map(riga).join(''):`<div class="mu" style="padding:8px 0">${all.length?'Nessuna iscrizione in questo elenco.':'Nessuna iscrizione ancora arrivata.'}</div>`}`}
  disegna()}

/* ---------- coupon ---------- */
export function apriCoupon(db,ev,{uid,interni=()=>[]}){
  const M=modal('Coupon · '+ev.nome,()=>S.stop());
  const S=live(db,ev.id,{reg:true,cpn:true},disegna);
  const q=s=>M.body.querySelector(s),say=(t,ko)=>{const e=q('#cpe');if(e){e.textContent=t||'';e.className=ko?'err':'mu'}};
  M.body.innerHTML=`<p class="mu" style="margin:6px 0">Gli atleti scrivono il codice nella sezione «Pagamento» dell’evento; gli esterni nel modulo del link. L’importo si ricalcola da solo. Gratuito = nulla da pagare (la conferma resta tua).</p>
    <div id="lst"></div>
    <fieldset><legend>Nuovo coupon</legend>
      <label for="cpc">Codice</label><div class="fr"><input id="cpc" type="text" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn ghost sm" data-a="gen" type="button">Genera</button></div>
      <div class="two"><div><label for="cpt">Tipo</label><select id="cpt"><option value="gratis">Gratuito (non paga)</option><option value="perc">Sconto in %</option><option value="euro">Sconto in €</option></select></div><div id="cpw" hidden><label for="cpv">Valore</label><input id="cpv" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 20"></div></div>
      <div class="two"><div><label for="cps">Valido fino al (facoltativo)</label><input id="cps" type="date"></div><div><label for="cpm">Utilizzi massimi (facoltativo)</label><input id="cpm" type="text" inputmode="numeric" autocomplete="off" placeholder="vuoto = illimitati"></div></div>
      <p id="cpe" class="err" role="alert"></p>
      <div class="acts"><button class="btn" data-a="add" type="button">Crea coupon</button></div></fieldset>`;
  M.body.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const a=b.dataset.a,c=S.cps.find(x=>x.id===b.dataset.i);
    try{
      if(a==='gen'){const x=new Uint8Array(6);crypto.getRandomValues(x);q('#cpc').value=Array.from(x,v=>ALFA[v%32]).join('')}
      else if(a==='add')await aggiungi();
      else if(a==='lim'&&c){const v=prompt('Utilizzi massimi del coupon «'+c.codice+'» (vuoto o 0 = illimitati):',num(c.max)>0?String(num(c.max)):'');if(v===null)return;const t=v.trim();if(t&&!/^\d{1,6}$/.test(t)){say('Scrivi un numero intero.',true);return}await fupd(fdoc(db,'eventiCoupon',c.id),{max:+t||0,usi:S.regs.filter(r=>r.coupon===c.codice).length+interni().filter(r=>r.coupon===c.codice).length});say('')}
      else if(a==='on'&&c)await fupd(fdoc(db,'eventiCoupon',c.id),{attivo:c.attivo===false});
      else if(a==='del'&&c&&confirm('Eliminare il coupon «'+c.codice+'»? Le iscrizioni già inviate con questo coupon restano, ma l’importo tornerebbe intero.'))await fdel(fdoc(db,'eventiCoupon',c.id))}
    catch(x){console.error(x);say('Operazione non riuscita. '+(x&&x.code==='permission-denied'?PERM:''),true)}});
  M.body.addEventListener('change',e=>{if(e.target.id==='cpt')q('#cpw').hidden=e.target.value==='gratis'});
  async function aggiungi(){
    say('');
    const g=id=>q('#'+id).value.trim(),cod=normCoupon(g('cpc')),tipo=g('cpt'),val=num(g('cpv')),sc=g('cps'),mx=g('cpm');
    if(cod.length<3){say('Scrivi un codice di almeno 3 caratteri (lettere e numeri) o premi «Genera».',true);return}
    if(tipo==='perc'&&!(val>0&&val<=100)){say('Indica la percentuale di sconto (da 1 a 100).',true);return}
    if(tipo==='euro'&&!(val>0)){say('Indica l’importo dello sconto in euro.',true);return}
    if(sc&&!isD(sc)){say('La scadenza non è valida.',true);return}
    if(mx&&!/^[1-9]\d{0,5}$/.test(mx)){say('Gli utilizzi massimi devono essere un numero intero (1 o più), oppure lascia vuoto.',true);return}
    const id=couponId(ev.id,cod);
    if((await fgetDoc(fdoc(db,'eventiCoupon',id))).exists()){say('Esiste già un coupon con questo codice.',true);return}
    await fset(fdoc(db,'eventiCoupon',id),{evento:ev.id,codice:cod,tipo,valore:tipo==='gratis'?0:val,scadenzaMs:sc?new Date(sc+'T23:59:59').getTime():0,max:mx?+mx:0,usi:0,attivo:true,by:uid,ts:Date.now()});
    q('#cpc').value='';q('#cpv').value='';q('#cps').value='';q('#cpm').value='';say('Coupon «'+cod+'» creato.')}
  function disegna(){
    const usi=c=>S.regs.filter(r=>r.coupon===c.codice).length+interni().filter(r=>r.coupon===c.codice).length,l=q('#lst');if(!l)return;
    l.innerHTML=(S.err?`<p class="err">${esc(S.err)}</p>`:'')+(S.cps.length?S.cps.map(c=>{const sc=c.scadenzaMs&&Date.now()>c.scadenzaMs,n=usi(c),es=couponEsaurito(c,n);return `<div class="ir"><div class="l1"><b style="font-family:ui-monospace,Menlo,Consolas,monospace">${esc(c.codice)}</b><span><span class="chip ${c.attivo===false||sc||es?'bad':'ok'}">${c.attivo===false?'disattivato':sc?'scaduto':es?'esaurito':'attivo'}</span><span class="chip">${esc(couponTxt(c))}</span></span></div><div class="l2"><span class="mu">${c.scadenzaMs?'Valido fino al '+esc(new Date(c.scadenzaMs).toLocaleDateString('it-IT')):'Senza scadenza'} · usato ${n}${num(c.max)>0?' su '+num(c.max):''} ${num(c.max)>0?'':n===1?'volta':'volte'}${couponEsaurito(c,n)?' · <b>esaurito</b>':''}</span></div><div class="l2"><button class="btn ghost sm" data-a="lim" data-i="${esc(c.id)}">Limite utilizzi</button><button class="btn ghost sm" data-a="on" data-i="${esc(c.id)}">${c.attivo===false?'Riattiva':'Disattiva'}</button><button class="btn ghost sm" data-a="del" data-i="${esc(c.id)}">Elimina</button></div></div>`}).join(''):'<div class="mu" style="padding:6px 0">Nessun coupon per questo evento.</div>')}
  disegna()}

/* ---------- check-in ---------- */
let jsqrP=null;
const loadJsQR=()=>window.jsQR?Promise.resolve():(jsqrP||(jsqrP=new Promise((ok,ko)=>{const e=document.createElement('script');e.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';e.onload=ok;e.onerror=()=>{jsqrP=null;ko(new Error('LOAD'))};document.head.append(e)})));
export function apriCheckin(db,ev,{uid}){
  let stream=null,timer=0,det=null,ultimo='',tUltimo=0,esito={t:'',c:'',k:''},cerca='';
  const stop=()=>{clearTimeout(timer);timer=0;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}};
  const M=modal('Check-in · '+ev.nome,()=>{stop();S.stop()});
  const S=live(db,ev.id,{reg:true,chk:true},disegna);
  const persone=()=>S.regs.filter(confermata).flatMap(r=>(r.persone||[]).filter(p=>p.codice).map(p=>({...p,assoc:r.assoc,reg:r.id})));
  const q=s=>M.body.querySelector(s);

  async function registra(raw,{manuale=false}={}){
    const cod=normCodice(raw),p=persone().find(x=>x.codice===cod);
    if(!p){esito={t:'Codice non riconosciuto',c:cod,k:'ko'};if(navigator.vibrate)navigator.vibrate([80,60,80]);disegnaEsito();return}
    const ex=S.chk.get(cod);
    if(ex){esito={t:'Già registrato alle '+hhmm(ex.t),c:nomeP(p)+' · '+ruoloTxt(p.ruolo)+' · '+(p.assoc||''),k:'dup'};if(navigator.vibrate)navigator.vibrate([60,40,60]);disegnaEsito();return}
    try{await fset(fdoc(db,'eventiCheckin',ev.id+'_'+cod),{evento:ev.id,codice:cod,reg:p.reg,nome:nomeP(p),ruolo:p.ruolo||'atleta',assoc:p.assoc||'',t:Date.now(),by:uid,man:!!manuale});
      esito={t:'✔ Ingresso registrato',c:nomeP(p)+' · '+ruoloTxt(p.ruolo)+' · '+(p.assoc||''),k:'ok'};if(navigator.vibrate)navigator.vibrate(120)}
    catch(x){console.error(x);esito={t:'Registrazione non riuscita',c:x&&x.code==='permission-denied'?'Serve il permesso di scrittura su Eventi. '+PERM:'Controlla la connessione e riprova.',k:'ko'}}
    disegnaEsito()}
  function disegnaEsito(){const e=q('#es');if(!e)return;e.className='es '+(esito.k||'');e.innerHTML=esito.t?`<b>${esc(esito.t)}</b><div class="mu" style="overflow-wrap:anywhere">${esc(esito.c)}</div>`:'<span class="mu">Inquadra il QR code di un iscritto, oppure scrivi il codice qui sotto.</span>'}

  async function avvia(){
    const b=q('#cam'),st=q('#cst');st.textContent='';
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){st.textContent='Questo browser non permette di usare la fotocamera: scrivi il codice a mano.';return}
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
      const v=q('#vid');v.srcObject=stream;await v.play();b.style.display='block';q('#go').textContent='Ferma la fotocamera';
      if('BarcodeDetector' in window){try{det=new BarcodeDetector({formats:['qr_code']})}catch(e){det=null}}
      if(!det){st.textContent='Preparazione del lettore…';await loadJsQR();st.textContent=''}
      ciclo()}
    catch(e){console.error(e);stop();st.textContent=e&&e.name==='NotAllowedError'?'Permesso alla fotocamera negato: abilitalo nelle impostazioni del browser.':e&&e.message==='LOAD'?'Lettore non caricato (serve internet). Scrivi il codice a mano.':'Impossibile avviare la fotocamera. Scrivi il codice a mano.'}}
  function fermaCam(){stop();const b=q('#cam');if(b)b.style.display='none';const g=q('#go');if(g)g.textContent='Avvia la fotocamera'}
  async function ciclo(){
    if(!stream)return;
    const v=q('#vid');let val='';
    try{
      if(v&&v.readyState>=2){
        if(det){const r=await det.detect(v);val=r&&r[0]?r[0].rawValue:''}
        else if(window.jsQR){
          const k=Math.min(1,640/v.videoWidth),w=Math.round(v.videoWidth*k),h=Math.round(v.videoHeight*k),c=ciclo.c||(ciclo.c=document.createElement('canvas'));
          c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(v,0,0,w,h);
          const r=window.jsQR(x.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'});val=r?r.data:''}}}
    catch(e){}
    if(val&&(val!==ultimo||Date.now()-tUltimo>3000)){ultimo=val;tUltimo=Date.now();await registra(val)}
    timer=setTimeout(ciclo,det?120:200)}

  M.body.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const a=b.dataset.a;
    if(a==='go'){stream?fermaCam():avvia()}
    else if(a==='reg'){const i=q('#cod');await registra(i.value,{manuale:true});i.value='';i.focus()}
    else if(a==='pres')await registra(b.dataset.c,{manuale:true});
    else if(a==='undo'){const c=[...S.chk.values()].find(x=>x.codice===b.dataset.c);if(c&&confirm('Annullare l’ingresso di '+c.nome+'?'))await fdel(fdoc(db,'eventiCheckin',c.id)).catch(x=>console.error(x))}});
  M.body.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='cod'){e.preventDefault();q('[data-a=reg]').click()}});
  M.body.addEventListener('input',e=>{if(e.target.id==='cks'){cerca=e.target.value;disegnaRis()}});

  function disegnaRis(){
    const r=q('#ris');if(!r)return;
    const t=cerca.trim().toLowerCase();
    if(!t){r.innerHTML='';return}
    const l=persone().filter(p=>(nomeP(p)+' '+(p.assoc||'')+' '+p.codice).toLowerCase().includes(t)).slice(0,15);
    r.innerHTML=l.length?l.map(p=>{const c=S.chk.get(p.codice);return `<div class="ir"><div class="l1"><span><b>${esc(nomeP(p))}</b> <span class="mu">· ${esc(ruoloTxt(p.ruolo))} · ${esc(p.assoc||'')}</span></span>${c?`<span class="chip ok">entrato ${esc(hhmm(c.t))}</span>`:`<button class="btn sm" data-a="pres" data-c="${esc(p.codice)}">Presente</button>`}</div></div>`}).join(''):'<div class="mu" style="padding:6px 0">Nessuno trovato (contano solo le iscrizioni confermate).</div>'}
  let montato=false;
  function disegna(){
    const ps=persone(),ent=[...S.chk.values()].filter(c=>ps.some(p=>p.codice===c.codice)),ea=ent.filter(c=>c.ruolo!=='tecnico').length,et=ent.length-ea,
      ta=ps.filter(p=>!isTec(p)).length,tt=ps.length-ta,ult=[...S.chk.values()].sort((a,b)=>b.t-a.t).slice(0,12);
    if(!montato){
      montato=true;
      M.body.innerHTML=`<div id="kp"></div>
        <div style="margin:8px 0"><button class="btn" data-a="go" id="go" type="button">Avvia la fotocamera</button> <span class="mu" id="cst" role="status"></span></div>
        <div class="cam" id="cam"><video id="vid" playsinline muted></video></div>
        <div class="es" id="es" role="status" aria-live="polite"></div>
        <label for="cod">Codice scritto a mano</label><div class="fr"><input id="cod" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="es. K7M2-Q9XP"><button class="btn" data-a="reg" type="button">Registra</button></div>
        <label for="cks">Cerca per nome, associazione o codice</label><input id="cks" type="search" autocomplete="off"><div id="ris"></div>
        <h3 style="margin:14px 0 4px;font-size:.85rem;color:var(--ac);text-transform:uppercase;letter-spacing:.04em">Ultimi ingressi</h3><div id="ul"></div>`;
      disegnaEsito()}
    q('#kp').innerHTML=`${S.err?`<p class="err">${esc(S.err)}</p>`:''}<div class="kpi"><span>✔ Entrati: <b>${ent.length}/${ps.length}</b></span><span>Atleti: <b>${ea}/${ta}</b></span><span>Tecnici: <b>${et}/${tt}</b></span></div>${ps.length?'':'<div class="mu">Non ci sono ancora iscrizioni confermate: i codici esistono solo dopo la conferma del bonifico.</div>'}`;
    q('#ul').innerHTML=ult.length?ult.map(c=>`<div class="ir"><div class="l1"><span><b>${esc(c.nome)}</b> <span class="mu">· ${esc(ruoloTxt(c.ruolo))} · ${esc(c.assoc||'')}</span></span><span><span class="chip">${esc(hhmm(c.t))}</span><button class="xb" data-a="undo" data-c="${esc(c.codice)}" aria-label="Annulla l’ingresso">✕</button></span></div></div>`).join(''):'<div class="mu">Nessun ingresso registrato.</div>';
    disegnaRis()}
  disegna()}
