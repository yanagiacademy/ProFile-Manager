import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio,limiteMB} from "./archivio.js";
import {memoBar} from "./promemoria.js";
import {showPreview,guessMime,okThumb} from "./file-tools.js";
import {gruppiHtml,gruppiBind,seguiCorsi} from "./gruppi-atleti.js";
import {collection as fcol,doc as fdoc,query,where,onSnapshot as fon,addDoc as fadd,updateDoc as fupd,deleteDoc as fdel} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {avvisaTecnici,avvisaUtente,mailProposteAdmin} from "./lezioni-avvisi.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='lezioni';
let atl=[],pers=[],atlErr=false,atlSub=false,sel=new Set(),selNames=new Map();
/* account segnati «Come atleta» in Gestione account (es. tecnico, commercialista): si scelgono come presenti con id «u:<uid>» */
const persone=()=>pers.map(p=>({id:'u:'+p.id,title:p.nome||'Account',nome:'',cognome:''}));
const tuttiAtl=()=>[...atl,...persone()];
let auth,db,col,arch,uid=null,me=null,items=[],q='',unsubs=[],shellFor='',editing=null,pend=[],addTarget=null,memo=null;
const offs=new Map();
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';
const fmtOre=n=>String(n).replace('.',',')+' h';
const ORE=Array.from({length:16},(_,k)=>(k+1)/2);      /* da 0,5 a 8 ore, a passi di mezz'ora */
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const fmtD=d=>String(d||'').split('-').reverse().join('/');
const dayOf=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return '';const g=new Date(d+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long'});return g.charAt(0).toUpperCase()+g.slice(1)};
const today=()=>{const d=new Date(),m=String(d.getMonth()+1).padStart(2,'0'),g=String(d.getDate()).padStart(2,'0');return d.getFullYear()+'-'+m+'-'+g};
const fmtSize=n=>!n?'':n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB';
const ext=n=>(String(n).includes('.')?String(n).split('.').pop():'').slice(0,4).toUpperCase();
const icon=a=>{const t=guessMime(a.title,a.mime);return t.startsWith('image/')?'🖼️':t.startsWith('video/')?'🎬':t.startsWith('audio/')?'🎵':t==='application/pdf'?'📄':t.startsWith('text/')?'📝':'📎'};
const lessonsOf=()=>items.filter(i=>i.kind!=='file'&&i.stato!=='prog');      /* solo le lezioni svolte: ore ed elenco partono da qui */
/* Prossima lezione: stato «prog» = programmata; se la data è passata finisce in «Da confermare» finché non la confermi. cond = condivisa con i tecnici */
const isPlan=i=>i.kind!=='file'&&i.stato==='prog';
const canSee=i=>perm()==='w'||!!i.cond;
const futureOf=()=>items.filter(i=>isPlan(i)&&canSee(i)&&(i.date||'')>=today()).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const pastOf=()=>items.filter(i=>isPlan(i)&&perm()==='w'&&(i.date||'')<today()).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
let planEd=null,confirming=null;
/* Proposte dei tecnici (raccolta Firebase «lezioniProposte», non passa da Telegram): il tecnico (Lezioni in sola lettura) propone una nuova prossima lezione o una modifica a una condivisa;
   l'admin la accetta, la modifica o la rifiuta. Stati: attesa → accettata | modificata | rifiutata. */
const tec=()=>perm()==='r';
let props=[],propSub=false,propEd=null,propLez='',revProp=null;
const planData=(date,master,type,ore,piano,cond)=>({stato:'prog',date,day:dayOf(date),master,type,ore,piano,cond,title:'Lezione programmata '+fmtD(date)+' – '+type,note:master+(ore>0?' · '+fmtOre(ore):'')+(piano?' · '+piano.replace(/\s+/g,' ').slice(0,160):'')});
const lblSalva=()=>tec()?'Invia proposta':'Salva programma';
const attsOf=id=>items.filter(i=>i.kind==='file'&&i.lesson===id).sort((a,b)=>((a.at&&a.at.seconds)??Infinity)-((b.at&&b.at.seconds)??Infinity)||a.title.localeCompare(b.title,'it'));
const note=(t,ms=8000)=>{const p=$('#prog');if(!p)return;p.style.display='block';p.textContent=t;setTimeout(()=>{p.style.display='none'},ms)};

/* Struttura della pagina: il modulo viene creato una sola volta, così quello che scrivi non si perde quando l'elenco si aggiorna */
function shell(){
  const w=perm()==='w',t=tec();shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca nelle lezioni" aria-label="Cerca nelle lezioni" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Lezioni</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  ${proxHtml(w,t)}
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuova lezione</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo della lezione">+</button></div>
    <div id="fb" hidden>
    <div class="two"><div><label for="dt">Data</label><input id="dt" type="date"></div><div><label for="dy">Giorno</label><input id="dy" type="text" readonly tabindex="-1" aria-live="polite"></div></div>
    <label for="ms">Maestro</label><input id="ms" type="text" list="lm" autocomplete="off"><datalist id="lm"></datalist>
    <label for="tp">Tipologia lezione</label><input id="tp" type="text" list="lt" autocomplete="off"><datalist id="lt"></datalist>
    <div class="two"><div><label for="or">N. ore lezione</label><select id="or"><option value="">Seleziona…</option>${ORE.map(n=>`<option value="${n}">${fmtOre(n)}</option>`).join('')}</select></div>
      <div><label id="prlb">Atleti presenti</label><details class="dd" id="pr"><summary id="prs" aria-labelledby="prlb prs">Nessun atleta selezionato</summary>
        <div class="ddp">${gruppiHtml()}<input id="prq" type="search" placeholder="Cerca atleta" aria-label="Cerca atleta" autocomplete="off"><div class="acts"><button type="button" class="btn ghost sm" id="pra">Seleziona tutti</button><button type="button" class="btn ghost sm" id="prn">Nessuno</button></div><div id="prl"></div></div></details></div></div>
    <div id="pn" hidden style="border:1px dashed var(--ln);border-radius:8px;padding:8px 10px;margin-top:10px"><b>Programma previsto</b><div id="pnt" class="mu" style="white-space:pre-wrap"></div></div>
    <label for="rp">Rapporto della lezione</label><textarea id="rp" placeholder="Argomenti trattati, presenze, osservazioni…"></textarea>
    <label for="fl">Allega file (foto, video, PDF…)</label><input id="fl" type="file" multiple><div id="fls"></div>
    <p class="mu" style="margin:6px 0 0">Limite ${limiteMB()} MB per file. Puoi aggiungerne altri anche dopo, dalla riga della lezione.</p>
    <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="fbk" style="width:auto;min-height:0"> Salva anche su Firebase</label>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva lezione</button><button class="btn ghost" id="cx" hidden>Annulla modifica</button></div></div></div>
  <input type="file" id="addf" multiple hidden>`:''}
  <div class="card" style="margin-bottom:12px"><div class="fh"><h3 style="margin:0">Ore di allenamento</h3><button class="btn sm" id="otg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="ob" aria-label="Apri il conteggio delle ore di allenamento">+</button></div>
    <div id="ob" hidden><div class="two"><div><label for="od">Dal</label><input id="od" type="date"></div><div><label for="oa">Al</label><input id="oa" type="date"></div></div>
    <div class="acts"><button class="btn ghost sm" id="orst">Tutto il periodo</button></div>
    <input id="oq" type="search" placeholder="Cerca atleta" aria-label="Cerca atleta" autocomplete="off" style="margin-top:8px">
    <div class="mu" id="ot" role="status" style="margin:8px 0"></div><div id="ol"></div></div></div>
  <div class="card" id="ls"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#ls').onclick=onListClick;$('#pl').onclick=onPlanClick;$('#dc').onclick=onPlanClick;
  $('#otg').onclick=()=>{const ap=$('#ob').hidden;$('#ob').hidden=!ap;$('#otg').textContent=ap?'−':'+';$('#otg').setAttribute('aria-expanded',String(ap));if(ap)renderOre()};
  ['#od','#oa'].forEach(s=>$(s).onchange=renderOre);$('#oq').oninput=renderOre;
  $('#orst').onclick=()=>{$('#od').value='';$('#oa').value='';renderOre()};
  $('#ol').onclick=e=>{const b=e.target.closest('[data-oa]');if(!b)return;const id=b.dataset.oa;if(oreOpen.has(id))oreOpen.delete(id);else oreOpen.add(id);renderOre()};
  if(t){
    $('#ptg').onclick=()=>setPlan($('#pb').hidden);
    $('#pdt').value=today();$('#pdy').value=dayOf($('#pdt').value);$('#pdt').oninput=()=>{$('#pdy').value=dayOf($('#pdt').value)};
    $('#psv').onclick=savePlan;$('#pcx').onclick=resetPlan;$('#mp').onclick=onMyPropClick}
  if(w){
    $('#ppc').onclick=onPropAdmin;
    $('#ftg').onclick=()=>setForm($('#fb').hidden);
    $('#dt').value=today();$('#dy').value=dayOf($('#dt').value);
    $('#dt').oninput=()=>{$('#dy').value=dayOf($('#dt').value)};
    $('#sv').onclick=save;$('#cx').onclick=resetForm;
    $('#ptg').onclick=()=>setPlan($('#pb').hidden);
    $('#pdt').value=today();$('#pdy').value=dayOf($('#pdt').value);
    $('#pdt').oninput=()=>{$('#pdy').value=dayOf($('#pdt').value)};
    $('#psv').onclick=savePlan;$('#pcx').onclick=resetPlan;
    $('#prq').oninput=renderAtl;
    $('#pra').onclick=()=>{visAtl().forEach(x=>{sel.add(x.id);selNames.set(x.id,x.n)});renderAtl()};
    $('#prn').onclick=()=>{sel.clear();renderAtl()};
    gruppiBind($('#pr'),{atleti:()=>atl,getSel:()=>sel,dopo:m=>{m.forEach(a=>selNames.set(a.id,nameOf(a)));renderAtl()}});
    renderAtl();
    $('#fl').onchange=e=>{const add=[...e.target.files];e.target.value='';const big=add.find(f=>f.size>arch.maxBytes());
      if(big){$('#er').textContent='“'+big.name+'” supera il limite di '+limiteMB()+' MB.';return}
      $('#er').textContent='';pend.push(...add);renderPend()};
    $('#addf').onchange=async e=>{const fs=[...e.target.files];e.target.value='';if(addTarget&&fs.length)await uploadTo(addTarget,fs);addTarget=null};
  }
}
/* ---------- ore di allenamento per atleta: dalle lezioni (ore e atleti presenti), con periodo facoltativo ---------- */
let oreOpen=new Set(),persSub=false;
function oreAtleti(da,a){
  const m=new Map();
  atl.forEach(x=>m.set(x.id,{id:x.id,n:nameOf(x),ore:0,les:[]}));
  lessonsOf().forEach(l=>{
    if(!l.date||!(l.ore>0)||!Array.isArray(l.presenti))return;
    if((da&&l.date<da)||(a&&l.date>a))return;
    l.presenti.forEach((id,k)=>{let r=m.get(id);if(!r){r={id,n:(l.presentiN||[])[k]||'Atleta non più in elenco',ore:0,les:[]};m.set(id,r)}r.ore+=l.ore;r.les.push(l)})});
  return [...m.values()].sort((x,y)=>x.n.localeCompare(y.n,'it'))}
function renderOre(){
  const ol=$('#ol');if(!ol||$('#ob').hidden)return;
  const da=$('#od').value,a=$('#oa').value,t=$('#oq').value.trim().toLowerCase();
  const L=lessonsOf().filter(l=>l.date&&l.ore>0&&(!da||l.date>=da)&&(!a||l.date<=a)),tot=L.reduce((s,l)=>s+l.ore,0);
  const rows=oreAtleti(da,a).filter(r=>!t||r.n.toLowerCase().includes(t));
  $('#ot').textContent=L.length+(L.length===1?' lezione · ':' lezioni · ')+fmtOre(tot)+' di lezione'+((da||a)?' nel periodo scelto':'');
  ol.innerHTML=rows.length?rows.map(r=>{
    const open=oreOpen.has(r.id),n=r.les.length;
    const det=open?`<div class="od">${n?[...r.les].sort((x,y)=>y.date.localeCompare(x.date)).map(l=>`<div class="fh"><span>${esc(fmtD(l.date))} · ${esc(l.day||dayOf(l.date))}${l.type?' · '+esc(l.type):''}${l.master?' · '+esc(l.master):''}</span><b>${esc(fmtOre(l.ore))}</b></div>`).join(''):'<div class="mu">Nessuna lezione nel periodo.</div>'}</div>`:'';
    return `<div class="oa"><button class="oh" data-oa="${esc(r.id)}" aria-expanded="${open}"><span class="nm">${esc(r.n)}</span><span class="mu">${n} ${n===1?'lezione':'lezioni'}</span><span class="hr">${esc(fmtOre(r.ore))}</span><span aria-hidden="true">${open?'−':'+'}</span></button>${det}</div>`}).join('')
    :`<div class="mu">${atl.length||L.length?'Nessun atleta trovato.':'Nessun dato: registra le lezioni indicando gli atleti presenti.'}</div>`}

/* ---------- atleti presenti (menu a tendina con caselle) ---------- */
function baseAtl(){
  const base=tuttiAtl().map(a=>({id:a.id,n:nameOf(a)})),ids=new Set(base.map(x=>x.id));
  [...sel].filter(id=>!ids.has(id)).forEach(id=>base.push({id,n:selNames.get(id)||'Atleta non più in elenco'}));
  return base.sort((a,b)=>a.n.localeCompare(b.n,'it'))}
function visAtl(){const t=(($('#prq')||{}).value||'').trim().toLowerCase();return baseAtl().filter(x=>!t||x.n.toLowerCase().includes(t))}
function summAtl(){const e=$('#prs');if(e)e.textContent=sel.size?sel.size+(sel.size===1?' atleta presente':' atleti presenti'):'Nessun atleta selezionato'}
function renderAtl(){
  const l=$('#prl');if(!l)return;
  const vis=visAtl(),t=(($('#prq')||{}).value||'').trim();
  l.innerHTML=vis.length?vis.map(x=>`<label class="ck"><input type="checkbox" data-p="${esc(x.id)}" ${sel.has(x.id)?'checked':''}> ${esc(x.n)}</label>`).join('')
    :`<div class="mu" style="padding:6px 2px">${atlErr?'Elenco atleti non disponibile: serve il permesso di lettura sulla scheda Atleti.':t||atl.length?'Nessun risultato.':'Nessun atleta registrato.'}</div>`;
  l.querySelectorAll('[data-p]').forEach(c=>c.onchange=()=>{
    const x=vis.find(v=>v.id===c.dataset.p);
    if(c.checked){sel.add(c.dataset.p);if(x)selNames.set(x.id,x.n)}else sel.delete(c.dataset.p);summAtl()});
  summAtl()}
function renderPend(){
  const el=$('#fls');if(!el)return;
  el.innerHTML=pend.map((f,i)=>`<div class="row"><div>${esc(f.name)} <span class="mu">(${fmtSize(f.size)})</span></div><button class="btn ghost sm" data-x="${i}">Rimuovi</button></div>`).join('');
  el.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{pend.splice(+b.dataset.x,1);renderPend()})}
function setForm(o){
  const b=$('#fb'),t=$('#ftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?'Chiudi il modulo della lezione':'Apri il modulo della lezione')}
function resetForm(){
  setForm(false);editing=null;confirming=null;$('#pn').hidden=true;pend=[];renderPend();$('#ft').textContent='Nuova lezione';$('#sv').textContent='Salva lezione';$('#cx').hidden=true;
  $('#dt').value=today();$('#dy').value=dayOf($('#dt').value);$('#ms').value='';$('#tp').value='';$('#rp').value='';$('#fbk').checked=false;$('#er').textContent='';
  $('#or').value='';sel.clear();selNames.clear();$('#prq').value='';$('#pr').open=false;renderAtl()}

/* Controlla che si possa usare l'archivio file (Telegram collegato, se è quello in uso) */
function canUpload(){
  if(arch.needsTelegram()){
    if(confirm('I file vengono salvati su Telegram: prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  return true}
async function uploadTo(lessonId,files,fbOv){
  const fb=fbOv!==undefined?fbOv:!!(items.find(i=>i.id===lessonId)||{}).fb;
  if(!files.length||!canUpload())return false;
  const big=files.find(f=>f.size>arch.maxBytes());
  if(big){note('“'+big.name+'” supera il limite di '+limiteMB()+' MB: non caricato.');return false}
  const p=$('#prog');p.style.display='block';let ok=0,fail=0,last='';
  for(let k=0;k<files.length;k++){
    const f=files[k];p.textContent=`Caricamento ${k+1}/${files.length}: ${f.name}`;
    try{await arch.save(f,{lesson:lessonId,...(fb?{fb:true}:{})},pc=>{p.textContent=`Caricamento ${k+1}/${files.length}: ${f.name} ${pc}%`});ok++}
    catch(e){fail++;last=arch.errText(e);console.error(e)}}
  p.textContent=`Caricati ${ok} file`+(fail?` · ${fail} non riusciti (${last})`:'');
  setTimeout(()=>{p.style.display='none'},fail?12000:4000);return !fail}

async function save(){
  const date=$('#dt').value,master=$('#ms').value.trim(),type=$('#tp').value.trim(),report=$('#rp').value.trim(),er=$('#er');
  if(!date){er.textContent='Inserisci la data.';return}
  if(!master){er.textContent='Inserisci il maestro.';return}
  if(!type){er.textContent='Inserisci la tipologia della lezione.';return}
  const ore=parseFloat($('#or').value);
  if(!(ore>0)){er.textContent='Seleziona il numero di ore della lezione.';return}
  if(pend.length&&!canUpload())return;
  const ids=[...sel],data={date,day:dayOf(date),master,type,ore,presenti:ids,presentiN:ids.map(id=>selNames.get(id)||(baseAtl().find(x=>x.id===id)||{}).n||''),report,fb:$('#fbk').checked,...(confirming?{stato:'svolta'}:{}),title:'Lezione '+fmtD(date)+' – '+type,note:master+' · '+fmtOre(ore)+(ids.length?' · '+ids.length+' presenti':'')+(report?' · '+report.replace(/\s+/g,' ').slice(0,160):'')};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    let id=editing;
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else id=(await addDoc(col,{...data,by:uid,at:serverTimestamp()})).id;
    const files=pend.slice();resetForm();
    if(files.length)await uploadTo(id,files,data.fb);
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}
function edit(it){
  setForm(true);editing=it.id;confirming=null;$('#pn').hidden=true;$('#ft').textContent='Modifica lezione';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;
  $('#dt').value=it.date||today();$('#dy').value=dayOf($('#dt').value);$('#ms').value=it.master||'';$('#tp').value=it.type||'';$('#rp').value=it.report||'';$('#fbk').checked=!!it.fb;$('#er').textContent='';
  $('#or').value=it.ore?String(it.ore):'';sel=new Set(it.presenti||[]);selNames=new Map((it.presenti||[]).map((id,k)=>[id,(it.presentiN||[])[k]||'']));$('#prq').value='';renderAtl();
  $('#dt').scrollIntoView({behavior:'smooth',block:'center'})}

/* ---------- viewer ---------- */
function openReport(it){
  const w=perm()==='w',txt=`${it.day||dayOf(it.date)} ${fmtD(it.date)}\nMaestro: ${it.master||''}\nTipologia: ${it.type||''}${it.ore?'\nOre lezione: '+fmtOre(it.ore):''}${(it.presenti||[]).length?'\nPresenti ('+it.presenti.length+'): '+(it.presentiN||[]).filter(Boolean).join(', '):''}\n\nRapporto della lezione\n${it.report||'(nessun rapporto inserito)'}`;
  const extra=w?[{label:'Modifica',fn:()=>{pv.close();edit(it)}},{label:'Aggiungi file',fn:()=>{pv.close();addTarget=it.id;$('#addf').click()}}]:[];
  const pv=showPreview({title:'Lezione '+fmtD(it.date),fileName:'Lezione '+it.date+'.txt',mime:'text/plain',load:async()=>new Blob([txt],{type:'text/plain'}),extra});
}
function openAtt(a){
  const w=perm()==='w';let pv;
  const extra=w?[{label:'Rimuovi',fn:async()=>{
    if(!confirm('Rimuovere “'+a.title+'” da questa lezione?'))return;
    try{await arch.remove(a);pv.close()}catch(e){alert('Rimozione non riuscita.')}}}]:[];
  pv=showPreview({title:a.title,mime:a.mime,load:say=>arch.getBlob(a,say),errText:e=>'Impossibile aprire il file: '+arch.errText(e),extra});
}

/* ---------- elenco ---------- */
function tileAtt(a){
  const inner=okThumb(a.thumb)?`<img class="th" src="${a.thumb}" alt="" loading="lazy">`:`<span aria-hidden="true">${icon(a)}</span>`;
  return `<button class="lt" data-act="att" data-id="${esc(a.id)}" aria-label="Apri ${esc(a.title)}" title="${esc(a.title)}">${inner}<span class="cp">${esc(ext(a.title)||'FILE')}</span></button>`}
function renderList(){
  const ls=$('#ls');if(!ls)return;
  const w=perm()==='w',t=q.trim().toLowerCase();
  const hay=i=>[i.title,i.note,i.master,i.type,i.report,i.piano,...(i.presentiN||[]),i.date&&fmtD(i.date),i.day,...attsOf(i.id).map(a=>a.title)].filter(Boolean).join(' ').toLowerCase();
  const list=lessonsOf().filter(i=>!t||hay(i).includes(t)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||((b.at&&b.at.seconds)||0)-((a.at&&a.at.seconds)||0));
  ls.innerHTML=list.length?list.map(i=>{
    const mn=w?`<button class="btn ghost sm mn" data-act="mnu" data-id="${esc(i.id)}" aria-label="Azioni sulla lezione" title="Azioni">⋯</button>`:'';
    if(!i.date)return `<div class="les"><div class="inf"><div><b>${esc(i.title)}</b></div><div class="mu">${esc(i.note||'')}</div></div>${w?`<button class="btn ghost sm mn" data-act="del" data-id="${esc(i.id)}" aria-label="Elimina" title="Elimina">✕</button>`:''}</div>`;
    const a=attsOf(i.id),n=a.length,max=Math.max(0,n-2),off=Math.min(offs.get(i.id)||0,max),vis=a.slice(off,off+2);
        return `<div class="les"><div class="strip">
      <button class="lt ls" data-act="rep" data-id="${esc(i.id)}" aria-label="Apri il rapporto della lezione del ${esc(fmtD(i.date))}"><img class="lg" src="logo-yanagi.png" alt=""><span class="cp">Rapporto</span></button>
      ${vis.map(tileAtt).join('')}
      ${n>2?`<button class="arw" data-act="prev" data-id="${esc(i.id)}" aria-label="File precedenti" ${off<=0?'disabled':''}>‹</button><button class="arw" data-act="next" data-id="${esc(i.id)}" aria-label="File successivi" ${off>=max?'disabled':''}>›</button>`:''}</div>
      <div class="inf" title="${esc(fmtD(i.date)+' · '+(i.day||dayOf(i.date))+' · Maestro: '+(i.master||'')+' · '+(i.type||'')+(n?' · '+n+' file':''))}"><div><b>${esc(fmtD(i.date))}</b> · ${esc(i.day||dayOf(i.date))}</div><div class="mu">${esc(i.master||'—')}${i.type?' · '+esc(i.type):''}${i.ore?' · '+esc(fmtOre(i.ore)):''}${(i.presenti||[]).length?' · '+i.presenti.length+' presenti':''}</div></div>${mn}</div>`}).join('')
    :`<div class="mu">${t?'Nessun risultato.':'Nessuna lezione registrata.'+(w?' Compila il modulo qui sopra.':'')}</div>`;
  if(w){const uniq=k=>[...new Set(lessonsOf().map(i=>i[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
    $('#lm').innerHTML=uniq('master').map(v=>`<option value="${esc(v)}">`).join('');
    $('#lt').innerHTML=uniq('type').map(v=>`<option value="${esc(v)}">`).join('')}
  renderOre();renderPlans();renderProp()
}
function menu(it){
  const o=document.createElement('div');o.className='mnu-ov';
  o.innerHTML=`<div class="card mnu" role="dialog" aria-modal="true" aria-label="Azioni sulla lezione"><b>Lezione del ${esc(fmtD(it.date))}</b><div class="acts"><button class="btn" data-a="add">+ Aggiungi file</button><button class="btn ghost" data-a="edit">Modifica</button><button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="x">Chiudi</button></div></div>`;
  const close=()=>o.remove();
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{close();if(b.dataset.a!=='x')doAct(b.dataset.a,it.id)});
  document.body.append(o)}
async function doAct(act,id){
  const it=items.find(x=>x.id===id);if(!it)return;
  if(act==='rep')openReport(it);
  else if(act==='att')openAtt(it);
  else if(act==='mnu')menu(it);
  else if(act==='prev'){offs.set(id,Math.max(0,(offs.get(id)||0)-1));renderList()}
  else if(act==='next'){offs.set(id,(offs.get(id)||0)+1);renderList()}
  else if(act==='add'){if(!canUpload())return;addTarget=id;$('#addf').click()}
  else if(act==='edit')edit(it);
  else if(act==='del'){
    const as=attsOf(id);
    if(!confirm('Eliminare questa lezione'+(as.length?' e i suoi '+as.length+' file':'')+'? Vanno nel Cestino e restano recuperabili per 30 giorni.'))return;
    try{await Promise.all(as.map(a=>arch.remove(a)));await deleteDoc(doc(db,'sections',SEC,'items',id));if(editing===id)resetForm()}
    catch(x){console.error(x);alert('Eliminazione non riuscita.')}}
}
function onListClick(e){const b=e.target.closest('[data-act]');if(b)doAct(b.dataset.act,b.dataset.id)}

/* ---------- Prossima lezione: prepari il programma, lo condividi con i tecnici, a data passata lo confermi con ciò che è stato fatto ---------- */
const proxHtml=(w,t)=>`${w?'<div class="card" id="ppc" style="margin-bottom:12px" hidden></div>':''}<div class="card" style="margin-bottom:12px"><div class="fh"><h3 style="margin:0">Prossima lezione</h3>${w||t?`<button class="btn sm" id="ptg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="pb" aria-label="${t?'Apri il modulo per proporre una lezione':'Apri il modulo della prossima lezione'}">+</button>`:''}</div>
  ${w||t?`<div id="pb" hidden>
    ${t?'<p class="mu" style="margin:6px 0 0">Le lezioni che proponi arrivano all’admin, che le accetta, le modifica o le rifiuta: ti avvisiamo dell’esito.</p>':''}
    <div class="two"><div><label for="pdt">Data</label><input id="pdt" type="date"></div><div><label for="pdy">Giorno</label><input id="pdy" type="text" readonly tabindex="-1" aria-live="polite"></div></div>
    <label for="pms">Maestro</label><input id="pms" type="text" list="lm" autocomplete="off">
    <label for="ptp">Tipologia lezione</label><input id="ptp" type="text" list="lt" autocomplete="off">
    <label for="por">N. ore lezione (facoltativo)</label><select id="por"><option value="">Seleziona…</option>${ORE.map(n=>`<option value="${n}">${fmtOre(n)}</option>`).join('')}</select>
    <label for="ppn">Programma della lezione</label><textarea id="ppn" placeholder="Cosa vuoi fare: riscaldamento, tecniche, esercizi, obiettivi…"></textarea>
    ${w?'<label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pcd" style="width:auto;min-height:0"> Condividi con i tecnici</label>':''}
    <p class="err" id="per" role="alert"></p>
    <div class="acts"><button class="btn" id="psv">${t?'Invia proposta':'Salva programma'}</button><button class="btn ghost" id="pcx" hidden>Annulla modifica</button></div></div>`:''}
  <div id="pl" style="margin-top:8px"></div>${t?'<div id="mp" style="margin-top:10px"></div>':''}</div>
  <div class="card" id="dc" style="margin-bottom:12px" hidden></div>`;
function setPlan(o){const b=$('#pb'),t=$('#ptg');if(!b)return;b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o))}
function resetPlan(){
  planEd=null;propEd=null;propLez='';revProp=null;setPlan(false);$('#pdt').value=today();$('#pdy').value=dayOf($('#pdt').value);
  ['#pms','#ptp','#ppn'].forEach(s=>{$(s).value=''});$('#por').value='';if($('#pcd'))$('#pcd').checked=false;$('#per').textContent='';$('#psv').textContent=lblSalva();$('#pcx').hidden=true}
/* esito dell'avviso ai tecnici, mostrato in basso */
const dettaglioAvviso=r=>r?(r.inviate?'Avviso inviato a '+r.inviate+(r.inviate===1?' tecnico':' tecnici')+' per mail.':'')+(r.nota?(r.inviate?' ':'')+r.nota:''):'';
async function savePlan(){
  const date=$('#pdt').value,master=$('#pms').value.trim(),type=$('#ptp').value.trim(),piano=$('#ppn').value.trim(),er=$('#per'),ore=parseFloat($('#por').value)||0;
  if(!date){er.textContent='Inserisci la data.';return}
  if(!master){er.textContent='Inserisci il maestro.';return}
  if(!type){er.textContent='Inserisci la tipologia della lezione.';return}
  if(tec())return saveProposal({date,master,type,piano,ore},er);
  const cond=$('#pcd').checked,data={...planData(date,master,type,ore,piano,cond),...(cond?{agg:Date.now(),aggTipo:planEd?'modifica':'nuova'}:{})};
  $('#psv').disabled=true;er.textContent='Salvataggio…';
  const rp=revProp,tipo=planEd?'modifica':'nuova';let it=null;
  try{
    if(planEd){await updateDoc(doc(db,'sections',SEC,'items',planEd),data);it={...(items.find(x=>x.id===planEd)||{}),...data,id:planEd}}
    else{const r=await addDoc(col,{...data,by:uid,at:serverTimestamp()});it={...data,id:r.id}}
    if(rp)await chiudiProposta(rp,'modificata');
    resetPlan();
    if(cond){const r=await avvisaTecnici(db,{tipo,it,da:rp?rp.byName:''});const t=dettaglioAvviso(r);if(t)note(t)}
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#psv').disabled=false}

/* ---------- proposte dei tecnici ---------- */
async function saveProposal(v,er){
  const b=$('#psv');b.disabled=true;er.textContent='Invio…';
  try{
    if(propEd)await fupd(fdoc(db,'lezioniProposte',propEd),{date:v.date,day:dayOf(v.date),master:v.master,type:v.type,ore:v.ore,piano:v.piano,stato:'attesa',ts:Date.now(),motivo:'',risolta:0,mailAdm:false});
    else await fadd(fcol(db,'lezioniProposte'),{tipo:propLez?'modifica':'nuova',lez:propLez||'',date:v.date,day:dayOf(v.date),master:v.master,type:v.type,ore:v.ore,piano:v.piano,by:uid,byName:me.name||me.email||'',stato:'attesa',ts:Date.now(),mailAdm:false,risolta:0,motivo:''});
    resetPlan();note('Proposta inviata: l’admin la valuterà e ti avviserà dell’esito.')}
  catch(e){console.error(e);er.textContent='Invio non riuscito'+(e&&e.code==='permission-denied'?' (l’admin deve pubblicare le regole di Firestore aggiornate)':'')+'. Riprova.'}
  b.disabled=false}
function proponiModifica(it){
  setPlan(true);propEd=null;propLez=it.id;$('#psv').textContent='Invia proposta di modifica';$('#pcx').hidden=false;$('#per').textContent='';
  $('#pdt').value=it.date||today();$('#pdy').value=dayOf($('#pdt').value);$('#pms').value=it.master||'';$('#ptp').value=it.type||'';$('#por').value=it.ore>0?String(it.ore):'';$('#ppn').value=it.piano||'';
  $('#pdt').scrollIntoView({behavior:'smooth',block:'center'})}
function editProp(p){
  setPlan(true);propEd=p.id;propLez=p.tipo==='modifica'?p.lez:'';$('#psv').textContent='Reinvia proposta';$('#pcx').hidden=false;$('#per').textContent='';
  $('#pdt').value=p.date||today();$('#pdy').value=dayOf($('#pdt').value);$('#pms').value=p.master||'';$('#ptp').value=p.type||'';$('#por').value=p.ore>0?String(p.ore):'';$('#ppn').value=p.piano||'';
  $('#pdt').scrollIntoView({behavior:'smooth',block:'center'})}
const STATO_P={attesa:['In attesa dell’admin','warn'],accettata:['Accettata','ok'],modificata:['Accettata con modifiche','ok'],rifiutata:['Rifiutata','bad']};
const campiP=[['Data',x=>fmtD(x.date)],['Maestro',x=>x.master],['Tipologia',x=>x.type],['Ore',x=>x.ore>0?fmtOre(x.ore):''],['Programma',x=>x.piano]];
function myPropRow(p){
  const [t,c]=STATO_P[p.stato]||['',''],mod=p.stato==='attesa'||p.stato==='rifiutata';
  return `<div class="les" style="flex-wrap:wrap;align-items:flex-start"><div class="inf" style="flex:1 1 100%"><div><b>${esc(fmtD(p.date))}</b> · ${esc(p.day||dayOf(p.date))} · <span class="mu">${p.tipo==='modifica'?'proposta di modifica':'nuova lezione'}</span> <span class="chip ${c}" style="font-size:.72rem;padding:2px 8px;border:1px solid var(--ln);border-radius:99px">${esc(t)}</span></div><div class="mu">${esc(p.master||'—')}${p.type?' · '+esc(p.type):''}${p.ore>0?' · '+esc(fmtOre(p.ore)):''}</div>${p.stato==='rifiutata'&&p.motivo?`<div class="mu">Motivo: ${esc(p.motivo)}</div>`:''}</div>${mod?`<div class="acts"><button class="btn ghost sm" data-mp="edit" data-id="${esc(p.id)}">${p.stato==='rifiutata'?'Correggi e reinvia':'Modifica'}</button><button class="btn ghost sm" data-mp="del" data-id="${esc(p.id)}">Elimina</button></div>`:''}</div>`}
function propAdminRow(p){
  const o=p.tipo==='modifica'?items.find(x=>x.id===p.lez):null,orfana=p.tipo==='modifica'&&!o;
  const righe=campiP.map(([l,f])=>{const v=f(p),a=o?f(o):'',ch=o&&String(v||'')!==String(a||'');if(!v&&!ch)return '';return `<div style="${l==='Programma'?'white-space:pre-wrap;overflow-wrap:anywhere':''}"><span class="mu">${l}:</span> ${esc(v||'—')}${ch?` <span class="mu">(prima: ${esc(a||'—')})</span>`:''}</div>`}).join('');
  return `<div class="les" style="flex-wrap:wrap;align-items:flex-start"><div class="inf" style="flex:1 1 100%"><div><b>${esc(p.byName||'Un tecnico')}</b> · <span class="mu">${p.tipo==='modifica'?'propone una modifica':'propone una nuova lezione'}</span></div>${righe}${orfana?'<div class="err">La lezione originale non esiste più: puoi solo rifiutare.</div>':''}</div>
    <div class="acts"><button class="btn sm" data-pp="ok" data-id="${esc(p.id)}"${orfana?' disabled':''}>Accetta</button><button class="btn ghost sm" data-pp="mod" data-id="${esc(p.id)}"${orfana?' disabled':''}>Modifica…</button><button class="btn ghost sm" data-pp="no" data-id="${esc(p.id)}">Rifiuta</button></div></div>`}
function renderProp(){
  if(perm()==='w'){
    const c=$('#ppc');if(!c)return;const a=props.filter(p=>p.stato==='attesa').sort((x,y)=>(x.ts||0)-(y.ts||0));
    c.hidden=!a.length;c.innerHTML=a.length?`<h3 style="margin:0 0 4px">Proposte dei tecnici (${a.length})</h3><div class="mu" style="margin-bottom:6px">Accettale così come sono, modificale prima di accettare oppure rifiutale: i tecnici vengono avvisati.</div>`+a.map(propAdminRow).join(''):''}
  else if(tec()){
    const c=$('#mp');if(!c)return;const l=[...props].sort((x,y)=>(y.ts||0)-(x.ts||0)).slice(0,15);
    c.innerHTML=l.length?`<h3 style="margin:0 0 4px;font-size:1rem">Le mie proposte</h3>`+l.map(myPropRow).join(''):''}}
function onMyPropClick(e){
  const b=e.target.closest('[data-mp]');if(!b)return;const p=props.find(x=>x.id===b.dataset.id);if(!p)return;
  if(b.dataset.mp==='edit')editProp(p);
  else if(b.dataset.mp==='del'&&confirm('Eliminare questa proposta?'))fdel(fdoc(db,'lezioniProposte',p.id)).catch(x=>{console.error(x);alert('Eliminazione non riuscita.')})}
async function chiudiProposta(p,stato,motivo=''){
  await fupd(fdoc(db,'lezioniProposte',p.id),{stato,risolta:Date.now(),risoltaDa:uid,motivo});
  avvisaUtente(db,p.by,{esito:stato,p,motivo}).catch(()=>{})}
async function accettaProp(p){
  const o=p.tipo==='modifica'?items.find(x=>x.id===p.lez):null;
  if(p.tipo==='modifica'&&!o){alert('La lezione originale non esiste più.');return}
  const data={...planData(p.date,p.master,p.type,p.ore||0,p.piano||'',true),agg:Date.now(),aggTipo:p.tipo==='modifica'?'modifica':'nuova',daTecnico:p.byName||''};
  let it;
  if(o){await updateDoc(doc(db,'sections',SEC,'items',o.id),data);it={...o,...data}}
  else{const r=await addDoc(col,{...data,by:uid,at:serverTimestamp()});it={...data,id:r.id}}
  await chiudiProposta(p,'accettata');
  const r=await avvisaTecnici(db,{tipo:p.tipo==='modifica'?'modifica':'nuova',it,da:p.byName});const t=dettaglioAvviso(r);note('Proposta accettata.'+(t?' '+t:''))}
function revisiona(p){
  const o=p.tipo==='modifica'?items.find(x=>x.id===p.lez):null;
  if(p.tipo==='modifica'&&!o){alert('La lezione originale non esiste più.');return}
  if(o)editPlan(o);else{resetPlan();setPlan(true)}
  revProp=p;$('#psv').textContent='Salva e accetta';$('#pcx').hidden=false;$('#per').textContent='';
  $('#pdt').value=p.date||today();$('#pdy').value=dayOf($('#pdt').value);$('#pms').value=p.master||'';$('#ptp').value=p.type||'';$('#por').value=p.ore>0?String(p.ore):'';$('#ppn').value=p.piano||'';$('#pcd').checked=true;
  $('#pdt').scrollIntoView({behavior:'smooth',block:'center'})}
async function onPropAdmin(e){
  const b=e.target.closest('[data-pp]');if(!b)return;const p=props.find(x=>x.id===b.dataset.id);if(!p)return;
  try{
    if(b.dataset.pp==='ok'){b.disabled=true;await accettaProp(p)}
    else if(b.dataset.pp==='mod')revisiona(p);
    else if(b.dataset.pp==='no'){const m=prompt('Motivo del rifiuto (facoltativo, lo leggerà il tecnico):','');if(m===null)return;await chiudiProposta(p,'rifiutata',m.trim());note('Proposta rifiutata: il tecnico è stato avvisato.')}}
  catch(x){console.error(x);alert('Operazione non riuscita. Controlla la connessione e i permessi'+(x&&x.code==='permission-denied'?' (l’admin deve pubblicare le regole di Firestore aggiornate)':'')+'.')}}
function editPlan(it){
  setPlan(true);planEd=it.id;$('#psv').textContent='Salva modifiche';$('#pcx').hidden=false;$('#per').textContent='';
  $('#pdt').value=it.date||today();$('#pdy').value=dayOf($('#pdt').value);$('#pms').value=it.master||'';$('#ptp').value=it.type||'';
  $('#por').value=it.ore>0?String(it.ore):'';$('#ppn').value=it.piano||'';$('#pcd').checked=!!it.cond;
  $('#pdt').scrollIntoView({behavior:'smooth',block:'center'})}
/* conferma: riusa il modulo delle lezioni svolte, con il programma come base da correggere in ciò che è stato fatto */
function confirmEdit(it){
  edit(it);confirming=it.id;
  $('#ft').textContent='Conferma lezione svolta';$('#sv').textContent='Conferma lezione svolta';
  $('#pnt').textContent=it.piano||'(nessun programma inserito)';$('#pn').hidden=false;$('#rp').value=it.piano||''}
function planRow(i,conf){
  const w=perm()==='w',ore=i.ore>0?' · '+esc(fmtOre(i.ore)):'';
  const act=conf?`<button class="btn sm" data-pa="conf" data-id="${esc(i.id)}" style="white-space:nowrap">Conferma</button>`:`<button class="btn ghost sm" data-pa="open" data-id="${esc(i.id)}" style="white-space:nowrap">Programma</button>`;
  const mn=w?`<button class="btn ghost sm mn" data-pa="mnu" data-id="${esc(i.id)}" aria-label="Azioni sulla lezione programmata" title="Azioni">⋯</button>`:(tec()&&!conf?`<button class="btn ghost sm mn" data-pa="prop" data-id="${esc(i.id)}" aria-label="Proponi una modifica a questa lezione" title="Proponi una modifica">✎</button>`:'');
  return `<div class="les"><div class="inf"><div><b>${esc(fmtD(i.date))}</b> · ${esc(i.day||dayOf(i.date))}${i.cond&&w?' · <span class="mu">condivisa</span>':''}</div><div class="mu">${esc(i.master||'—')}${i.type?' · '+esc(i.type):''}${ore}</div></div>${act}${mn}</div>`}
function renderPlans(){
  const pl=$('#pl');if(!pl)return;const w=perm()==='w',f=futureOf(),p=pastOf(),dc=$('#dc');
  pl.innerHTML=f.length?f.map(i=>planRow(i,false)).join(''):`<div class="mu">${w?'Nessuna lezione programmata. Tocca + per prepararne una.':'Nessuna lezione condivisa al momento.'}</div>`;
  if(dc){dc.hidden=!p.length;dc.innerHTML=p.length?`<h3 style="margin:0 0 4px">Da confermare</h3><div class="mu" style="margin-bottom:6px">La data è passata: correggi il programma con ciò che è stato fatto e conferma, la lezione passa tra quelle svolte.</div>`+p.map(i=>planRow(i,true)).join(''):''}}
setInterval(()=>{renderPlans()},60000);
function openPlan(it){
  const w=perm()==='w',txt=`${it.day||dayOf(it.date)} ${fmtD(it.date)}\nMaestro: ${it.master||''}\nTipologia: ${it.type||''}${it.ore>0?'\nOre lezione: '+fmtOre(it.ore):''}\n\nProgramma della lezione\n${it.piano||'(nessun programma inserito)'}`;
  const extra=w?[{label:'Modifica',fn:()=>{pv.close();editPlan(it)}}]:[];
  const pv=showPreview({title:'Lezione programmata '+fmtD(it.date),fileName:'Programma lezione '+it.date+'.txt',mime:'text/plain',load:async()=>new Blob([txt],{type:'text/plain'}),extra})}
function planMenu(it){
  const late=(it.date||'')<today(),o=document.createElement('div');o.className='mnu-ov';
  o.innerHTML=`<div class="card mnu" role="dialog" aria-modal="true" aria-label="Azioni sulla lezione programmata"><b>Lezione del ${esc(fmtD(it.date))}</b><div class="acts">${late?'<button class="btn" data-a="conf">Conferma lezione svolta</button>':''}<button class="btn ghost" data-a="edit">Modifica programma</button><button class="btn ghost" data-a="share">${it.cond?'Smetti di condividere con i tecnici':'Condividi con i tecnici'}</button><button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="x">Chiudi</button></div></div>`;
  const close=()=>o.remove();
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{close();if(b.dataset.a!=='x')planAct(b.dataset.a,it)});
  document.body.append(o)}
async function planAct(act,it){
  if(act==='conf')confirmEdit(it);
  else if(act==='edit')editPlan(it);
  else if(act==='share'){try{const on=!it.cond;await updateDoc(doc(db,'sections',SEC,'items',it.id),{cond:on,...(on?{agg:Date.now(),aggTipo:'nuova'}:{})});if(on&&(it.date||'')>=today()){const r=await avvisaTecnici(db,{tipo:'nuova',it});const t=dettaglioAvviso(r);if(t)note(t)}}catch(e){console.error(e);alert('Operazione non riuscita.')}}
  else if(act==='del'){
    if(!confirm('Eliminare la lezione programmata del '+fmtD(it.date)+'? Va nel Cestino e resta recuperabile per 30 giorni.'))return;
    try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(planEd===it.id)resetPlan()}catch(e){console.error(e);alert('Eliminazione non riuscita.')}}}
function onPlanClick(e){
  const b=e.target.closest('[data-pa]');if(!b)return;const it=items.find(x=>x.id===b.dataset.id);if(!it)return;
  if(b.dataset.pa==='open')openPlan(it);else if(b.dataset.pa==='mnu')planMenu(it);else if(b.dataset.pa==='conf')confirmEdit(it);else if(b.dataset.pa==='prop')proponiModifica(it)}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);atlSub=false;propSub=false;props=[];
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));if(tec()){try{localStorage.setItem('pfm_lez_vis_'+uid,String(Date.now()))}catch(e){}}renderList();renderProp()},()=>{}));
      if(!propSub&&(perm()==='w'||perm()==='r')){propSub=true;
        const qp=perm()==='w'?query(fcol(db,'lezioniProposte'),where('stato','==','attesa')):query(fcol(db,'lezioniProposte'),where('by','==',uid));
        unsubs.push(fon(qp,s=>{props=s.docs.map(d=>({id:d.id,...d.data()}));if(tec()){try{localStorage.setItem('pfm_lez_vis_'+uid,String(Date.now()))}catch(e){}}renderProp();if(perm()==='w'&&me.admin)mailProposteAdmin(db)},()=>{props=[];renderProp()}))}
      if(!atlSub){atlSub=true;        /* l'elenco atleti serve anche al conteggio ore (chi non ha la lettura su Atleti vede solo chi compare nelle lezioni) */
        unsubs.push(seguiCorsi(onSnapshot,collection(db,'sections','corsi','items')));
        unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>(!a.kind||a.kind==='atleta')&&(a.nome||a.cognome||a.title));atlErr=false;renderAtl();renderOre()},()=>{atl=[];atlErr=true;renderAtl();renderOre()}))}
      if(!persSub){persSub=true;unsubs.push(onSnapshot(collection(db,'comeAtleta'),s=>{pers=s.docs.map(d=>({id:d.id,...d.data()}));renderAtl();renderOre()},()=>{pers=[]}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
