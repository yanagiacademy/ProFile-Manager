/* Richieste da approvare (solo admin): tutto quello che atleti e tecnici hanno caricato o proposto.
   - Modifiche ai dati (atletiModifiche): ogni campo con valore PRIMA e DOPO, da accettare o rifiutare uno per uno.
   - File (tessera, certificato medico, tesserino) con anteprima: si accetta o si rifiuta il file, e ogni campo che lo accompagna.
   Accettare significa scrivere nella scheda vera (Atleti, Tecnici, Tessere); rifiutare scarta soltanto la richiesta. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,serverTimestamp} from "./fsx.js";
import {doc as rdoc,collection as rcol,onSnapshot as ronSnap,updateDoc as rupdate,deleteDoc as rdelete,setDoc as rset,deleteField} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio} from "./archivio.js";
import {showPreview,saveBlob} from "./file-tools.js";
import {isD,fmtD,addCad,ultimoTest} from "./atleti-scadenze.js";
import {archiviaFile} from "./conservazione.js";
import {ETICHETTE,TIPO_RICH,POSTO,ATL_EDIT,TEC_EDIT,valTxt,uguali,blobRichiesta,eliminaRichiesta,syncTesserini} from "./richieste.js";
import {tesName,rigaBreve} from "./tesserini.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

let auth,db,uid=null,me=null,atl=[],tec=[],tess=[],mods={},rich=[],unsubs=[],arch=null,tessErr=false,persErr=false,busy=false,scrolled=false,reg=[];
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';
const TIPO={agonista:'Agonista',dilettante:'Dilettante'};
const noteAtl=v=>[v.grado,v.categoria,v.peso&&v.peso+' kg',TIPO[v.tipo],v.allenatore,v.obiettivi,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300);
const noteTec=v=>[v.cf,v.info,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300);
const datiOf=(o,defs)=>{const r={};defs.forEach(([k])=>r[k]=String((o&&o[k])??'').trim());if(defs===ATL_EDIT){r.medaglie=Array.isArray(o&&o.medaglie)?o.medaglie:[];r.test=Array.isArray(o&&o.test)?o.test:[]}return r};
const uidn=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const quando=t=>t&&t.toDate?t.toDate().toLocaleString('it-IT',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'';
const kb=n=>n>=1048576?(n/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(n/1024))+' KB';

/* la persona (atleta o tecnico) a cui si riferisce l'id */
function pers(id){
  const a=atl.find(x=>x.id===id);if(a)return {p:a,ruolo:'atleta',sec:'atleti'};
  const t=tec.find(x=>x.id===id);if(t)return {p:t,ruolo:'tecnico',sec:'tecnici'};
  return null}
const tessOf=id=>tess.find(x=>x.kind==='tessera'&&x.atleta===id)||null;
const reqs=id=>rich.filter(r=>r.soggetto===id);
/* campi di una proposta che davvero cambiano qualcosa (se coincidono già con la scheda non c'è niente da decidere) */
const modKeys=id=>{const m=mods[id],P=pers(id);if(!m||!m.campi)return [];return Object.keys(m.campi).filter(k=>!P||!uguali(k,m.campi[k],P.p[k]))};

/* ---------- registro delle decisioni: sezione «Richieste» (argomento Telegram omonimo) ---------- */
async function registra(P,e){
  try{
    const nm=P?nameOf(P.p):'Persona non più in elenco',acc=e.esito==='accettato';
    await addDoc(collection(db,'sections','richieste','items'),{kind:'esito',ts:Date.now(),persona:nm,ruolo:P?P.ruolo:'',tipo:e.tipo,campo:e.campo||'',prima:e.prima||'',dopo:e.dopo||'',file:e.file||'',esito:e.esito,by:uid,
      title:(acc?'Accettato':'Rifiutato')+' · '+nm+' · '+(e.campo||(e.file?'file '+e.file:(TIPO_RICH[e.tipo]||''))),
      note:[TIPO_RICH[e.tipo]||'Dati personali',e.campo&&((e.prima||'vuoto')+' → '+(e.dopo||'vuoto'))].filter(Boolean).join(' · ').slice(0,300),at:serverTimestamp()})
  }catch(x){console.warn('Registro delle richieste non scritto:',x&&x.message)}}   /* il registro non deve mai bloccare la decisione */

/* ---------- applicare ---------- */
async function risolviDati(id,keys,accetta){
  const m=mods[id],P=pers(id);if(!m)return;
  if(accetta){
    if(!P)throw new Error('La persona non è più in elenco.');
    const upd={};keys.forEach(k=>{let v=String(m.campi[k]??'').trim();if(k==='peso')v=v.replace(',','.');upd[k]=v});
    for(const k of keys)await registra(P,{tipo:'dati',campo:ETICHETTE[k]||k,prima:valTxt(k,P.p[k]),dopo:valTxt(k,m.campi[k]),esito:'accettato'});
    const merged={...P.p,...upd};
    upd.title=(merged.cognome||'')+' '+(merged.nome||'');upd.note=P.ruolo==='atleta'?noteAtl(merged):noteTec(merged);
    await updateDoc(doc(db,'sections',P.sec,'items',id),upd);
    await rset(rdoc(db,'atletiDati',id),datiOf(merged,P.ruolo==='atleta'?ATL_EDIT:TEC_EDIT))}
  else for(const k of keys)await registra(P,{tipo:'dati',campo:ETICHETTE[k]||k,prima:valTxt(k,P?P.p[k]:''),dopo:valTxt(k,m.campi[k]),esito:'rifiutato'});
  const resto=Object.keys(m.campi).filter(k=>!keys.includes(k));
  if(!resto.length)await rdelete(rdoc(db,'atletiModifiche',id));
  else await rupdate(rdoc(db,'atletiModifiche',id),Object.fromEntries(keys.map(k=>['campi.'+k,deleteField()])))}

async function ensureTessera(r,P){
  if(tessOf(r.soggetto))return r.soggetto;
  await setDoc(doc(db,'sections','tessere','items',r.soggetto),{kind:'tessera',atleta:r.soggetto,soggetto:P.ruolo,nome:P.p.nome||'',cognome:P.p.cognome||'',title:nameOf(P.p),note:'',fb:true,by:uid,at:serverTimestamp()});
  return r.soggetto}
async function ensureTesserino(r,P){
  if(r.tes&&tess.some(x=>x.id===r.tes&&x.kind==='tesserino'))return r.tes;
  const d=await addDoc(collection(db,'sections','tessere','items'),{kind:'tesserino',tecnico:r.soggetto,nome:P.p.nome||'',cognome:P.p.cognome||'',title:'Tesserino · '+nameOf(P.p),albo:'',altraNome:'',righe:[],ente:'',numero:'',emissione:'',scadenza:'',nota:'',fb:true,note:'',by:uid,at:serverTimestamp()});
  await rupdate(rdoc(db,'richieste',r.id),{tes:d.id});r.tes=d.id;return d.id}
const noteTes=(m,nm)=>({title:tesName(m)+' · '+nm,note:[tesName(m),(m.righe||[]).map(rigaBreve).join(', '),m.ente,m.numero&&'n. '+m.numero].filter(Boolean).join(' · ').slice(0,300)});
const noteTessera=m=>[m.ente,m.tipoTessera,m.numero&&'n. '+m.numero,m.associazione,isD(m.scadenza)&&'scade '+fmtD(m.scadenza)].filter(Boolean).join(' · ').slice(0,300);

/* tolta una parte della richiesta (campi o file): se non resta niente, la richiesta sparisce */
async function chiudiSeVuota(id){
  const r=rich.find(x=>x.id===id);if(!r)return;
  if(!r.file&&!Object.keys(r.campi||{}).length)await eliminaRichiesta(db,id,0)}
async function risolviCampi(id,keys,accetta){
  const r=rich.find(x=>x.id===id);if(!r)return;const P=pers(r.soggetto);
  for(const k of keys)await registra(P,{tipo:r.tipo,campo:ETICHETTE[k]||k,prima:valTxt(k,prima(r,k)),dopo:valTxt(k,r.campi[k]),esito:accetta?'accettato':'rifiutato'});
  if(accetta){
    if(!P)throw new Error('La persona non è più in elenco.');
    const upd={};keys.forEach(k=>upd[k]=r.campi[k]);
    if(r.tipo==='tesserino'){
      const tid=await ensureTesserino(r,P),z=tess.find(x=>x.id===tid)||{};
      Object.assign(upd,noteTes({...z,...upd},nameOf(P.p)));
      await updateDoc(doc(db,'sections','tessere','items',tid),upd)}
    else{
      const tid=await ensureTessera(r,P),t=tessOf(tid)||{};
      upd.note=noteTessera({...t,...upd});
      await updateDoc(doc(db,'sections','tessere','items',tid),upd)}}
  r.campi=Object.fromEntries(Object.entries(r.campi).filter(([k])=>!keys.includes(k)));
  await rupdate(rdoc(db,'richieste',id),Object.fromEntries(keys.map(k=>['campi.'+k,deleteField()])));
  await chiudiSeVuota(id)}
async function togliFile(r){
  for(let k=0;k<((r.file||{}).chunks||0);k++)await rdelete(rdoc(db,'richieste',r.id,'chunks','c'+k)).catch(()=>{});
  await rupdate(rdoc(db,'richieste',r.id),{file:deleteField()});r.file=null;
  await chiudiSeVuota(r.id)}
async function accettaFile(id){
  const r=rich.find(x=>x.id===id);if(!r||!r.file)return false;const P=pers(r.soggetto);
  if(!P)throw new Error('La persona non è più in elenco.');
  if(arch.needsTelegram()){
    if(confirm('I file vengono salvati su Telegram (con copia su Firebase): prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  const blob=await blobRichiesta(db,r),file=new File([blob],r.file.nome,{type:blob.type}),nm=nameOf(P.p);
  let recId,campo,extra,tipoArch;
  if(r.tipo==='tesserino'){recId=await ensureTesserino(r,P);campo='tesFile';extra={tesTec:r.soggetto,ruolo:'tesserino',fb:true};tipoArch='Tesserini'}
  else{recId=await ensureTessera(r,P);const t=r.tipo==='tessera';campo=t?'tesFile':'certFile';extra={tesAtl:r.soggetto,ruolo:t?'tessera':'certificato',fb:true};tipoArch=t?'Tessere':'Certificati medici'}
  const rec=tess.find(x=>x.id===recId)||{},old=tess.find(x=>x.kind==='file'&&x.id===rec[campo]);
  const fid=await arch.save(file,extra);
  await updateDoc(doc(db,'sections','tessere','items',recId),{[campo]:fid});
  if(old)await archiviaFile(db,old,'tessere',{tipo:tipoArch,origine:'Tessere / '+nm,note:nm+' · '+TIPO_RICH[r.tipo],motivo:'sostituito da un file caricato dalla persona'});
  await registra(P,{tipo:r.tipo,file:r.file.nome,esito:'accettato'});
  await togliFile(r);return true}

/* medaglia o rilevazione di test inviata dall'atleta: una voce intera, che si aggiunge alla scheda dell'atleta */
const vociTxt=r=>r.tipo==='medaglia'?[r.campi.data&&fmtD(r.campi.data),r.campi.gara,POSTO[r.campi.posto]||r.campi.posto].filter(Boolean).join(' · '):[r.campi.data&&fmtD(r.campi.data),(r.campi.righe||[]).map(x=>x.n+': '+x.v).join(' · ')].filter(Boolean).join(' — ');
async function accettaVoce(id){
  const r=rich.find(x=>x.id===id);if(!r)return;const P=pers(r.soggetto);
  if(!P||P.ruolo!=='atleta')throw new Error('L’atleta non è più in elenco.');
  const it=P.p,upd={};
  if(r.tipo==='medaglia')upd.medaglie=[...(it.medaglie||[]),{id:uidn(),data:isD(r.campi.data)?r.campi.data:'',gara:r.campi.gara||'',posto:r.campi.posto||'P'}];
  else{
    const rr=(r.campi.righe||[]).map(x=>({n:x.n,v:x.v})).filter(x=>x.n&&x.v);
    upd.test=[...(it.test||[]),{id:uidn(),data:r.campi.data,r:rr}];
    if(it.testTipi&&it.testTipi.length)upd.testTipi=[...new Set([...it.testTipi,...rr.map(x=>x.n)])];
    /* come in Atleti: dopo una rilevazione la data alert si ricalcola (ultimo test + cadenza) */
    const last=ultimoTest({...it,...upd});
    if(isD(last)){if(+it.cadN>0)upd.prossimo=addCad(last,+it.cadN,it.cadU||'m');else if(isD(it.prossimo)&&it.prossimo<=last)upd.prossimo=''}}
  await updateDoc(doc(db,'sections','atleti','items',it.id),upd);
  await rset(rdoc(db,'atletiDati',it.id),datiOf({...it,...upd},ATL_EDIT));
  await registra(P,{tipo:r.tipo,campo:TIPO_RICH[r.tipo],dopo:vociTxt(r),esito:'accettato'});
  await eliminaRichiesta(db,id,0)}
async function azione(d){
  const {a,t,id,k}=d;
  if(t==='d'){
    const keys=k?[k]:modKeys(id);
    if(a==='ok'||a==='okAll')await risolviDati(id,keys,true);
    else if(a==='no'||a==='noAll'){if(!k&&!confirm('Rifiutare tutte le modifiche proposte?'))return;await risolviDati(id,keys,false)}
    else if(a==='drop'){await rdelete(rdoc(db,'atletiModifiche',id))}
    return}
  const r=rich.find(x=>x.id===id);if(!r)return;
  if(r.tipo==='medaglia'||r.tipo==='test'){
    if(a==='vok'||a==='okAll')await accettaVoce(id);
    else if(a==='vno'||a==='noAll'){if(confirm('Rifiutare questa voce?')){await registra(pers(r.soggetto),{tipo:r.tipo,campo:TIPO_RICH[r.tipo],dopo:vociTxt(r),esito:'rifiutato'});await eliminaRichiesta(db,id,0)}}
    return}
  if(a==='ok'||a==='no')await risolviCampi(id,[k],a==='ok');
  else if(a==='fok'){await accettaFile(id)}
  else if(a==='fno'){if(confirm('Rifiutare il file? Viene scartato e non resta da nessuna parte.')){await registra(pers(r.soggetto),{tipo:r.tipo,file:r.file.nome,esito:'rifiutato'});await togliFile(r)}}
  else if(a==='prev'&&r.file)showPreview({title:r.file.nome,mime:r.file.mime,load:()=>blobRichiesta(db,r),errText:()=>'Impossibile aprire il file.'});
  else if(a==='dl'&&r.file)saveBlob(await blobRichiesta(db,r),r.file.nome);
  else if(a==='okAll'){
    if(r.file&&!(await accettaFile(id)))return;
    const r2=rich.find(x=>x.id===id);if(r2&&Object.keys(r2.campi||{}).length)await risolviCampi(id,Object.keys(r2.campi),true)}
  else if(a==='noAll'){if(confirm('Rifiutare tutta la richiesta (file e campi)?')){const P=pers(r.soggetto);if(r.file)await registra(P,{tipo:r.tipo,file:r.file.nome,esito:'rifiutato'});for(const k of Object.keys(r.campi||{}))await registra(P,{tipo:r.tipo,campo:ETICHETTE[k]||k,prima:valTxt(k,prima(r,k)),dopo:valTxt(k,r.campi[k]),esito:'rifiutato'});await eliminaRichiesta(db,id,(r.file||{}).chunks||0)}}}

/* ---------- pagina ---------- */
const prima=(r,k)=>{
  if(r.tipo==='tesserino'){const z=tess.find(x=>x.id===r.tes&&x.kind==='tesserino');return z?z[k]:''}
  const t=tessOf(r.soggetto);return t?t[k]:''};
const riga=(t,id,k,pr,dp)=>`<div class="fld"><div class="fl">${esc(ETICHETTE[k]||k)}</div>
  <div class="pd"><div><span class="mu">Prima</span><div>${pr?esc(pr):'<span class="mu">vuoto</span>'}</div></div><div class="ar" aria-hidden="true">→</div><div class="dp"><span class="mu">Dopo</span><div>${dp?esc(dp):'<span class="mu">vuoto</span>'}</div></div></div>
  <div class="dact"><button class="btn ghost sm" data-a="no" data-t="${t}" data-id="${esc(id)}" data-k="${esc(k)}">Rifiuta</button><button class="btn sm" data-a="ok" data-t="${t}" data-id="${esc(id)}" data-k="${esc(k)}">Accetta</button></div></div>`;
function datiHtml(id){
  const keys=modKeys(id),m=mods[id],P=pers(id);if(!keys.length)return '';
  return `<h3>Modifiche ai dati <span class="mu" style="font-weight:400;text-transform:none">${esc(quando(m.at))}</span></h3>
    ${keys.map(k=>riga('d',id,k,valTxt(k,P?P.p[k]:''),valTxt(k,m.campi[k]))).join('')}
    <div class="dact"><button class="btn ghost sm" data-a="noAll" data-t="d" data-id="${esc(id)}">Rifiuta tutto</button><button class="btn sm" data-a="okAll" data-t="d" data-id="${esc(id)}">Accetta tutto</button></div>`}
function richHtml(r){
  if(r.tipo==='medaglia'||r.tipo==='test'){
    const it=(pers(r.soggetto)||{}).p||{},n=r.tipo==='medaglia'?(it.medaglie||[]).length:(it.test||[]).length;
    return `<h3>${esc(r.tipo==='medaglia'?'Medagliere: nuova voce':'Test fisici: nuova rilevazione')} <span class="mu" style="font-weight:400;text-transform:none">${esc(quando(r.at))}</span></h3>
      <div class="fbox"><div class="mu">Si aggiunge a ${n} ${r.tipo==='medaglia'?'voci del medagliere':'rilevazioni già presenti'}.</div><div style="margin-top:4px;font-weight:700;white-space:pre-wrap">${esc(vociTxt(r))}</div>
      <div class="dact"><button class="btn ghost sm" data-a="vno" data-t="r" data-id="${esc(r.id)}">Rifiuta</button><button class="btn sm" data-a="vok" data-t="r" data-id="${esc(r.id)}">Accetta</button></div></div>`}
  const keys=Object.keys(r.campi||{}),f=r.file;
  const tit=r.tipo==='tesserino'?(r.tes&&tess.some(x=>x.id===r.tes)?'Tesserino: modifica':'Tesserino: nuovo'):TIPO_RICH[r.tipo];
  return `<h3>${esc(tit)} <span class="mu" style="font-weight:400;text-transform:none">${esc(quando(r.at))}</span></h3>
    ${f?`<div class="fbox"><b>File caricato</b><div class="mu">${esc(f.nome)} · ${kb(f.size)}</div><div class="fr"><button class="btn sm" data-a="prev" data-t="r" data-id="${esc(r.id)}">Anteprima</button><button class="btn ghost sm" data-a="dl" data-t="r" data-id="${esc(r.id)}">Scarica</button></div>
      <div class="mu" style="margin-top:6px">${r.tipo==='tesserino'?(prima(r,'tesFile')||(tess.find(x=>x.id===r.tes)||{}).tesFile?'Sostituisce il file attuale, che va in Archivio.':''):((tessOf(r.soggetto)||{})[r.tipo==='tessera'?'tesFile':'certFile']?'Sostituisce il file attuale, che va in Archivio.':'')}</div>
      <div class="dact"><button class="btn ghost sm" data-a="fno" data-t="r" data-id="${esc(r.id)}">Rifiuta il file</button><button class="btn sm" data-a="fok" data-t="r" data-id="${esc(r.id)}">Accetta il file</button></div></div>`:''}
    ${keys.map(k=>riga('r',r.id,k,valTxt(k,prima(r,k)),valTxt(k,r.campi[k]))).join('')}
    <div class="dact"><button class="btn ghost sm" data-a="noAll" data-t="r" data-id="${esc(r.id)}">Rifiuta tutto</button><button class="btn sm" data-a="okAll" data-t="r" data-id="${esc(r.id)}">Accetta tutto</button></div>`}
const regHtml=()=>{
  const l=reg.slice(0,40);if(!l.length)return '';
  return `<div class="card dl" style="margin-top:12px"><h2 style="margin:0">Registro delle decisioni</h2><div class="mu" style="margin:2px 0 6px">Salvato su Telegram, nell’argomento «Richieste».</div>${l.map(x=>`<div class="fld"><div><span class="chip ${x.esito==='accettato'?'ok':'bad'}">${x.esito==='accettato'?'Accettato':'Rifiutato'}</span> <b>${esc(x.persona||'')}</b> <span class="mu">${esc(new Date(x.ts||0).toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</span></div><div class="mu">${esc([TIPO_RICH[x.tipo]||'Dati personali',x.file&&'file '+x.file,x.campo&&(x.campo+(x.prima||x.dopo?': '+(x.prima||'vuoto')+' → '+(x.dopo||'vuoto'):''))].filter(Boolean).join(' · '))}</div></div>`).join('')}</div>`};
function render(){
  if(!me||!me.admin)return;
  const ids=[...new Set([...Object.keys(mods).filter(id=>(mods[id].campi&&Object.keys(mods[id].campi).length)),...rich.map(r=>r.soggetto)])];
  const sorted=ids.sort((a,b)=>{const pa=pers(a),pb=pers(b);return nameOf(pa?pa.p:{}).localeCompare(nameOf(pb?pb.p:{}),'it')});
  const n=sorted.filter(id=>modKeys(id).length||reqs(id).length).length;
  const cards=sorted.map(id=>{
    const P=pers(id),dh=datiHtml(id),rh=reqs(id).map(richHtml).join('');
    if(!dh&&!rh)return '';
    return `<div class="card dl" id="p_${esc(id)}" style="margin-bottom:12px"><h2 style="margin:0">${esc(P?nameOf(P.p):'Persona non più in elenco')}${P?`<span class="gr">${P.ruolo==='tecnico'?'Tecnico':'Atleta'}</span>`:''}</h2>
      ${P?'':'<div class="mu">La scheda è stata eliminata: si possono solo scartare le richieste.</div>'}${dh}${rh}</div>`}).join('');
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Richieste</h2><span class="badge">${n?n+(n===1?' persona da controllare':' persone da controllare'):'Niente da controllare'}</span></div></div>
  ${(tessErr||persErr)?'<div class="card" style="margin-bottom:12px"><b>Dati non completi</b><div class="mu">Non riesco a leggere atleti, tecnici o tessere: se i dati sono su Telegram, accedi dalla pagina <a href="chat.html">Chat</a> e riapri questa pagina prima di approvare.</div></div>':''}
  ${cards||'<div class="card"><div class="mu">Nessuna richiesta in attesa. Quando un atleta o un tecnico carica un file o propone una modifica, la trovi qui.</div></div>'}${regHtml()}</div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.onclick=async e=>{
    const b=e.target.closest('[data-a]');if(!b||busy)return;
    busy=true;document.querySelectorAll('[data-a]').forEach(x=>x.disabled=true);
    try{await azione(b.dataset)}catch(x){console.error(x);alert('Operazione non riuscita: '+((x&&x.message)||'controlla la connessione e che Telegram sia collegato, poi riprova.'))}
    finally{busy=false;render()}};
  if(!scrolled&&location.hash.length>1){const el=document.getElementById('p_'+decodeURIComponent(location.hash.slice(1)));if(el){scrolled=true;el.scrollIntoView({block:'start'})}}}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,'tessere',uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||!me.admin){app.innerHTML=box('Nessun accesso','Questa pagina è riservata all’admin.');return}
      if(unsubs.length>1){render();return}
      unsubs.push(ronSnap(rcol(db,'atletiModifiche'),s=>{mods={};s.docs.forEach(d=>mods[d.id]=d.data());if(!busy)render()},()=>{mods={}}));
      unsubs.push(ronSnap(rcol(db,'richieste'),s=>{rich=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.completa&&r.campi).sort((a,b)=>((a.at&&a.at.toMillis&&a.at.toMillis())||0)-((b.at&&b.at.toMillis&&b.at.toMillis())||0));if(!busy)render()},()=>{rich=[]}));
      unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()}));persErr=false;if(!busy)render()},()=>{atl=[];persErr=true;render()}));
      unsubs.push(onSnapshot(collection(db,'sections','tecnici','items'),s=>{tec=s.docs.map(d=>({id:d.id,...d.data()}));if(!busy)render()},()=>{tec=[]}));
      unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tess=s.docs.map(d=>({id:d.id,...d.data()}));tessErr=false;syncTesserini(db,tess,tec);if(!busy)render()},()=>{tess=[];tessErr=true;render()}));
      unsubs.push(onSnapshot(collection(db,'sections','richieste','items'),s=>{reg=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.kind==='esito').sort((a,b)=>(b.ts||0)-(a.ts||0));if(!busy)render()},()=>{reg=[]}));
      render()},()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
