/* Calendario (solo admin): programma degli allenamenti e degli eventi, e quello che gli atleti vedono sotto il saluto nella Home.
   • Routine frequenti (kind 'routine'): giorni della settimana + orario, per tutti gli atleti o per quelli scelti; si attivano/disattivano una per una.
   • Pausa generale delle routine (app/routine): per Natale, Pasqua, estate… con date «dal» e «fino al» facoltative; passata la data finale ripartono da sole.
   • Allenamenti straordinari (kind 'straordinario'): una data precisa, per tutti o per atleti scelti.
   • Eventi: arrivano dalla sezione Eventi (sola lettura qui, si gestiscono lì).
   Dati in sections/calendario/items (Telegram, argomento «Calendario», con copia fb:true su Firebase per far leggere gli atleti senza Telegram, come Eventi):
   ogni voce porta dest (id degli atleti scelti), destTutti e destUid (account), come in Eventi. Il calcolo del «prossimo» sta in calendario-core.js. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,getDocs,serverTimestamp,logEvento} from "./fsx.js";
import {collection as fcol,getDocs as fget} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {GIORNI,ORDINE,ETICHETTE,ymd,fmtGiorno,statoPausa,occorrenze,quando} from "./calendario-core.js";
import {gruppiHtml,gruppiBind} from "./gruppi-atleti.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='calendario';
let auth,db,col,me=null,items=[],evs=[],cfg=null,users=[],atl=[],mails={},mailsOk=false,unsubs=[],shell=false,vista='';
const isAdmin=()=>!!(me&&me.admin);
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
const msgErr=e=>String((e&&e.message)||e||'').indexOf('NO_SESSION')>=0?'Telegram non è collegato: apri la Chat e accedi, poi riprova.':'Salvataggio non riuscito. Controlla la connessione e l’accesso a Telegram (Chat), poi riprova.';

/* ---------- destinatari (come in Eventi): dest = id atleti scelti, destUid = i loro account ---------- */
const nomeAt=a=>[a.cognome,a.nome].filter(Boolean).join(' ')||a.title||'Atleta';
const emailsOf=ids=>ids.map(id=>String((mails[id]&&mails[id].email)||'').trim().toLowerCase()).filter(Boolean);
const persAcc=()=>users.filter(u=>u.comeAtleta).map(u=>({id:'u:'+u.id,title:u.name||u.email||'Account',acc:true}));
const tuttiAt=()=>[...atl,...persAcc()];
const isAcc=id=>String(id).startsWith('u:');
const accOfAt=id=>{if(isAcc(id))return users.filter(u=>u.id===String(id).slice(2));const e=emailsOf([id])[0];return e?users.filter(u=>!u.admin&&String(u.email||'').toLowerCase()===e):[]};
const uidsOf=ids=>{const em=emailsOf(ids.filter(i=>!isAcc(i))),dir=ids.filter(isAcc).map(i=>String(i).slice(2));return [...new Set([...users.filter(u=>!u.admin&&u.email&&em.includes(String(u.email).toLowerCase())).map(u=>u.id),...dir.filter(id=>users.some(u=>u.id===id))])]};
const destCampi=ids=>ids&&ids.length?{dest:ids,destTutti:false,destUid:uidsOf(ids)}:{dest:[],destTutti:true,destUid:[]};
const ristretto=i=>Array.isArray(i.dest)&&i.dest.length>0;
const nomiDest=i=>(i.dest||[]).map(id=>{const a=tuttiAt().find(x=>x.id===id);return a?nomeAt(a):'(atleta eliminato)'});
const destTxt=i=>ristretto(i)?nomiDest(i).join(', '):'Tutti gli atleti';
const visibileA=idAt=>i=>!idAt||!ristretto(i)||i.dest.includes(idAt);
async function collegamenti(){
  try{
    if(!users.length){const s=await getDocs(collection(db,'users'));users=s.docs.map(d=>({id:d.id,...d.data()}))}
    const m=await fget(fcol(db,'atletiMail'));mails={};m.docs.forEach(d=>mails[d.id]=d.data());mailsOk=true}
  catch(e){console.error(e)}}
/* se cambiano email o account collegati agli atleti scelti, si riallineano gli account che possono leggere la voce */
const tentDest=new Map();
function riallinea(){
  if(!users.length||!mailsOk)return;
  for(const i of items.filter(x=>ristretto(x))){
    const nu=uidsOf(i.dest).sort(),k=JSON.stringify(nu);
    if(k===JSON.stringify([...(i.destUid||[])].sort())||tentDest.get(i.id)===k)continue;
    tentDest.set(i.id,k);updateDoc(doc(db,'sections',SEC,'items',i.id),{destUid:nu}).catch(()=>tentDest.delete(i.id))}}

/* ---------- finestra di dialogo ---------- */
function modal(title,body,{ok='Salva',cancel='Annulla',onSave}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>${cancel}</button>${onSave?`<button class="btn" data-ok>${ok}</button>`:''}</div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  if(onSave)o.querySelector('[data-ok]').onclick=async()=>{er.textContent='';try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent=msgErr(x)}};
  document.body.append(o);return o}

/* scelta dei destinatari dentro un modulo */
function destHtml(i){
  const sc=ristretto(i||{});
  return `<label>Per chi</label><label class="ck"><input type="radio" name="dm" value="tutti" ${sc?'':'checked'}> Tutti gli atleti</label><label class="ck"><input type="radio" name="dm" value="scelti" ${sc?'checked':''}> Solo alcuni atleti</label>
  <div id="dsel" ${sc?'':'hidden'}>${gruppiHtml()}<input id="dq" type="search" placeholder="Cerca un atleta" aria-label="Cerca un atleta"><div class="dls" id="dls"></div><div class="mu" id="dn"></div></div>`}
function bindDest(o,sel){
  const q=()=>(o.querySelector('#dq').value||'').trim().toLowerCase();
  const paint=()=>{
    const l=o.querySelector('#dls'),box=o.querySelector('#dsel');box.hidden=(o.querySelector('input[name=dm]:checked')||{}).value!=='scelti';if(box.hidden)return;
    const v=tuttiAt().filter(a=>!q()||nomeAt(a).toLowerCase().includes(q())).sort((a,b)=>nomeAt(a).localeCompare(nomeAt(b),'it'));
    l.innerHTML=v.length?v.map(a=>`<label class="ck"><input type="checkbox" data-d="${esc(a.id)}" ${sel.has(a.id)?'checked':''}> <span>${esc(nomeAt(a))}${a.acc?' <span class="mu">· account</span>':accOfAt(a.id).length?'':' <span class="mu">· senza account collegato</span>'}</span></label>`).join(''):`<div class="mu" style="padding:8px 0">${tuttiAt().length?'Nessun atleta trovato.':'Elenco atleti non disponibile: apri una volta la sezione Atleti e riprova.'}</div>`;
    o.querySelector('#dn').textContent=sel.size?sel.size+(sel.size===1?' atleta scelto':' atleti scelti'):'Nessun atleta scelto'};
  o.addEventListener('change',e=>{
    if(e.target.name==='dm')paint();
    else if(e.target.dataset&&e.target.dataset.d){e.target.checked?sel.add(e.target.dataset.d):sel.delete(e.target.dataset.d);paint()}});
  o.querySelector('#dq').oninput=paint;
  gruppiBind(o.querySelector('#dsel'),{atleti:()=>atl,getSel:()=>sel,dopo:paint});paint()}
const destDaForm=(o,sel)=>(o.querySelector('input[name=dm]:checked')||{}).value==='scelti'?[...sel]:[];

/* ---------- modulo routine / straordinario ---------- */
function form(tipo,r){
  const rt=tipo==='routine',ex=r||{},sel=new Set(ex.dest||[]);
  const body=`<label for="ft">Titolo</label><input id="ft" type="text" maxlength="80" placeholder="${rt?'Es. Judo ragazzi':'Es. Allenamento extra pre-gara'}" value="${esc(ex.titolo||'')}">
  ${rt?`<label>Giorni della settimana</label><div class="dg" style="gap:8px 14px">${ORDINE.map(g=>`<label class="ck" style="padding:2px 0"><input type="checkbox" name="gg" value="${g}" ${(ex.giorni||[]).includes(g)?'checked':''}> ${GIORNI[g]}</label>`).join('')}</div>`
    :`<label for="fd">Data</label><input id="fd" type="date" value="${esc(ex.data||'')}">`}
  <div class="fr"><div><label for="fo">Dalle</label><input id="fo" type="time" value="${esc(ex.ora||'')}"></div><div><label for="ff">Alle (facoltativo)</label><input id="ff" type="time" value="${esc(ex.oraFine||'')}"></div></div>
  <label for="fl">Luogo (facoltativo)</label><input id="fl" type="text" maxlength="80" value="${esc(ex.luogo||'')}">
  <label for="fn">Nota (facoltativa)</label><input id="fn" type="text" maxlength="160" value="${esc(ex.nota||'')}">
  ${rt?`<div class="fr"><div><label for="fdal">Vale dal (facoltativo)</label><input id="fdal" type="date" value="${esc(ex.dal||'')}"></div><div><label for="fal">Fino al (facoltativo)</label><input id="fal" type="date" value="${esc(ex.al||'')}"></div></div>`:''}
  ${destHtml(ex)}`;
  const o=modal((r?'Modifica ':'Nuova ')+(rt?'routine':'allenamento straordinario'),body,{onSave:async(o,er)=>{
    const g=id=>o.querySelector('#'+id).value.trim();
    const titolo=g('ft'),ora=g('fo'),oraFine=g('ff');
    if(!titolo){er.textContent='Scrivi un titolo.';return false}
    if(!ora){er.textContent='Indica l’ora di inizio.';return false}
    if(oraFine&&oraFine<=ora){er.textContent='L’ora di fine deve essere dopo quella di inizio.';return false}
    const D={titolo,ora,oraFine,luogo:g('fl'),nota:g('fn')};
    if(rt){
      D.giorni=[...o.querySelectorAll('input[name=gg]:checked')].map(x=>+x.value);
      if(!D.giorni.length){er.textContent='Scegli almeno un giorno della settimana.';return false}
      D.dal=g('fdal');D.al=g('fal');if(D.dal&&D.al&&D.al<D.dal){er.textContent='«Fino al» deve essere dopo «Vale dal».';return false}
      D.attivo=r?r.attivo!==false:true}
    else{D.data=g('fd');if(!isDate(D.data)){er.textContent='Indica la data.';return false}}
    const ids=destDaForm(o,sel);
    if(o.querySelector('input[name=dm]:checked').value==='scelti'&&!ids.length){er.textContent='Scegli almeno un atleta, oppure «Tutti gli atleti».';return false}
    await collegamenti();
    const data={kind:rt?'routine':'straordinario',...D,...destCampi(ids),fb:true};
    if(r)await updateDoc(doc(db,'sections',SEC,'items',r.id),data);
    else await addDoc(col,{...data,by:me.id,at:serverTimestamp()});
    logEvento(r?'modifica':'crea','calendario',r?r.id:'','Calendario',(r?'Modificato ':'Creato ')+(rt?'routine «':'allenamento straordinario «')+titolo+'»')}});
  bindDest(o,sel);o.querySelector('#ft').focus()}

/* ---------- pausa generale delle routine ---------- */
const MOTIVI=['Natale','Pasqua','Estate','Altro'];
function formPausa(){
  const sel=MOTIVI.includes((cfg&&cfg.motivo)||'')?cfg.motivo:cfg&&cfg.motivo?'Altro':'Natale';
  const o=modal('Sospendi le routine',`<p class="mu" style="margin:6px 0">Le routine frequenti non compaiono più nel programma degli atleti. Gli allenamenti straordinari e gli eventi restano. Con una data finale le routine ripartono da sole.</p>
  <label for="pm">Motivo</label><select id="pm">${MOTIVI.map(m=>`<option ${m===sel?'selected':''}>${m}</option>`).join('')}</select>
  <div id="pa" ${sel==='Altro'?'':'hidden'}><label for="pt">Quale?</label><input id="pt" type="text" maxlength="60" value="${esc(sel==='Altro'&&cfg?cfg.motivo:'')}"></div>
  <div class="fr"><div><label for="pd">Dal (facoltativo)</label><input id="pd" type="date" value="${esc((cfg&&cfg.dal)||'')}"></div><div><label for="pf">Fino al, compreso (facoltativo)</label><input id="pf" type="date" value="${esc((cfg&&cfg.finoAl)||'')}"></div></div>
  <div class="mu">Senza «Dal» la pausa parte subito; senza «Fino al» dura finché non le riattivi.</div>`,{ok:'Sospendi',onSave:async(o,er)=>{
    let motivo=o.querySelector('#pm').value;if(motivo==='Altro')motivo=o.querySelector('#pt').value.trim()||'Altro';
    const dal=o.querySelector('#pd').value,finoAl=o.querySelector('#pf').value;
    if(dal&&finoAl&&finoAl<dal){er.textContent='«Fino al» deve essere dopo «Dal».';return false}
    if(finoAl&&finoAl<ymd(new Date())){er.textContent='«Fino al» è già passato.';return false}
    await setDoc(doc(db,'app','routine'),{sospesa:true,motivo,dal,finoAl,by:me.id,at:serverTimestamp()});
    logEvento('modifica','calendario','routine','Calendario','Routine sospese: '+motivo+(dal?' dal '+fmtGiorno(dal):'')+(finoAl?' fino al '+fmtGiorno(finoAl):''))}});
  o.querySelector('#pm').onchange=e=>{o.querySelector('#pa').hidden=e.target.value!=='Altro'}}
async function riattiva(b){
  b.disabled=true;
  try{await setDoc(doc(db,'app','routine'),{sospesa:false,motivo:'',dal:'',finoAl:'',by:me.id,at:serverTimestamp()});logEvento('modifica','calendario','routine','Calendario','Routine riattivate')}
  catch(e){b.disabled=false;const er=$('#erP');if(er)er.textContent='Operazione non riuscita. Controlla la connessione e riprova.'}}

/* ---------- pagina ---------- */
const rout=()=>items.filter(i=>i.kind==='routine').sort((a,b)=>(a.titolo||'').localeCompare(b.titolo||'','it')||(a.ora||'').localeCompare(b.ora||''));
const stra=()=>items.filter(i=>i.kind==='straordinario').sort((a,b)=>(a.data||'').localeCompare(b.data||'')||(a.ora||'').localeCompare(b.ora||''));
const orario=i=>i.ora?i.ora+(i.oraFine?'–'+i.oraFine:''):'';
function paintPausa(){
  const el=$('#pausa');if(!el)return;
  const oggi=ymd(new Date()),st=statoPausa(cfg,oggi),mot=cfg&&cfg.motivo?esc(cfg.motivo):'';
  const t={off:()=>'<b>Le routine sono attive.</b> <span class="mu">Per Natale, Pasqua, estate o altri stop usa «Sospendi le routine».</span>',
    attiva:()=>`<b>Routine in pausa</b>${mot?' · '+mot:''}<div class="mu">${cfg.finoAl?'Ripartono da sole dal giorno dopo il '+esc(fmtGiorno(cfg.finoAl))+'.':'Restano ferme finché non le riattivi.'}${cfg.dal?' Pausa iniziata il '+esc(fmtGiorno(cfg.dal))+'.':''}</div>`,
    programmata:()=>`<b>Pausa programmata</b>${mot?' · '+mot:''}<div class="mu">Dal ${esc(fmtGiorno(cfg.dal))}${cfg.finoAl?' al '+esc(fmtGiorno(cfg.finoAl)):''}. Fino ad allora le routine continuano.</div>`,
    scaduta:()=>`<b>La pausa${mot?' ('+mot+')':''} è finita</b><div class="mu">Il ${esc(fmtGiorno(cfg.finoAl))} era l’ultimo giorno: le routine sono ripartite da sole.</div>`}[st]();
  el.innerHTML=`<div class="pz${st==='attiva'||st==='programmata'?' on':''}">${t}<div class="dact"><button class="btn${st==='off'?' ghost':''}" id="bp">${st==='off'?'Sospendi le routine':st==='scaduta'?'Chiudi la pausa':'Riattiva le routine'}</button>${st==='attiva'||st==='programmata'?'<button class="btn ghost" id="bm">Modifica la pausa</button>':''}</div><p class="err" id="erP" role="alert"></p></div>`;
  $('#bp').onclick=e=>st==='off'?formPausa():riattiva(e.target);
  if($('#bm'))$('#bm').onclick=formPausa}
function paintRoutine(){
  const el=$('#rt');if(!el)return;const l=rout();
  el.innerHTML=(l.length?l.map(r=>{const on=r.attivo!==false;
    return `<div class="it${on?'':' off'}" data-id="${esc(r.id)}"><div><b>${esc(r.titolo)}</b> ${on?'':'<span class="badge">Disattivata</span>'}</div>
    <div class="dg">${ORDINE.map(g=>`<span class="${(r.giorni||[]).includes(g)?'on':''}">${GIORNI[g]}</span>`).join('')}</div>
    <div class="mu">${[orario(r),r.luogo,r.dal||r.al?('valida '+(r.dal?'dal '+fmtGiorno(r.dal):'')+(r.al?' fino al '+fmtGiorno(r.al):'')):''].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="mu">Per: ${esc(destTxt(r))}</div>${r.nota?`<div class="mu">${esc(r.nota)}</div>`:''}
    <div class="dact"><button class="btn sm${on?' ghost':''}" data-az="tg">${on?'Disattiva':'Attiva'}</button><button class="btn ghost sm" data-az="ed">Modifica</button><button class="btn ghost sm" data-az="del">Elimina</button></div></div>`}).join('')
    :'<div class="mu">Nessuna routine. Aggiungi gli allenamenti che si ripetono ogni settimana e scegli per quali atleti.</div>')
    +'<div class="dact"><button class="btn" id="nr">Nuova routine</button></div>';
  $('#nr').onclick=()=>collegamenti().then(()=>form('routine'))}
function paintStra(){
  const el=$('#sx');if(!el)return;const oggi=ymd(new Date()),l=stra(),f=l.filter(i=>i.data>=oggi),p=l.filter(i=>i.data<oggi).reverse();
  const riga=i=>`<div class="it${i.data<oggi?' off':''}" data-id="${esc(i.id)}"><div><b>${esc(i.titolo)}</b></div><div class="mu">${[fmtGiorno(i.data,{weekday:'long',day:'numeric',month:'long',year:'numeric'}),orario(i),i.luogo].filter(Boolean).map(esc).join(' · ')}</div><div class="mu">Per: ${esc(destTxt(i))}</div>${i.nota?`<div class="mu">${esc(i.nota)}</div>`:''}
    <div class="dact"><button class="btn ghost sm" data-az="ed">Modifica</button><button class="btn ghost sm" data-az="del">Elimina</button></div></div>`;
  el.innerHTML=(f.length?f.map(riga).join(''):'<div class="mu">Nessun allenamento straordinario in programma.</div>')
    +(p.length?`<details><summary>Passati (${p.length})</summary>${p.map(riga).join('')}</details>`:'')
    +'<div class="dact"><button class="btn" id="ns">Nuovo allenamento straordinario</button></div>';
  $('#ns').onclick=()=>collegamenti().then(()=>form('straordinario'))}
function paintEventi(){
  const el=$('#ev');if(!el)return;const oggi=ymd(new Date()),l=evs.filter(e=>e.data&&e.data>=oggi).sort((a,b)=>a.data.localeCompare(b.data));
  el.innerHTML=(l.length?l.slice(0,15).map(e=>`<div class="it"><b>${esc(e.nome)}</b><div class="mu">${esc(fmtGiorno(e.data,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${e.dest&&e.dest.length?' · solo atleti scelti':' · tutti gli atleti'}</div></div>`).join(''):'<div class="mu">Nessun evento in programma.</div>')
    +'<div class="dact"><a class="btn ghost" href="eventi.html" style="text-decoration:none">Gestisci gli eventi</a></div>'}
function paintAgenda(){
  const el=$('#ag');if(!el)return;
  const at=tuttiAt().sort((a,b)=>nomeAt(a).localeCompare(nomeAt(b),'it'));
  const v=visibileA(vista),oc=occorrenze({routine:rout(),straord:stra(),eventi:evs,cfg,giorni:21,visibile:v});
  const per={};oc.forEach(o=>(per[o.data]=per[o.data]||[]).push(o));
  el.innerHTML=`<label for="av">Anteprima per</label><select id="av"><option value="">Tutti gli atleti</option>${at.map(a=>`<option value="${esc(a.id)}" ${a.id===vista?'selected':''}>${esc(nomeAt(a))}</option>`).join('')}</select>
  <div class="mu">Prossimi 21 giorni, come li vede l’atleta${vista?'':' (qui tutte le voci)'}. I giorni di pausa delle routine non compaiono.</div>
  ${Object.keys(per).length?Object.keys(per).sort().map(d=>`<div class="gd">${esc(fmtGiorno(d,{weekday:'long',day:'numeric',month:'long'}))}</div>${per[d].map(o=>`<div class="ri${o.tipo==='straordinario'?' st':o.tipo==='evento'?' ev':''}"><b>${esc(o.titolo)}</b> <span class="mu">· ${esc(ETICHETTE[o.tipo])}${o.ora?' · '+esc(o.ora+(o.oraFine?'–'+o.oraFine:'')):''}${o.luogo?' · '+esc(o.luogo):''}</span></div>`).join('')}`).join(''):'<div class="mu" style="margin-top:8px">Niente in programma nei prossimi 21 giorni.</div>'}`;
  $('#av').onchange=e=>{vista=e.target.value;paintAgenda()}}
const paintAll=()=>{if(!shell)return;paintPausa();paintRoutine();paintStra();paintEventi();paintAgenda()};

function azione(e){
  const b=e.target.closest('button[data-az]');if(!b)return;
  const row=b.closest('.it'),r=items.find(x=>x.id===row.dataset.id);if(!r)return;
  const az=b.dataset.az;
  if(az==='tg'){b.disabled=true;updateDoc(doc(db,'sections',SEC,'items',r.id),{attivo:r.attivo===false}).then(()=>logEvento('modifica','calendario',r.id,'Calendario',(r.attivo===false?'Attivata':'Disattivata')+' la routine «'+r.titolo+'»')).catch(x=>{b.disabled=false;alert(msgErr(x))});return}
  if(az==='ed'){collegamenti().then(()=>form(r.kind==='routine'?'routine':'straordinario',r));return}
  if(az==='del'){
    if(!confirm('Eliminare «'+r.titolo+'»? Va nel Cestino.'))return;
    b.disabled=true;deleteDoc(doc(db,'sections',SEC,'items',r.id)).then(()=>logEvento('elimina','calendario',r.id,'Calendario','Eliminato «'+r.titolo+'»')).catch(x=>{b.disabled=false;alert(msgErr(x))})}}

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Calendario</h2><span class="badge">Solo admin</span></div></div>
  <div class="card cd"><h2>Routine frequenti</h2><div class="mu">Gli allenamenti che si ripetono ogni settimana, attribuiti a tutti gli atleti o solo ad alcuni. Sotto il saluto, nella Home, ognuno vede il proprio prossimo allenamento o evento.</div><div id="pausa" style="margin-top:8px"></div><div id="rt"></div></div>
  <div class="card cd"><h2>Allenamenti straordinari</h2><div id="sx"></div></div>
  <div class="card cd"><h2>Eventi</h2><div class="mu">Arrivano dalla sezione Eventi e compaiono da soli nel programma.</div><div id="ev"></div></div>
  <div class="card cd"><h2>Programma dei prossimi giorni</h2><div id="ag"></div></div></div>`;
  $('#out').onclick=()=>signOut(auth);
  ['#rt','#sx'].forEach(s=>$(s).addEventListener('click',azione));
  paintAll()}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Apri index.html e incolla i dati del progetto Firebase.')}
else{
  const fa=initializeApp(firebaseConfig);auth=getAuth(fa);db=getFirestore(fa);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];shell=false;
    if(!u){location.href='index.html';return}
    unsubs.push(onSnapshot(doc(db,'users',u.uid),sn=>{
      me=sn.exists()?{id:u.uid,...sn.data()}:null;
      if(!me||!me.admin){app.innerHTML=box('Solo admin','Il Calendario si gestisce dall’account admin.');shell=false;return}
      if(!shell)costruisci();
      if(unsubs.length>1)return;
      unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));riallinea();paintAll()},e=>{console.error('calendario',e);const r=$('#rt');if(r)r.innerHTML='<p class="err" role="alert">Impossibile leggere il calendario. Controlla la connessione e l’accesso a Telegram (Chat).</p>'}));
      unsubs.push(onSnapshot(doc(db,'app','routine'),s=>{cfg=s.exists()?s.data():null;paintAll()},()=>{}));
      unsubs.push(onSnapshot(collection(db,'sections','eventi','items'),s=>{evs=s.docs.map(d=>({id:d.id,...d.data()})).filter(i=>i.kind==='evento');paintAll()},()=>{}));
      unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>!a.kind||a.kind==='atleta');paintAgenda()},()=>{}));
      collegamenti().then(()=>{riallinea();paintAll()})},()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
