import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,getDocs,serverTimestamp} from "./fsx.js";
/* Iscrizioni e bonifici stanno direttamente su Firebase (non passano da Telegram): così funzionano anche per chi non ha Telegram */
import {collection as fcol,doc as fdoc,onSnapshot as fon,setDoc as fset,updateDoc as fupd,deleteDoc as fdel,getDocs as fget,query,where,arrayUnion,serverTimestamp as fts,Bytes} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {archivio,limiteMB} from "./archivio.js";
import {showPreview,saveBlob,guessMime} from "./file-tools.js";
import {isD,fmtD,giorni} from "./atleti-scadenze.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='eventi',ALERT_GG=10,MAXB=20*1024*1024,CH=900000;
const CATS={seminario:'Seminari',gara:'Gare',allenamento:'Allenamenti',altro:'Altro'};
const CAT1={seminario:'Seminario',gara:'Gara',allenamento:'Allenamento',altro:'Altro'};
const MOTIVI=['Sold out','Iscrizioni complete','Altro motivo'];
let auth,db,col,uid=null,me=null,items=[],iscr=[],users=[],q='',cat='all',unsubs=[],started=false,shellFor='',editing=null,memo=null,detail=null,arch=null,pay='',upMsg='';
const isAdmin=()=>!!(me&&me.admin);
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const meName=()=>(me&&(me.name||me.email))||'';
const newId=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return Array.from(a,b=>(b%36).toString(36)).join('')};
const money=v=>{const n=parseFloat(String(v??'').replace(',','.'));return isFinite(n)&&n>0?n.toLocaleString('it-IT',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2})+' €':''};
const dlTxt=g=>g<0?'scaduta da '+(-g)+(g===-1?' giorno':' giorni'):g===0?'scade oggi':g===1?'scade domani':'scade tra '+g+' giorni';

/* ---------- dati ---------- */
const evs=()=>items.filter(i=>i.kind==='evento');
const iscOf=id=>iscr.filter(r=>r.evento===id);
const myIsc=id=>iscr.find(r=>r.id===id+'_'+uid);
const bonificiOf=r=>[...((r&&r.bonifici)||[])].sort((a,b)=>(a.t||0)-(b.t||0));
const filesOf=(id,ruolo)=>items.filter(i=>i.kind==='file'&&i.evento===id&&i.ruolo===ruolo);
const docOf=ev=>items.find(i=>i.id===ev.docId)||filesOf(ev.id,'doc')[0]||null;
const isPast=ev=>isD(ev.data)&&giorni(ev.data)<0;
const scadPass=ev=>isD(ev.scadReg)&&giorni(ev.scadReg)<0;
/* registrazione chiusa: evento concluso, scadenza superata oppure chiuso dall'admin (sold out, iscrizioni complete…) */
const chiusa=ev=>!!ev.chiuso||isPast(ev)||scadPass(ev);
const motivoChiusura=ev=>ev.chiuso?'Iscrizioni chiuse'+(ev.chiusoMotivo?' ('+ev.chiusoMotivo+')':''):isPast(ev)?'Evento concluso':scadPass(ev)?'Iscrizioni chiuse dal '+fmtD(ev.scadReg):'';
/* in rosso quando mancano ALERT_GG giorni o meno alla scadenza (iscrizione o hotel) */
const urgD=d=>{if(!isD(d))return false;const g=giorni(d);return g>=0&&g<=ALERT_GG};
const urgente=ev=>!ev.chiuso&&!isPast(ev)&&(urgD(ev.scadReg)||(ev.hotel&&urgD(ev.scadHotel)));

/* chip di una scadenza: rosso a 10 giorni o meno, neutro se è già passata */
function dlChip(label,d){
  if(!isD(d))return '';
  const g=giorni(d);
  return g<0?`<span class="chip">${label} chiusa</span>`:g<=ALERT_GG?`<span class="chip bad">${label} ${dlTxt(g)}</span>`:`<span class="chip">${label} entro ${fmtD(d)}</span>`}
/* nella scheda la data è già scritta: si aggiunge solo l'avviso quando la scadenza è vicina o passata */
function dlWarn(d){
  if(!isD(d))return '';
  const g=giorni(d);
  return g<0?'<span class="chip">chiusa</span>':g<=ALERT_GG?`<span class="chip bad">${dlTxt(g)}</span>`:''}

/* ---------- finestra di dialogo generica ---------- */
function modal(title,body,{ok='Salva',cancel='Annulla',onSave}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>${cancel}</button>${onSave?`<button class="btn" data-ok>${ok}</button>`:''}</div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  if(onSave)o.querySelector('[data-ok]').onclick=async()=>{er.textContent='';try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Salvataggio non riuscito. Riprova.'}};
  document.body.append(o);return o}

/* Modalità di pagamento: le scrive solo l'admin, le leggono tutti (copia anche su Firebase, per chi non ha Telegram) */
function openPay(){
  const body=isAdmin()
    ?`<p class="mu" style="margin:6px 0">Scrivi come si può pagare (IBAN e intestatario, causale da usare, PayPal, contanti…). Gli atleti la leggono da qui.</p><textarea id="pt" style="min-height:180px">${esc(pay)}</textarea>`
    :`<div class="pay" style="margin:10px 0">${pay?esc(pay):'<span class="mu">L’admin non ha ancora indicato le modalità di pagamento.</span>'}</div>`;
  modal('Come pagare',body,isAdmin()?{onSave:async o=>{
    const text=o.querySelector('#pt').value.trim();
    await setDoc(doc(db,'sections',SEC,'meta','pagamenti'),{text,fb:true,by:uid,at:serverTimestamp()});pay=text}}:{cancel:'Chiudi'})}

/* ---------- struttura della pagina (creata una volta sola) ---------- */
function shell(){
  const adm=isAdmin();shellFor=perm()+(adm?'a':'');
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca negli eventi" aria-label="Cerca negli eventi" value="${esc(q)}"><span class="who">${esc(meName())}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Eventi</h2><div class="hbtn"><button class="btn ghost sm" id="pay">Come pagare</button>${adm?'<button class="btn sm" id="ftg" aria-expanded="false" aria-controls="fb">+ Nuovo evento</button>':''}</div></div></div>
  ${adm?`<div class="card" id="fb" hidden style="margin-bottom:12px"><h3 id="ft" style="margin:0">Nuovo evento</h3>
    <fieldset><legend>Evento</legend>
      <label for="nm">Nome dell’evento</label><input id="nm" type="text" autocomplete="off">
      <div class="two"><div><label for="ct">Categoria</label><select id="ct">${Object.entries(CAT1).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div><div><label for="dt">Data</label><input id="dt" type="date"></div></div>
    </fieldset>
    <fieldset><legend>Scadenze e quota</legend>
      <div class="two"><div><label for="sr">Scadenza registrazione</label><input id="sr" type="date"></div><div><label for="qt">Quota di partecipazione (€)</label><input id="qt" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 25 oppure 25,50"></div></div>
      <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="ht" style="width:auto;min-height:0"> È previsto un hotel</label>
      <div id="shw" hidden><label for="sh">Scadenza registrazione hotel</label><input id="sh" type="date"></div>
    </fieldset>
    <fieldset><legend>Documento e nota per gli atleti</legend>
      <label for="fl">Documento (se c’è)</label><input id="fl" type="file"><div class="mu" id="cur" style="margin-top:4px"></div>
      <label class="mu" id="rml" style="display:none;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="rmd" style="width:auto;min-height:0"> Togli il documento attuale</label>
      <label for="nt">Nota per gli atleti</label><textarea id="nt"></textarea>
    </fieldset>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva evento</button><button class="btn ghost" id="cx">Annulla</button></div></div>`:''}
  <div class="card" id="ls" style="padding:8px 14px"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#pay').onclick=openPay;
  $('#ls').onclick=e=>{
    const t=e.target.closest('[data-tab]');if(t){cat=t.dataset.tab;renderList();return}
    const b=e.target.closest('[data-id]');if(b)openDetail(b.dataset.id)};
  if(adm){
    $('#ftg').onclick=()=>resetForm($('#fb').hidden);
    $('#sv').onclick=save;$('#cx').onclick=()=>resetForm(false);
    $('#ht').onchange=()=>{$('#shw').hidden=!$('#ht').checked}}
}
const FF=[['nm','nome'],['ct','cat'],['dt','data'],['sr','scadReg'],['qt','quota'],['sh','scadHotel'],['nt','nota']];
function setForm(o){const b=$('#fb'),t=$('#ftg');if(!b)return;b.hidden=!o;t.setAttribute('aria-expanded',String(o));t.textContent=o?'− Chiudi':'+ Nuovo evento'}
function resetForm(open){
  setForm(open);editing=null;FF.forEach(([e])=>$('#'+e).value='');$('#ct').value='seminario';$('#ht').checked=false;$('#shw').hidden=true;
  $('#fl').value='';$('#cur').textContent='';$('#rml').style.display='none';$('#rmd').checked=false;
  $('#ft').textContent='Nuovo evento';$('#sv').textContent='Salva evento';$('#er').textContent=''}
function edit(ev){
  setForm(true);editing=ev.id;FF.forEach(([e,k])=>$('#'+e).value=ev[k]??'');if(!$('#ct').value)$('#ct').value='altro';
  $('#ht').checked=!!ev.hotel;$('#shw').hidden=!ev.hotel;$('#fl').value='';$('#rmd').checked=false;
  const d=docOf(ev);$('#cur').textContent=d?'Documento attuale: '+d.title+'. Scegli un file per sostituirlo.':'';$('#rml').style.display=d?'flex':'none';
  $('#ft').textContent='Modifica evento';$('#sv').textContent='Salva modifiche';$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

/* Il documento dell'evento lo carica l'admin: si salva su Telegram e, in copia, su Firebase (così lo aprono anche gli atleti senza Telegram) */
function canUpload(){
  if(arch.needsTelegram()){
    if(confirm('Il documento viene salvato su Telegram (con copia su Firebase): prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  return true}

async function save(){
  const g=id=>$('#'+id).value.trim(),er=$('#er');
  const v={nome:g('nm'),cat:g('ct'),data:g('dt'),scadReg:g('sr'),quota:g('qt').replace(',','.'),hotel:$('#ht').checked,scadHotel:$('#ht').checked?g('sh'):'',nota:g('nt')};
  if(!v.nome){er.textContent='Inserisci il nome dell’evento.';return}
  if(!isD(v.data)){er.textContent='Indica la data dell’evento.';return}
  if(v.scadReg&&!isD(v.scadReg)){er.textContent='La scadenza della registrazione non è valida.';return}
  if(v.scadReg&&v.scadReg>v.data){er.textContent='La scadenza della registrazione deve essere prima dell’evento.';return}
  if(v.hotel&&v.scadHotel&&!isD(v.scadHotel)){er.textContent='La scadenza dell’hotel non è valida.';return}
  if(v.quota&&!/^\d{1,5}(\.\d{1,2})?$/.test(v.quota)){er.textContent='La quota deve essere un importo (es. 25 o 25,50).';return}
  const file=$('#fl').files[0];
  if(file&&file.size>arch.maxBytes()){er.textContent='“'+file.name+'” supera il limite di '+limiteMB()+' MB.';return}
  if(file&&!canUpload())return;
  /* fb:true = l'evento è copiato anche su Firebase, così lo vedono tutti, anche senza Telegram */
  const data={...v,fb:true,kind:'evento',title:v.nome,note:[CAT1[v.cat],fmtD(v.data),money(v.quota),v.nota].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    const nuovo=!editing;
    let id=editing,old=null;
    if(editing){old=docOf(items.find(i=>i.id===editing)||{});await updateDoc(doc(db,'sections',SEC,'items',editing),data)}
    else id=(await addDoc(col,{...data,by:uid,at:serverTimestamp()})).id;
    if(file){
      try{
        const fid=await arch.save(file,{evento:id,ruolo:'doc',fb:true},p=>{er.textContent='Caricamento del documento '+p+'%'});
        await updateDoc(doc(db,'sections',SEC,'items',id),{docId:fid});
        if(old)await arch.remove(old).catch(()=>{});
        if(file.size>MAXB)alert('Il documento supera 20 MB: è salvato solo su Telegram e gli atleti senza Telegram non potranno aprirlo.')
      }catch(e){console.error(e);er.textContent='Evento salvato, ma il documento non è stato caricato ('+arch.errText(e)+'). Riprova da Modifica.';$('#sv').disabled=false;editing=id;return}}
    else if(old&&$('#rmd').checked){await arch.remove(old).catch(()=>{});await updateDoc(doc(db,'sections',SEC,'items',id),{docId:''})}
    resetForm(false);
    /* nuovo evento creato dall'admin: notifica Telegram agli atleti (se un operatore crea l'evento, parte alla prossima apertura della Home da admin) */
    if(nuovo&&isAdmin())import('./notifiche-motore.js').then(m=>m.sincronizza(db,{solo:['evento']})).catch(e=>console.warn('Notifica evento:',e&&e.message));
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}

/* ---------- iscrizioni e bonifici (Firebase: raccolta "iscrizioni", un documento per atleta e per evento) ---------- */
async function patchIsc(ev,p){
  const id=ev.id+'_'+uid,ref=fdoc(db,'iscrizioni',id),ex=iscr.find(r=>r.id===id);
  if(ex){await fupd(ref,p);Object.assign(ex,p)}
  else{const rec={evento:ev.id,uid,nome:meName(),...p};await fset(ref,{...rec,at:fts()});iscr.push({id,...rec})}
  paintDetail();renderList()}
async function patchVerif(r){const v=!r.pagatoOk;await fupd(fdoc(db,'iscrizioni',r.id),{pagatoOk:v});r.pagatoOk=v;paintDetail()}
async function patchEv(ev,p){await updateDoc(doc(db,'sections',SEC,'items',ev.id),p);Object.assign(ev,p);paintDetail();renderList()}

function openFile(f){
  showPreview({title:f.title,mime:f.mime,load:say=>arch.getBlob(f,say),errText:e=>'Impossibile aprire il file: '+arch.errText(e)})}
function openBon(r,f){
  showPreview({title:f.nome,mime:f.mime,errText:e=>'Impossibile aprire il file ('+(e&&e.message==='EMPTY'?'non trovato':'errore di lettura')+').',
    load:async say=>{
      say('Preparazione del file…');
      const s=await fget(fcol(db,'iscrizioni',r.id,'chunks')),
        parts=s.docs.map(d=>d.data()).filter(x=>x.f===f.id).sort((a,b)=>a.i-b.i).map(x=>x.data.toUint8Array());
      if(!parts.length)throw new Error('EMPTY');
      return new Blob(parts,{type:guessMime(f.nome,f.mime)})}})}
async function delChunks(rid,f){await Promise.all(Array.from({length:f.n||1},(_,k)=>fdel(fdoc(db,'iscrizioni',rid,'chunks',f.id+'k'+k)).catch(()=>{})))}

async function uploadBonifico(ev,file){
  if(!file)return;
  if(file.size>MAXB){alert('“'+file.name+'” supera il limite di 20 MB.');return}
  const r=myIsc(ev.id);if(!r||r.partecipa!=='si'){alert('Prima indica che partecipi.');return}
  const fid=newId(),n=Math.max(1,Math.ceil(file.size/CH)),meta={id:fid,nome:file.name,size:file.size,mime:file.type||'',n,t:Date.now()};
  upMsg='Caricamento in corso…';paintDetail();
  try{
    for(let k=0;k<n;k++){
      const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());
      await fset(fdoc(db,'iscrizioni',r.id,'chunks',fid+'k'+k),{f:fid,i:k,data:Bytes.fromUint8Array(buf)});
      upMsg='Caricamento '+Math.round((k+1)/n*100)+'%';const e=$('#upm');if(e)e.textContent=upMsg}
    await fupd(fdoc(db,'iscrizioni',r.id),{bonifici:arrayUnion(meta)});
    r.bonifici=[...(r.bonifici||[]),meta];upMsg='Copia del bonifico caricata.'}
  catch(e){console.error(e);await delChunks(r.id,meta);upMsg='Caricamento non riuscito'+(e&&e.code==='permission-denied'?' (permessi: l’admin deve pubblicare le regole di Firestore aggiornate)':'')+'.'}
  paintDetail();setTimeout(()=>{upMsg='';paintDetail()},6000)}

/* chiusura dell'evento senza eliminarlo (sold out, iscrizioni complete…) */
function openChiudi(ev){
  const body=`<p class="mu" style="margin:6px 0">L’evento resta in elenco con i dati delle iscrizioni, ma gli atleti non possono più iscriversi o cambiare risposta. Puoi riaprirlo quando vuoi.</p>
    <label for="cmo">Motivo</label><select id="cmo">${MOTIVI.map(m=>`<option>${m}</option>`).join('')}</select>
    <label for="cmt">Dettaglio (facoltativo)</label><input id="cmt" type="text" autocomplete="off">`;
  modal('Chiudi le iscrizioni',body,{ok:'Chiudi le iscrizioni',onSave:async o=>{
    const m=o.querySelector('#cmo').value,t=o.querySelector('#cmt').value.trim();
    await patchEv(ev,{chiuso:true,chiusoMotivo:m+(t?': '+t:'')})}})}

/* ---------- scheda di dettaglio ---------- */
function openDetail(id){
  if(!items.find(x=>x.id===id))return;
  const o=document.createElement('div');o.className='ov';
  o.innerHTML='<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda evento"></div>';
  const close=()=>{o.remove();detail=null;upMsg='';document.removeEventListener('keydown',kd)};
  const kd=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',kd);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.firstElementChild.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b||!detail)return;
    const ev=items.find(x=>x.id===detail.id);if(!ev)return;
    const a=b.dataset.a,i=b.dataset.i,s=b.dataset.s;
    try{
      if(a==='x')close();
      else if(a==='pay')openPay();
      else if(a==='doc'){const d=docOf(ev);if(d)openFile(d)}
      else if(a==='si'||a==='no'){if(!chiusa(ev))await patchIsc(ev,{partecipa:a})}
      else if(a==='pw'){
        const v=(o.querySelector('#pw').value||'').trim().replace(',','.');
        if(!/^\d{2,3}(\.\d{1,2})?$/.test(v)){alert('Indica il peso in chilogrammi (es. 66 oppure 66,5).');return}
        if(!chiusa(ev))await patchIsc(ev,{peso:v})}
      else if(a==='ob'){const r=iscr.find(x=>x.id===s),f=r&&bonificiOf(r).find(x=>x.id===i);if(f)openBon(r,f)}
      else if(a==='rmf'){
        const r=myIsc(ev.id),f=r&&bonificiOf(r).find(x=>x.id===i);
        if(f&&confirm('Togliere questa copia del bonifico?')){
          await delChunks(r.id,f);const list=(r.bonifici||[]).filter(x=>x.id!==i);await fupd(fdoc(db,'iscrizioni',r.id),{bonifici:list});r.bonifici=list;paintDetail()}}
      else if(a==='vf'){const r=iscr.find(x=>x.id===i);if(r&&isAdmin())await patchVerif(r)}
      else if(a==='csv')csv(ev);
      else if(a==='chiudi'&&isAdmin())openChiudi(ev);
      else if(a==='apri'&&isAdmin())await patchEv(ev,{chiuso:false,chiusoMotivo:''});
      else if(a==='edit'&&isAdmin()){close();edit(ev)}
      else if(a==='del'&&isAdmin()){
        if(!confirm('Eliminare “'+ev.nome+'”? L’evento e i suoi file vanno nel Cestino (30 giorni), ma le iscrizioni e i bonifici caricati vengono cancellati subito e non si recuperano. Se vuoi solo fermare le iscrizioni usa “Chiudi iscrizioni”.'))return;
        for(const r of iscOf(ev.id)){try{for(const f of bonificiOf(r))await delChunks(r.id,f);await fdel(fdoc(db,'iscrizioni',r.id))}catch(x){console.error(x)}}
        for(const it of items.filter(x=>x.evento===ev.id)){try{await arch.remove(it)}catch(x){console.error(x)}}
        await deleteDoc(doc(db,'sections',SEC,'items',ev.id));if(editing===ev.id)resetForm(false);close()}
    }catch(x){console.error(x);alert('Operazione non riuscita. Controlla la connessione e i permessi'+(x&&x.code==='permission-denied'?' (l’admin deve pubblicare le regole di Firestore aggiornate)':'')+'.')}});
  detail={id,o};document.body.append(o);paintDetail();
  o.querySelector('[data-a="x"]').focus()}

/* senza risposta = account con accesso a Eventi che non hanno ancora risposto (solo l'admin può leggere l'elenco account) */
const senzaRisposta=ev=>users.filter(u=>!u.admin&&['r','w'].includes((u.perms||{})[SEC])&&!iscOf(ev.id).some(r=>r.uid===u.id));

function paintDetail(){
  if(!detail||!document.body.contains(detail.o))return;
  const ev=items.find(x=>x.id===detail.id);
  if(!ev||ev.kind!=='evento'){detail.o.remove();detail=null;return}
  const c=detail.o.firstElementChild,adm=isAdmin(),gara=ev.cat==='gara',closed=chiusa(ev),past=isPast(ev);
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v!==''&&v!=null?v:'<span class="mu">—</span>'}</dd>`;
  const d=docOf(ev),my=myIsc(ev.id),mf=bonificiOf(my);
  const sr=isD(ev.scadReg)?esc(fmtD(ev.scadReg))+' '+(ev.chiuso?'':dlWarn(ev.scadReg)):'';
  const info=`<dl>${dd('Categoria',esc(CAT1[ev.cat]||ev.cat))}${dd('Data',isD(ev.data)?esc(fmtD(ev.data)):'')}${dd('Scadenza registrazione',sr)}${ev.hotel?dd('Hotel: scadenza registrazione',isD(ev.scadHotel)?esc(fmtD(ev.scadHotel))+' '+(ev.chiuso?'':dlWarn(ev.scadHotel)):'<span class="mu">da definire</span>'):''}${dd('Quota',esc(money(ev.quota)))}${dd('Documento',d?`<button class="btn ghost sm" data-a="doc">${esc(d.title)}</button>`:'')}</dl>${ev.nota?`<h3>Nota per gli atleti</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem">${esc(ev.nota)}</div>`:''}`;
  /* parte dell'atleta */
  const si=my&&my.partecipa==='si',no=my&&my.partecipa==='no';
  let mine=`<h3>La tua partecipazione</h3>${closed?`<div class="mu">${esc(motivoChiusura(ev))}.</div>`:''}
    <div class="sel"><button class="btn ${si?'':'ghost'}" data-a="si" aria-pressed="${!!si}" ${closed?'disabled':''}>Partecipo</button><button class="btn ${no?'':'ghost'}" data-a="no" aria-pressed="${!!no}" ${closed?'disabled':''}>Non partecipo</button></div>`;
  if(gara&&si)mine+=`<label for="pw">Peso previsto per la gara (kg)</label><div class="fr"><input id="pw" type="text" inputmode="decimal" autocomplete="off" value="${esc(my.peso||'')}" ${closed?'disabled':''}><button class="btn sm" data-a="pw" ${closed?'disabled':''}>Salva peso</button></div>${my.peso?'':'<div class="err">Manca il peso previsto.</div>'}`;
  if(si)mine+=`<h3>Pagamento${money(ev.quota)?' · '+esc(money(ev.quota)):''}<button class="btn ghost sm" data-a="pay">Come pagare</button></h3>
    ${mf.length?mf.map(f=>`<div class="fr"><button class="btn ghost sm" data-a="ob" data-i="${esc(f.id)}" data-s="${esc(my.id)}">${esc(f.nome)}</button>${my.pagatoOk?'<span class="chip ok">verificato</span>':`<button class="xb" data-a="rmf" data-i="${esc(f.id)}" aria-label="Togli questa copia">✕</button>`}</div>`).join(''):'<div class="mu">Nessuna copia del bonifico caricata.</div>'}
    <label for="bf">Carica la copia del bonifico (immagine o PDF, max 20 MB)</label><input id="bf" type="file" accept="image/*,application/pdf"><div class="mu" id="upm" style="margin-top:4px">${esc(upMsg)}</div>`;
  /* resoconto per l'admin */
  let rep='';
  if(adm){
    const all=iscOf(ev.id).sort((a,b)=>(a.nome||'').localeCompare(b.nome||'','it')),yes=all.filter(r=>r.partecipa==='si'),nos=all.filter(r=>r.partecipa==='no'),sen=senzaRisposta(ev);
    const paid=yes.filter(r=>bonificiOf(r).length).length,ok=yes.filter(r=>r.pagatoOk).length,att=parseFloat(ev.quota)>0?money(parseFloat(ev.quota)*yes.length):'';
    rep=`<h3>Resoconto iscritti<button class="btn ghost sm" data-a="csv">Scarica CSV</button></h3>
      <div class="kpi"><span>✔ Partecipano: <b>${yes.length}</b></span><span>✖ Non partecipano: <b>${nos.length}</b></span>${users.length?`<span>… Senza risposta: <b>${sen.length}</b></span>`:''}${ev.quota?`<span>Bonifici caricati: <b>${paid}/${yes.length}</b></span><span>Verificati: <b>${ok}/${yes.length}</b></span>`:''}${att?`<span>Quota attesa: <b>${esc(att)}</b></span>`:''}</div>
      ${yes.length?yes.map(r=>{const bs=bonificiOf(r);return `<div class="ir"><div class="l1"><b>${esc(r.nome||'—')}</b>${gara?(r.peso?`<span class="chip">${esc(r.peso)} kg</span>`:'<span class="chip bad">peso mancante</span>'):''}</div><div class="l2">${bs.length?bs.map((f,k)=>`<button class="btn ghost sm" data-a="ob" data-i="${esc(f.id)}" data-s="${esc(r.id)}">Bonifico${bs.length>1?' '+(k+1):''}</button>`).join(''):(ev.quota?'<span class="chip warn">nessun bonifico</span>':'')}${ev.quota?`<button class="btn sm ${r.pagatoOk?'':'ghost'}" data-a="vf" data-i="${esc(r.id)}" aria-pressed="${!!r.pagatoOk}">${r.pagatoOk?'✔ Pagamento verificato':'Segna come verificato'}</button>`:''}</div></div>`}).join(''):'<div class="mu">Nessun atleta iscritto.</div>'}
      ${nos.length?`<div class="mu" style="margin-top:8px"><b>Non partecipano:</b> ${esc(nos.map(r=>r.nome||'—').join(', '))}</div>`:''}
      ${sen.length?`<div class="mu" style="margin-top:6px"><b>Senza risposta:</b> ${esc(sen.map(u=>u.name||u.email).join(', '))}</div>`:''}`}
  c.innerHTML=`<h2 style="margin:0">${esc(ev.nome)}</h2>
    <div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px"><span class="chip">${esc(CAT1[ev.cat]||'')}</span>${past?'<span class="chip">Concluso</span>':''}${ev.chiuso?`<span class="chip bad">Chiuso${ev.chiusoMotivo?': '+esc(ev.chiusoMotivo):''}</span>`:''}</div>
    ${info}${mine}${rep}
    <div class="dact">${adm?`<button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="edit">Modifica</button>${past?'':ev.chiuso?'<button class="btn ghost" data-a="apri">Riapri iscrizioni</button>':'<button class="btn ghost" data-a="chiudi">Chiudi iscrizioni</button>'}`:''}<button class="btn" data-a="x">Chiudi</button></div>`;
  const bf=c.querySelector('#bf');if(bf)bf.onchange=()=>{const f=bf.files[0];bf.value='';uploadBonifico(ev,f)}}

function csv(ev){
  const rows=[['Nome','Partecipa','Peso previsto (kg)','Bonifico caricato','Pagamento verificato']];
  iscOf(ev.id).sort((a,b)=>(a.nome||'').localeCompare(b.nome||'','it')).forEach(r=>rows.push([r.nome||'',r.partecipa==='si'?'Sì':r.partecipa==='no'?'No':'',r.peso||'',bonificiOf(r).length?'Sì':'No',r.pagatoOk?'Sì':'No']));
  senzaRisposta(ev).forEach(u=>rows.push([u.name||u.email||'','Senza risposta','','','']));
  const t='\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  saveBlob(new Blob([t],{type:'text/csv;charset=utf-8'}),'Iscritti - '+ev.nome.replace(/[\\/:*?"<>|]/g,' ')+'.csv')}

/* ---------- elenco ---------- */
function renderList(){
  const ls=$('#ls');if(!ls)return;
  const all=evs(),t=q.trim().toLowerCase(),adm=isAdmin();
  /* si mostrano solo le categorie che hanno eventi */
  const present=Object.keys(CATS).filter(k=>all.some(e=>e.cat===k));
  if(cat!=='all'&&!present.includes(cat))cat='all';
  const tabs=all.length?`<div class="tabs" role="group" aria-label="Categorie">${[['all','Tutti',all.length],...present.map(k=>[k,CATS[k],all.filter(e=>e.cat===k).length])].map(([k,l,n])=>`<button data-tab="${k}" aria-pressed="${cat===k}">${l} (${n})</button>`).join('')}</div>`:'';
  const hay=e=>[e.nome,CAT1[e.cat],e.nota,fmtD(e.data),e.quota,e.chiusoMotivo].filter(Boolean).join(' ').toLowerCase();
  const list=all.filter(e=>(cat==='all'||e.cat===cat)&&(!t||hay(e).includes(t)));
  const up=list.filter(e=>!isPast(e)).sort((a,b)=>(a.data||'').localeCompare(b.data||'')),pa=list.filter(isPast).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const row=e=>{
    const my=myIsc(e.id),n=iscOf(e.id).filter(r=>r.partecipa==='si').length;
    let st='';
    if(my&&my.partecipa==='si')st=`<span class="chip ok">Partecipo</span>`;
    else if(my&&my.partecipa==='no')st=`<span class="chip">Non partecipo</span>`;
    else if(!chiusa(e)&&!adm)st='<span class="chip warn">Da rispondere</span>';
    const dl=e.chiuso?`<span class="chip bad">Chiuso${e.chiusoMotivo?': '+esc(e.chiusoMotivo):''}</span>`:isPast(e)?'':dlChip('Iscrizione',e.scadReg)+(e.hotel?dlChip('Hotel',e.scadHotel):'');
    return `<button class="tr${isPast(e)?' past':''}${e.chiuso?' off':''}${urgente(e)?' alarm':''}" data-id="${esc(e.id)}" aria-label="Apri ${esc(e.nome)}"><div class="inf"><div><b>${esc(e.nome)}</b></div><div class="mu">${esc(CAT1[e.cat]||'')} · ${esc(fmtD(e.data))}${money(e.quota)?' · '+esc(money(e.quota)):''}</div></div><div class="chips">${st}${dl}${adm?`<span class="chip">${n} iscritt${n===1?'o':'i'}</span>`:''}</div></button>`};
  ls.innerHTML=tabs+(list.length?(up.map(row).join('')+(pa.length?`<div class="sep">Passati</div>`+pa.map(row).join(''):'')):`<div class="mu" style="padding:8px 0">${all.length?'Nessun risultato.':'Nessun evento in programma.'+(adm?' Crea il primo con “+ Nuovo evento”.':'')}</div>`);
  paintDetail()}

/* elenco degli account, per sapere chi non ha ancora risposto (lo può leggere solo l'admin) */
async function loadUsers(){
  if(!isAdmin()||users.length)return;
  try{const s=await getDocs(collection(db,'users'));users=s.docs.map(d=>({id:d.id,...d.data()}));renderList()}catch(e){console.error(e)}}

/* iscrizioni: l'admin le legge tutte, l'atleta solo le proprie */
function listenIscr(){
  const base=fcol(db,'iscrizioni');
  unsubs.push(fon(isAdmin()?base:query(base,where('uid','==',uid)),s=>{iscr=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},e=>console.error('iscrizioni',e)))}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),isAdmin());
      if(shellFor!==perm()+(isAdmin()?'a':''))shell();
      if(!started){
        started=true;
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
        unsubs.push(onSnapshot(doc(db,'sections',SEC,'meta','pagamenti'),s=>{pay=s.exists()?(s.data().text||''):''},()=>{}));
        listenIscr()}
      loadUsers();renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
