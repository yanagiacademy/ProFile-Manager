import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
let auth,db,col,arch,uid=null,me=null,items=[],q='',unsubs=[],shellFor='',editing=null,pend=[],addTarget=null,memo=null;
const offs=new Map();
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
    <label for="rp">Rapporto della lezione</label><textarea id="rp" placeholder="Argomenti trattati, presenze, osservazioni…"></textarea>
    <label for="fl">Allega file (foto, video, PDF…)</label><input id="fl" type="file" multiple><div id="fls"></div>
    <p class="mu" style="margin:6px 0 0">Limite ${limiteMB()} MB per file. Puoi aggiungerne altri anche dopo, dalla riga della lezione.</p>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva lezione</button><button class="btn ghost" id="cx" hidden>Annulla modifica</button></div></div></div>
  <input type="file" id="addf" multiple hidden>`:''}
  <div class="card" id="ls"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#ls').onclick=onListClick;
  if(w){
    $('#ftg').onclick=()=>setForm($('#fb').hidden);
    $('#dt').value=today();$('#dy').value=dayOf($('#dt').value);
    $('#dt').oninput=()=>{$('#dy').value=dayOf($('#dt').value)};
    $('#sv').onclick=save;$('#cx').onclick=resetForm;
    $('#fl').onchange=e=>{const add=[...e.target.files];e.target.value='';const big=add.find(f=>f.size>arch.maxBytes());
      if(big){$('#er').textContent='“'+big.name+'” supera il limite di '+limiteMB()+' MB.';return}
      $('#er').textContent='';pend.push(...add);renderPend()};
    $('#addf').onchange=async e=>{const fs=[...e.target.files];e.target.value='';if(addTarget&&fs.length)await uploadTo(addTarget,fs);addTarget=null};
  }
}
function renderPend(){
  const el=$('#fls');if(!el)return;
  el.innerHTML=pend.map((f,i)=>`<div class="row"><div>${esc(f.name)} <span class="mu">(${fmtSize(f.size)})</span></div><button class="btn ghost sm" data-x="${i}">Rimuovi</button></div>`).join('');
  el.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{pend.splice(+b.dataset.x,1);renderPend()})}
function setForm(o){
  const b=$('#fb'),t=$('#ftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?'Chiudi il modulo della lezione':'Apri il modulo della lezione')}
function resetForm(){
  setForm(false);editing=null;pend=[];renderPend();$('#ft').textContent='Nuova lezione';$('#sv').textContent='Salva lezione';$('#cx').hidden=true;
  $('#dt').value=today();$('#dy').value=dayOf($('#dt').value);$('#ms').value='';$('#tp').value='';$('#rp').value='';$('#er').textContent=''}

/* Controlla che si possa usare l'archivio file (Telegram collegato, se è quello in uso) */
function canUpload(){
  if(arch.needsTelegram()){
    if(confirm('I file vengono salvati su Telegram: prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
    return false}
  return true}
async function uploadTo(lessonId,files){
  if(!files.length||!canUpload())return false;
  const big=files.find(f=>f.size>arch.maxBytes());
  if(big){note('“'+big.name+'” supera il limite di '+limiteMB()+' MB: non caricato.');return false}
  const p=$('#prog');p.style.display='block';let ok=0,fail=0,last='';
  for(let k=0;k<files.length;k++){
    const f=files[k];p.textContent=`Caricamento ${k+1}/${files.length}: ${f.name}`;
    try{await arch.save(f,{lesson:lessonId},pc=>{p.textContent=`Caricamento ${k+1}/${files.length}: ${f.name} ${pc}%`});ok++}
    catch(e){fail++;last=arch.errText(e);console.error(e)}}
  p.textContent=`Caricati ${ok} file`+(fail?` · ${fail} non riusciti (${last})`:'');
  setTimeout(()=>{p.style.display='none'},fail?12000:4000);return !fail}

async function save(){
  const date=$('#dt').value,master=$('#ms').value.trim(),type=$('#tp').value.trim(),report=$('#rp').value.trim(),er=$('#er');
  if(!date){er.textContent='Inserisci la data.';return}
  if(!master){er.textContent='Inserisci il maestro.';return}
  if(!type){er.textContent='Inserisci la tipologia della lezione.';return}
  if(pend.length&&!canUpload())return;
  const data={date,day:dayOf(date),master,type,report,title:'Lezione '+fmtD(date)+' – '+type,note:master+(report?' · '+report.replace(/\s+/g,' ').slice(0,160):'')};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    let id=editing;
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else id=(await addDoc(col,{...data,by:uid,at:serverTimestamp()})).id;
    const files=pend.slice();resetForm();
    if(files.length)await uploadTo(id,files);
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}
function edit(it){
  setForm(true);editing=it.id;$('#ft').textContent='Modifica lezione';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;
  $('#dt').value=it.date||today();$('#dy').value=dayOf($('#dt').value);$('#ms').value=it.master||'';$('#tp').value=it.type||'';$('#rp').value=it.report||'';$('#er').textContent='';
  $('#dt').scrollIntoView({behavior:'smooth',block:'center'})}

/* ---------- viewer ---------- */
function openReport(it){
  const w=perm()==='w',txt=`${it.day||dayOf(it.date)} ${fmtD(it.date)}\nMaestro: ${it.master||''}\nTipologia: ${it.type||''}\n\nRapporto della lezione\n${it.report||'(nessun rapporto inserito)'}`;
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
  const hay=i=>[i.title,i.note,i.master,i.type,i.report,i.date&&fmtD(i.date),i.day,...attsOf(i.id).map(a=>a.title)].filter(Boolean).join(' ').toLowerCase();
  const list=lessonsOf().filter(i=>!t||hay(i).includes(t)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||((b.at&&b.at.seconds)||0)-((a.at&&a.at.seconds)||0));
  ls.innerHTML=list.length?list.map(i=>{
    const mn=w?`<button class="btn ghost sm mn" data-act="mnu" data-id="${esc(i.id)}" aria-label="Azioni sulla lezione" title="Azioni">⋯</button>`:'';
    if(!i.date)return `<div class="les"><div class="inf"><div><b>${esc(i.title)}</b></div><div class="mu">${esc(i.note||'')}</div></div>${w?`<button class="btn ghost sm mn" data-act="del" data-id="${esc(i.id)}" aria-label="Elimina" title="Elimina">✕</button>`:''}</div>`;
    const a=attsOf(i.id),n=a.length,max=Math.max(0,n-2),off=Math.min(offs.get(i.id)||0,max),vis=a.slice(off,off+2);
        return `<div class="les"><div class="strip">
      <button class="lt ls" data-act="rep" data-id="${esc(i.id)}" aria-label="Apri il rapporto della lezione del ${esc(fmtD(i.date))}"><img class="lg" src="logo-yanagi.png" alt=""><span class="cp">Rapporto</span></button>
      ${vis.map(tileAtt).join('')}
      ${n>2?`<button class="arw" data-act="prev" data-id="${esc(i.id)}" aria-label="File precedenti" ${off<=0?'disabled':''}>‹</button><button class="arw" data-act="next" data-id="${esc(i.id)}" aria-label="File successivi" ${off>=max?'disabled':''}>›</button>`:''}</div>
      <div class="inf" title="${esc(fmtD(i.date)+' · '+(i.day||dayOf(i.date))+' · Maestro: '+(i.master||'')+' · '+(i.type||'')+(n?' · '+n+' file':''))}"><div><b>${esc(fmtD(i.date))}</b> · ${esc(i.day||dayOf(i.date))}</div><div class="mu">${esc(i.master||'—')}${i.type?' · '+esc(i.type):''}</div></div>${mn}</div>`}).join('')
    :`<div class="mu">${t?'Nessun risultato.':'Nessuna lezione registrata.'+(w?' Compila il modulo qui sopra.':'')}</div>`;
  if(w){const uniq=k=>[...new Set(lessonsOf().map(i=>i[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
    $('#lm').innerHTML=uniq('master').map(v=>`<option value="${esc(v)}">`).join('');
    $('#lt').innerHTML=uniq('type').map(v=>`<option value="${esc(v)}">`).join('')}
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
    if(!confirm('Eliminare questa lezione'+(as.length?' e i suoi '+as.length+' file':'')+'? L’operazione non si può annullare.'))return;
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
    uid=u.uid;arch=archivio(db,SEC,uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm())shell();
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
