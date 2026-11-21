/* Pagina PUBBLICA di iscrizione agli eventi per gli esterni (altre associazioni): nessun login.
   • iscrizione.html?e=<idEvento>  → modulo (atleti e tecnici separati, coupon, coordinate di pagamento, copia del bonifico)
   • iscrizione.html?r=<idIscrizione> → stato dell'iscrizione (in attesa / confermata) e, a conferma avvenuta, codici e QR di ogni iscritto.
   Dati letti: eventiPubblici/<evento> (copia pubblica dei soli dati dell'evento, scritta dall'admin) ed eventiCoupon/<evento>_<CODICE> (solo get).
   Dati scritti: iscrizioniEsterne/<id> (stato «attesa») e iscrizioniEsterne/<id>/chunks (copia del bonifico). Regole in firestore.rules. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getFirestore,doc,getDoc,setDoc,updateDoc,deleteDoc,arrayUnion,Bytes} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {qrCanvas,qrPng} from "./qr.js";
import {calcola,couponId,couponOk,normCoupon,couponTxt,euroTxt,fmtData,nomeP,newId,isTec,quotaRuolo} from "./eventi-esterni-core.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=new URLSearchParams(location.search),EV=(P.get('e')||'').trim(),REG=(P.get('r')||'').trim();
const CH=900000,MAXB=10*1024*1024,RX_MAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const top=body=>`<div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Iscrizione evento</h2></div></div>${body}</div>`;
const msg=(t,m)=>{app.innerHTML=top(`<div class="card"><h2>${esc(t)}</h2><div class="mu">${esc(m)}</div></div>`)};
let db=null,m=null,atl=[{cognome:'',nome:'',peso:''}],tec=[],cp=null,cpCod='';

const chiusa=x=>!!x.chiuso||(x.chiudeMs>0&&Date.now()>x.chiudeMs);
const nv=p=>!!((p.cognome||'').trim()||(p.nome||'').trim());
const persone=()=>[...atl.filter(nv).map(p=>({ruolo:'atleta',cognome:p.cognome.trim(),nome:p.nome.trim(),...(m.gara?{peso:String(p.peso||'').trim().replace(',','.')}:{})})),
  ...tec.filter(nv).map(p=>({ruolo:'tecnico',cognome:p.cognome.trim(),nome:p.nome.trim()}))];

/* ---------- copia del bonifico (a blocchi, come nel resto della suite) ---------- */
async function caricaBonifico(id,file,onP){
  const fid=newId(8),n=Math.max(1,Math.ceil(file.size/CH)),meta={id:fid,nome:file.name.slice(0,120),size:file.size,mime:file.type||'',n,t:Date.now()};
  try{
    for(let k=0;k<n;k++){
      const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());
      await setDoc(doc(db,'iscrizioniEsterne',id,'chunks',fid+'k'+k),{f:fid,i:k,data:Bytes.fromUint8Array(buf)});
      if(onP)onP(Math.round((k+1)/n*100))}
    await updateDoc(doc(db,'iscrizioniEsterne',id),{bonifici:arrayUnion(meta)})}
  catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(db,'iscrizioniEsterne',id,'chunks',fid+'k'+k)).catch(()=>{})));throw e}}

/* ---------- modulo ---------- */
function riga(k,i,p){
  const gara=m.gara&&k==='atl';
  return `<div class="pr${gara?'':' nopeso'}" data-k="${k}" data-i="${i}"><input type="text" data-f="cognome" placeholder="Cognome" maxlength="60" autocomplete="off" value="${esc(p.cognome)}" aria-label="Cognome"><input type="text" data-f="nome" placeholder="Nome" maxlength="60" autocomplete="off" value="${esc(p.nome)}" aria-label="Nome">${gara?`<input type="text" data-f="peso" inputmode="decimal" placeholder="Peso kg" maxlength="6" autocomplete="off" value="${esc(p.peso||'')}" aria-label="Peso previsto in kg">`:''}<button type="button" class="xb" data-rm aria-label="Togli questa riga">✕</button></div>`}
function paintRows(){
  $('#la').innerHTML=atl.map((p,i)=>riga('atl',i,p)).join('')||'<div class="mu" style="margin-top:8px">Nessun atleta.</div>';
  $('#lt').innerHTML=tec.map((p,i)=>riga('tec',i,p)).join('')||'<div class="mu" style="margin-top:8px">Nessun tecnico.</div>';
  paintTot()}
function paintTot(){
  const c=calcola(m,persone(),cp),qa=quotaRuolo(m,'atleta'),qt=quotaRuolo(m,'tecnico');
  const r=(l,v,cl='')=>`<div class="tot ${cl}"><span>${l}</span><span>${v}</span></div>`;
  $('#tot').innerHTML=(qa>0||qt>0||c.lordo>0?r('Atleti: '+c.atl+(qa>0?' × '+euroTxt(qa):''),euroTxt(c.sa))+r('Tecnici: '+c.tec+(qt>0?' × '+euroTxt(qt):' (gratis)'),euroTxt(c.st)):r('Atleti: '+c.atl+' · Tecnici: '+c.tec,'gratuito'))
    +(c.sconto>0?r('Coupon '+esc(cpCod),'− '+euroTxt(c.sconto)):'')+r('Da versare',c.totale>0?euroTxt(c.totale):'nulla','big');
  const f=$('#flw');if(f)f.hidden=!(c.totale>0)}
async function applicaCoupon(){
  const cod=normCoupon($('#cp').value),o=$('#cpm');
  $('#cp').value=cod;o.className='mu';
  if(!cod){cp=null;cpCod='';o.textContent='';paintTot();return}
  o.textContent='Verifica in corso…';
  try{
    const s=await getDoc(doc(db,'eventiCoupon',couponId(EV,cod))),d=s.exists()?s.data():null,v=couponOk(d);
    if(!v.ok){cp=null;cpCod='';o.textContent=v.motivo||'Coupon non valido.';o.className='err'}
    else{cp=d;cpCod=cod;o.textContent='Coupon applicato: '+couponTxt(d)+'.';o.className='ok-t'}}
  catch(e){console.error(e);cp=null;cpCod='';o.textContent='Impossibile verificare il coupon. Riprova.';o.className='err'}
  paintTot()}

async function invia(){
  const er=$('#er'),g=id=>$('#'+id).value.trim(),b=$('#sv');er.textContent='';
  const assoc=g('as'),email=g('em').toLowerCase(),ref=g('rf'),tel=g('tl'),nota=g('nt');
  if(!assoc){er.textContent='Indica il nome dell’associazione.';return}
  if(!RX_MAIL.test(email)){er.textContent='Indica la mail dell’associazione: i codici arriveranno lì.';return}
  if(!ref){er.textContent='Indica il nome del referente.';return}
  const tutti=[...atl,...tec].filter(nv);
  if(tutti.some(p=>!(p.cognome||'').trim()||!(p.nome||'').trim())){er.textContent='Per ogni persona servono cognome e nome.';return}
  if(!tutti.length){er.textContent='Aggiungi almeno un atleta o un tecnico.';return}
  if(m.gara&&atl.filter(nv).some(p=>!/^\d{2,3}([.,]\d{1,2})?$/.test(String(p.peso||'').trim()))){er.textContent='Indica il peso previsto (in kg, es. 66 oppure 66,5) per ogni atleta.';return}
  const pe=persone(),c=calcola(m,pe,cp),file=$('#fl').files[0];
  if(c.totale>0&&!file){er.textContent='Allega la copia del bonifico: senza non possiamo confermare l’iscrizione.';return}
  if(file&&file.size>MAXB){er.textContent='Il file supera 10 MB.';return}
  if(chiusa(m)){er.textContent='Le iscrizioni sono chiuse.';return}
  b.disabled=true;er.textContent='Invio in corso…';
  const id=newId();
  try{await setDoc(doc(db,'iscrizioniEsterne',id),{evento:EV,assoc:assoc.slice(0,120),email:email.slice(0,120),referente:ref.slice(0,80),tel:tel.slice(0,40),persone:pe,coupon:cpCod,importo:c.totale,nota:nota.slice(0,1000),stato:'attesa',bonifici:[],ts:Date.now()})}
  catch(e){console.error(e);er.textContent=e&&e.code==='permission-denied'?'Non è stato possibile inviare: le iscrizioni potrebbero essere chiuse.':'Invio non riuscito. Controlla la connessione e riprova.';b.disabled=false;return}
  let ko=false;
  if(file){try{await caricaBonifico(id,file,p=>{er.textContent='Caricamento della copia del bonifico '+p+'%'})}catch(e){console.error(e);ko=true}}
  location.replace(location.pathname+'?r='+id+(ko?'&u=1':''))}

function vistaModulo(){
  const q=quotaRuolo(m,'atleta'),qt=quotaRuolo(m,'tecnico');
  app.innerHTML=top(`<div class="card"><h2 style="margin:0">${esc(m.nome)}</h2>
    <div class="mu" style="margin:2px 0 8px">${esc(m.cat||'')}${m.data?' · '+esc(fmtData(m.data)):''}</div>
    ${m.scadReg?`<span class="chip warn">Iscrizioni entro il ${esc(fmtData(m.scadReg))}</span>`:''}${q>0?`<span class="chip">Quota atleti ${esc(euroTxt(q))}</span>`:'<span class="chip">Atleti: gratuito</span>'}${q>0||qt>0?`<span class="chip">Quota tecnici ${qt>0?esc(euroTxt(qt)):'gratis'}</span>`:''}
    ${m.nota?`<div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px">${esc(m.nota)}</div>`:''}</div>
  <div class="card" id="fm" style="margin-top:12px">
    <fieldset><legend>Associazione</legend>
      <label for="as">Nome dell’associazione / società</label><input id="as" type="text" maxlength="120" autocomplete="organization">
      <label for="em">Mail dell’associazione <span class="mu">(a questo indirizzo inviamo i codici di ingresso)</span></label><input id="em" type="email" maxlength="120" autocomplete="email" inputmode="email">
      <div class="two"><div><label for="rf">Referente</label><input id="rf" type="text" maxlength="80" autocomplete="name"></div><div><label for="tl">Telefono (facoltativo)</label><input id="tl" type="tel" maxlength="40" autocomplete="tel"></div></div>
    </fieldset>
    <fieldset><legend>Atleti</legend><div class="mu" style="margin-top:8px">${m.gara?'Cognome, nome e peso previsto di ogni atleta iscritto.':'Cognome e nome di ogni atleta iscritto.'}</div><div id="la"></div><p style="margin:10px 0 0"><button type="button" class="btn ghost sm" id="aa">+ Aggiungi atleta</button></p></fieldset>
    <fieldset><legend>Tecnici</legend><div class="mu" style="margin-top:8px">Allenatori e accompagnatori tecnici (separati dagli atleti).</div><div id="lt"></div><p style="margin:10px 0 0"><button type="button" class="btn ghost sm" id="at">+ Aggiungi tecnico</button></p></fieldset>
    <fieldset><legend>Coupon</legend><label for="cp">Hai un codice coupon? (facoltativo)</label><div class="fr"><input id="cp" type="text" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" class="btn ghost" id="ap">Applica</button></div><div class="mu" id="cpm" role="status" style="margin-top:6px"></div></fieldset>
    <fieldset><legend>Pagamento</legend>
      <div id="tot" style="margin-top:8px"></div>
      <div class="mu" style="margin:10px 0 4px">Pagate con bonifico alle coordinate qui sotto, poi allegate la copia: l’iscrizione resta <b>in attesa</b> finché non verifichiamo l’accredito.</div>
      <div class="pay">${m.pagamento?esc(m.pagamento):'Le coordinate di pagamento non sono ancora state indicate: contatta l’organizzazione.'}</div>
      <div id="flw"><label for="fl">Copia del bonifico (immagine o PDF, max 10 MB)</label><input id="fl" type="file" accept="image/*,application/pdf"></div>
    </fieldset>
    <label for="nt">Note per l’organizzazione (facoltative)</label><textarea id="nt" maxlength="1000"></textarea>
    <p class="err" id="er" role="alert"></p>
    <div style="margin-top:4px"><button class="btn" id="sv" type="button">Invia iscrizione</button></div>
  </div>`);
  const fm=$('#fm');
  fm.addEventListener('input',e=>{const t=e.target.closest('[data-f]');if(!t)return;const r=t.closest('.pr'),l=r.dataset.k==='atl'?atl:tec;l[+r.dataset.i][t.dataset.f]=t.value;paintTot()});
  fm.addEventListener('click',e=>{
    const rm=e.target.closest('[data-rm]');
    if(rm){const r=rm.closest('.pr'),l=r.dataset.k==='atl'?atl:tec;l.splice(+r.dataset.i,1);paintRows();return}
    if(e.target.closest('#aa')){atl.push({cognome:'',nome:'',peso:''});paintRows();const x=document.querySelectorAll('#la .pr');x[x.length-1].querySelector('input').focus();return}
    if(e.target.closest('#at')){tec.push({cognome:'',nome:''});paintRows();const x=document.querySelectorAll('#lt .pr');x[x.length-1].querySelector('input').focus();return}
    if(e.target.closest('#ap')){applicaCoupon();return}
    if(e.target.closest('#sv'))invia()});
  $('#cp').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applicaCoupon()}});
  paintRows()}

/* ---------- stato dell'iscrizione ---------- */
async function vistaStato(id){
  let s;
  try{s=await getDoc(doc(db,'iscrizioniEsterne',id))}catch(e){console.error(e);msg('Iscrizione non disponibile','Impossibile leggere l’iscrizione. Riprova tra poco.');return}
  if(!s.exists()){msg('Iscrizione non trovata','Il link non è valido oppure l’iscrizione è stata eliminata dall’organizzazione.');return}
  const r=s.data();let ev=null;
  try{const e=await getDoc(doc(db,'eventiPubblici',r.evento));ev=e.exists()?e.data():null}catch(e){}
  const conf=r.stato==='confermata',pe=r.persone||[],atls=pe.filter(p=>!isTec(p)),tecs=pe.filter(isTec),nb=(r.bonifici||[]).length,serve=!conf&&r.importo>0&&!nb;
  const lista=(t,a)=>a.length?`<h3 style="margin:12px 0 4px;font-size:.85rem;color:var(--ac);text-transform:uppercase;letter-spacing:.04em">${t} (${a.length})</h3>${a.map(p=>`<div>${esc(nomeP(p))}${p.peso?` <span class="mu">· ${esc(p.peso)} kg</span>`:''}${conf&&p.codice?` <span class="chip ok">${esc(p.codice)}</span>`:''}</div>`).join('')}`:'';
  app.innerHTML=top(`<div class="card"><h2 style="margin:0">${esc(ev?ev.nome:'Evento')}</h2>
    <div class="mu" style="margin:2px 0 8px">${ev?esc((ev.cat||'')+(ev.data?' · '+fmtData(ev.data):'')):''}</div>
    ${conf?'<span class="chip ok">Iscrizione confermata</span>':'<span class="chip warn">In attesa di conferma</span>'}${serve?'<span class="chip bad">Manca la copia del bonifico</span>':''}${nb?`<span class="chip">Bonifico allegato</span>`:''}
    <p style="margin:8px 0 0">${conf?`I codici di ingresso sono stati inviati a <b>${esc(r.email)}</b> e sono qui sotto: uno per ogni partecipante. Mostrate il QR code (o dite il codice) all’ingresso.`:`Abbiamo ricevuto l’iscrizione di <b>${esc(r.assoc)}</b>. Appena verifichiamo ${r.importo>0?'il bonifico':'i dati'} riceverete i codici di ingresso a <b>${esc(r.email)}</b>. Conservate questo link per controllare lo stato.`}</p>
    ${r.importo>0?`<div class="mu" style="margin-top:6px">Importo indicato: ${esc(euroTxt(r.importo))}${r.coupon?' · coupon '+esc(r.coupon):''}</div>`:''}
    ${lista('Atleti',atls)}${lista('Tecnici',tecs)}
    <div style="margin-top:12px"><button class="btn ghost sm" id="rf">Aggiorna lo stato</button></div></div>
  ${serve?`<div class="card" style="margin-top:12px"><h2 style="margin:0 0 4px">Allega la copia del bonifico</h2>${P.get('u')?'<p class="err" style="margin:0">Il caricamento precedente non è riuscito: riprova.</p>':''}${ev&&ev.pagamento?`<div class="pay" style="margin:8px 0">${esc(ev.pagamento)}</div>`:''}<label for="fl">Immagine o PDF, max 10 MB</label><input id="fl" type="file" accept="image/*,application/pdf"><p class="err" id="er" role="alert"></p><button class="btn" id="up">Invia la copia del bonifico</button></div>`:''}
  ${conf?`<div class="card" style="margin-top:12px"><h2 style="margin:0 0 4px">Codici di ingresso</h2><div class="qrs">${pe.filter(p=>p.codice).map(p=>`<div class="qc"><b>${esc(nomeP(p))}</b><div class="mu" style="color:#5B6780">${esc(ruoloT(p))}</div><div data-qr="${esc(p.codice)}"></div><div class="cd">${esc(p.codice)}</div><button class="btn ghost sm" data-dl="${esc(p.codice)}" style="margin-top:6px;color:#14213D;border-color:#D3D9E3">Scarica il QR</button></div>`).join('')}</div></div>`:''}`);
  document.querySelectorAll('[data-qr]').forEach(d=>{d.append(qrCanvas(d.dataset.qr,{px:440}))});
  $('#rf').onclick=()=>vistaStato(id);
  document.querySelectorAll('[data-dl]').forEach(b=>b.onclick=async()=>{
    const p=pe.find(x=>x.codice===b.dataset.dl);if(!p)return;
    const bl=await qrPng(p.codice,{titolo:nomeP(p),sotto:p.codice}),a=document.createElement('a');
    a.href=URL.createObjectURL(bl);a.download='QR '+nomeP(p).replace(/[\\/:*?"<>|]/g,' ')+' '+p.codice+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000)});
  const up=$('#up');
  if(up)up.onclick=async()=>{
    const er=$('#er'),f=$('#fl').files[0];er.textContent='';
    if(!f){er.textContent='Scegli il file della copia del bonifico.';return}
    if(f.size>MAXB){er.textContent='Il file supera 10 MB.';return}
    up.disabled=true;
    try{await caricaBonifico(id,f,p=>{er.textContent='Caricamento '+p+'%'});history.replaceState(null,'',location.pathname+'?r='+id);vistaStato(id)}
    catch(e){console.error(e);er.textContent='Caricamento non riuscito. Riprova.';up.disabled=false}}}
const ruoloT=p=>isTec(p)?'Tecnico':'Atleta';

/* ---------- avvio ---------- */
(async()=>{
  if(firebaseConfig.apiKey==='INSERISCI'){msg('Pagina non ancora attiva','Firebase non è collegato.');return}
  db=getFirestore(initializeApp(firebaseConfig));
  if(REG){vistaStato(REG);return}
  if(!EV){msg('Link non valido','Manca l’evento: chiedi all’organizzazione il link corretto.');return}
  try{const s=await getDoc(doc(db,'eventiPubblici',EV));m=s.exists()?s.data():null}
  catch(e){console.error(e);msg('Pagina non disponibile','Impossibile leggere l’evento. Riprova tra poco.');return}
  if(!m||!m.esterni){msg('Iscrizioni non disponibili','Per questo evento non sono aperte iscrizioni con questo link.');return}
  if(chiusa(m)){msg(m.nome||'Evento',m.chiuso?'Le iscrizioni sono chiuse'+(m.chiusoMotivo?' ('+m.chiusoMotivo+')':'')+'.':'Le iscrizioni sono chiuse: la scadenza è passata.');return}
  vistaModulo()})();
