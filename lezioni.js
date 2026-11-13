import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio,limiteMB} from "./archivio.js";
import {memoBar} from "./promemoria.js";
import {showPreview,guessMime,okThumb} from "./file-tools.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='lezioni';
let atl=[],atlErr=false,atlSub=false,sel=new Set(),selNames=new Map();
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
const lessonsOf=()=>items.filter(i=>i.kind!=='file');
const attsOf=id=>items.filter(i=>i.kind==='file'&&i.lesson===id).sort((a,b)=>((a.at&&a.at.seconds)??Infinity)-((b.at&&b.at.seconds)??Infinity)||a.title.localeCompare(b.title,'it'));
const note=(t,ms=8000)=>{const p=$('#prog');if(!p)return;p.style.display='block';p.textContent=t;setTimeout(()=>{p.style.display='none'},ms)};

/* Struttura della pagina: il modulo viene creato una sola volta, così quello che scrivi non si perde quando l'elenco si aggiorna */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca nelle lezioni" aria-label="Cerca nelle lezioni" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Lezioni</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuova lezione</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo della lezione">+</button></div>
    <div id="fb" hidden>
    <div class="two"><div><label for="dt">Data</label><input id="dt" type="date"></div><div><label for="dy">Giorno</label><input id="dy" type="text" readonly tabindex="-1" aria-live="polite"></div></div>
    <label for="ms">Maestro</label><input id="ms" type="text" list="lm" autocomplete="off"><datalist id="lm"></datalist>
    <label for="tp">Tipologia lezione</label><input id="tp" type="text" list="lt" autocomplete="off"><datalist id="lt"></datalist>
    <div class="two"><div><label for="or">N. ore lezione</label><select id="or"><option value="">Seleziona…</option>${ORE.map(n=>`<option value="${n}">${fmtOre(n)}</option>`).join('')}</select></div>
      <div><label id="prlb">Atleti presenti</label><details class="dd" id="pr"><summary id="prs" aria-labelledby="prlb prs">Nessun atleta selezionato</summary>
        <div class="ddp"><input id="prq" type="search" placeholder="Cerca atleta" aria-label="Cerca atleta" autocomplete="off"><div class="acts"><button type="button" class="btn ghost sm" id="pra">Seleziona tutti</button><button type="button" class="btn ghost sm" id="prn">Nessuno</button></div><div id="prl"></div></div></details></div></div>
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
  $('#ls').onclick=onListClick;
  $('#otg').onclick=()=>{const ap=$('#ob').hidden;$('#ob').hidden=!ap;$('#otg').textContent=ap?'−':'+';$('#otg').setAttribute('aria-expanded',String(ap));if(ap)renderOre()};
  ['#od','#oa'].forEach(s=>$(s).onchange=renderOre);$('#oq').oninput=renderOre;
  $('#orst').onclick=()=>{$('#od').value='';$('#oa').value='';renderOre()};
  $('#ol').onclick=e=>{const b=e.target.closest('[data-oa]');if(!b)return;const id=b.dataset.oa;if(oreOpen.has(id))oreOpen.delete(id);else oreOpen.add(id);renderOre()};
  if(w){
    $('#ftg').onclick=()=>setForm($('#fb').hidden);
    $('#dt').value=today();$('#dy').value=dayOf($('#dt').value);
    $('#dt').oninput=()=>{$('#dy').value=dayOf($('#dt').value)};
    $('#sv').onclick=save;$('#cx').onclick=resetForm;
    $('#prq').oninput=renderAtl;
    $('#pra').onclick=()=>{visAtl().forEach(x=>{sel.add(x.id);selNames.set(x.id,x.n)});renderAtl()};
    $('#prn').onclick=()=>{sel.clear();renderAtl()};
    renderAtl();
    $('#fl').onchange=e=>{const add=[...e.target.files];e.target.value='';const big=add.find(f=>f.size>arch.maxBytes());
      if(big){$('#er').textContent='“'+big.name+'” supera il limite di '+limiteMB()+' MB.';return}
      $('#er').textContent='';pend.push(...add);renderPend()};
    $('#addf').onchange=async e=>{const fs=[...e.target.files];e.target.value='';if(addTarget&&fs.length)await uploadTo(addTarget,fs);addTarget=null};
  }
}
/* ---------- ore di allenamento per atleta: dalle lezioni (ore e atleti presenti), con periodo facoltativo ---------- */
let oreOpen=new Set();
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
  const base=atl.map(a=>({id:a.id,n:nameOf(a)})),ids=new Set(base.map(x=>x.id));
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
  setForm(false);editing=null;pend=[];renderPend();$('#ft').textContent='Nuova lezione';$('#sv').textContent='Salva lezione';$('#cx').hidden=true;
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
  const ids=[...sel],data={date,day:dayOf(date),master,type,ore,presenti:ids,presentiN:ids.map(id=>selNames.get(id)||(baseAtl().find(x=>x.id===id)||{}).n||''),report,fb:$('#fbk').checked,title:'Lezione '+fmtD(date)+' – '+type,note:master+' · '+fmtOre(ore)+(ids.length?' · '+ids.length+' presenti':'')+(report?' · '+report.replace(/\s+/g,' ').slice(0,160):'')};
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
  setForm(true);editing=it.id;$('#ft').textContent='Modifica lezione';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;
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
  const hay=i=>[i.title,i.note,i.master,i.type,i.report,...(i.presentiN||[]),i.date&&fmtD(i.date),i.day,...attsOf(i.id).map(a=>a.title)].filter(Boolean).join(' ').toLowerCase();
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
  renderOre()
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

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);atlSub=false;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
      if(!atlSub){atlSub=true;        /* l'elenco atleti serve anche al conteggio ore (chi non ha la lettura su Atleti vede solo chi compare nelle lezioni) */
        unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atl=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>(!a.kind||a.kind==='atleta')&&(a.nome||a.cognome||a.title));atlErr=false;renderAtl();renderOre()},()=>{atl=[];atlErr=true;renderAtl();renderOre()}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
