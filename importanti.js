import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,getDocs,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {tgClient,tgEntity,tgErrText} from "./telegram.js";
import {TG_FILES} from "./telegram-config.js";
import {showPreview,saveBlob,saveZip,guessMime,makeThumb,canThumb,okThumb} from "./file-tools.js";

/* File importanti: mostra i documenti di "Documenti" contrassegnati con la stella.
   I file restano in Documenti: qui si possono scaricare, togliere dagli importanti, modificare e rinominare. */
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='documenti',MINE='file-importanti',cur='';
let auth,db,col,uid=null,me=null,items=[],mine=[],q='',unsubs=[],err='';
let memoText='',memoOpen=(()=>{try{return localStorage.getItem('imp_memo')!=='0'}catch(e){return true}})(),memoEdit=false;
let selMode=false,sel=new Set(),vis=[];
const children=id=>items.filter(i=>(i.parent||'')===id);
const level=k=>me?(me.admin?'w':((me.perms||{})[k]||'n')):'n';
const perm=()=>level(MINE),canW=()=>level(SEC)==='w';
const byId=id=>items.find(i=>i.id===id);
const pathOf=id=>{const a=[];let x=byId(id);while(x){a.unshift(x.title);x=byId(x.parent)}return a.join(' / ')};
const sortL=l=>l.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.title.localeCompare(b.title,'it',{numeric:true}));
const fmtSize=n=>!n?'':n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';
const fmtDate=i=>i.at&&i.at.toDate?i.at.toDate().toLocaleDateString('it-IT'):'';
function icon(i){if(i.kind==='folder')return '📁';if(i.kind==='text')return '📝';const m=i.mime||'',n=i.title.toLowerCase();
  if(m.startsWith('image/'))return '🖼️';if(m.startsWith('video/'))return '🎞️';if(m.startsWith('audio/'))return '🎵';if(m==='application/pdf'||n.endsWith('.pdf'))return '📕';
  if(/\.(xlsx?|csv|ods)$/.test(n))return '📊';if(/\.(docx?|odt|rtf)$/.test(n))return '📘';if(/\.(zip|rar|7z)$/.test(n))return '🗜️';return '📄'}

function modal(title,body,btns=[]){
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="dlg card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}<p class="err" id="mer" role="alert"></p><div class="dact"></div></div>`;
  const act=o.querySelector('.dact');
  btns.forEach(b=>{const e=document.createElement('button');e.className='btn '+(b.cls||'');e.textContent=b.label;
    e.onclick=async()=>{const r=b.fn?await b.fn(o):undefined;if(r!==false)o.remove()};act.append(e)});
  o.addEventListener('click',e=>{if(e.target===o)o.remove()});
  o.addEventListener('keydown',e=>{if(e.key==='Escape')o.remove()});
  document.body.append(o);const f=o.querySelector('input,textarea,select');if(f)f.focus();return o}
const merr=(o,t)=>{o.querySelector('#mer').textContent=t;return false};
const cancel={label:'Annulla',cls:'ghost'};

async function getBlob(it,say=()=>{}){
  if(it.kind==='text')return new Blob([it.text||''],{type:'text/plain'});
  if(it.tg){
    say('Collegamento a Telegram…');
    const {client}=await tgClient();const ent=await tgEntity(TG_FILES);const [m]=await client.getMessages(ent,{ids:[it.tg]});
    if(!m||!m.media)throw new Error('MISSING');
    const buf=await client.downloadMedia(m,{progressCallback:(r,t)=>say('Download: '+Math.round(Number(r)/Number(t)*100)+'%')});
    return new Blob([buf],{type:guessMime(it.title,it.mime)})}
  say('Preparazione del file…');
  const sn=await getDocs(collection(db,'sections',SEC,'items',it.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(it.title,it.mime)})}
const dlErr=e=>e&&e.message==='MISSING'?'Il file non è più presente su Telegram.':(e&&e.message==='EMPTY')?'Impossibile leggere il file.':'Operazione non riuscita: '+tgErrText(e);
async function download(it){
  const p=$('#prog');p.style.display='block';p.textContent='Preparazione del file…';
  try{saveBlob(await getBlob(it,t=>{p.textContent=t}),it.title);p.style.display='none'}
  catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}
function preview(it){
  showPreview({title:it.title,mime:it.mime,load:async say=>{const b=await getBlob(it,say);if(canW()&&!it.thumb&&!it.thumbTry&&canThumb(it.title,it.mime))makeThumb(b,it.title,it.mime).then(u=>updateDoc(doc(db,'sections',SEC,'items',it.id),u?{thumb:u}:{thumbTry:true})).catch(()=>{});return b},errText:dlErr,
    extra:canW()?[{label:'★ Togli dai file importanti',fn:async b=>{if(await unstar(byId(it.id)||it))b.disabled=true,b.textContent='Tolto dai file importanti'}}]:[]})}
async function dlSel(){
  const picked=[...sel].map(byId).filter(Boolean);if(!picked.length)return;
  const p=$('#prog');p.style.display='block';const say=t=>{p.textContent=t};
  try{
    if(picked.length===1&&picked[0].kind!=='folder'){say('Preparazione del file…');saveBlob(await getBlob(picked[0],say),picked[0].title);p.style.display='none';return}
    const entries=[];const walk=(x,base)=>{if(x.kind==='folder')children(x.id).forEach(c=>walk(c,base+x.title+'/'));else entries.push({path:base+x.title,load:()=>getBlob(x,say)})};
    picked.forEach(x=>walk(x,''));
    if(!entries.length){p.style.display='none';modal('Selezione vuota','<div class="mu">Le cartelle scelte non contengono file.</div>',[{label:'Chiudi'}]);return}
    const bad=await saveZip(entries,'file-importanti.zip',say);p.style.display='none';
    if(bad)modal('Download completato in parte','<div class="mu">'+bad+' file non sono stati inclusi nello ZIP perché non è stato possibile leggerli.</div>',[{label:'Chiudi'}])
  }catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}

function noteModal(it){const w=canW();
  modal('Note – '+it.title,`<label for="nt" style="margin-top:0">Note su questo ${it.kind==='folder'?'elemento':'file'}</label><textarea id="nt" ${w?'':'readonly'}>${esc(it.note||'')}</textarea>`,
    w?[cancel,{label:'Salva',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{note:o.querySelector('#nt').value.trim()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}]:[{label:'Chiudi'}])}
function editText(it){const w=canW();
  modal(it?it.title:'Nuova nota .txt',`<label for="n" style="margin-top:0">Nome file</label><input id="n" type="text" value="${esc(it?it.title:'note.txt')}" ${it&&!w?'readonly':''}><label for="tx">Testo</label><textarea id="tx" ${w?'':'readonly'}>${esc(it?it.text:'')}</textarea>`,
    w?[cancel,{label:'Salva',fn:async o=>{let n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');if(!/\.txt$/i.test(n))n+='.txt';
      const text=o.querySelector('#tx').value;
      try{if(it)await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:n,text,size:text.length});
        else await addDoc(col,{title:n,kind:'text',parent:cur,text,size:text.length,mime:'text/plain',note:'',by:uid,at:serverTimestamp()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}]:[{label:'Chiudi'}])}
function renameModal(it){
  modal('Rinomina',`<label for="n" style="margin-top:0">Nuovo nome</label><input id="n" type="text" value="${esc(it.title)}">`,[cancel,{label:'Rinomina',fn:async o=>{const n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');
    try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:n})}catch(e){return merr(o,'Operazione non riuscita.')}}}])}

async function open1(it){
  if(it.kind==='folder')location.href='documenti.html#'+it.id;
  else if(it.kind==='text')editText(it);
  else preview(it)}
async function unstar(it){
  if(!it)return false;
  if(!canW()){modal('Permesso mancante','<div class="mu">Per togliere la stella serve il permesso di scrittura su Documenti. Chiedi all’admin.</div>',[{label:'Chiudi'}]);return false}
  try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{star:false});return true}
  catch(e){console.error(e);modal('Errore','<div class="mu">Operazione non riuscita'+(e&&e.code?' ('+esc(e.code)+')':'')+'.</div>',[{label:'Chiudi'}]);return false}}
function moreModal(it){
  const w=canW(),b=[];
  b.push({label:it.kind==='folder'?'Apri cartella':'Apri online',cls:'ghost',fn:()=>{setTimeout(()=>open1(it),0)}});
  if(it.kind!=='folder')b.push({label:'Scarica',cls:'ghost',fn:()=>{setTimeout(()=>download(it),0)}});
  b.push({label:'Note',cls:'ghost',fn:()=>{setTimeout(()=>noteModal(it),0)}});
  if(w){if(it.kind==='text')b.push({label:'Modifica',cls:'ghost',fn:()=>{setTimeout(()=>editText(it),0)}});
    b.push({label:'Rinomina',cls:'ghost',fn:()=>{setTimeout(()=>renameModal(it),0)}});
    b.push({label:'Togli dai file importanti',cls:'ghost',fn:()=>{unstar(it)}})}
  const o=modal(it.title,'<div class="acts"></div>',[{label:'Chiudi',cls:'ghost'}]);
  const c=o.querySelector('.acts');b.forEach(x=>{const e=document.createElement('button');e.className='btn '+(x.cls||'');e.textContent=x.label;e.onclick=()=>{o.remove();x.fn()};c.append(e)});
}

function render(){
  if(!me||perm()==='n')return;
  const p=perm(),w=canW(),f=document.activeElement&&document.activeElement.id==='qi',t=q.trim().toLowerCase();
  const all=sortL(items.filter(i=>i.star)),list=t?all.filter(i=>(i.title+' '+(i.note||'')).toLowerCase().includes(t)):all;vis=list;
  const rows=list.map(i=>{const meta=[i.kind==='folder'?'':fmtSize(i.size),fmtDate(i)].filter(Boolean).join(' · ');
    const where=i.parent?`<div class="mu" style="font-size:.75rem">${esc(pathOf(i.parent))}</div>`:'';
    const star=selMode?`<input type="checkbox" class="sk" data-act="sel" data-id="${esc(i.id)}" ${sel.has(i.id)?'checked':''} aria-label="Seleziona ${esc(i.title)}">`:`<button class="star on" data-act="unstar" data-id="${esc(i.id)}" aria-pressed="true" aria-label="Togli dai file importanti: ${esc(i.title)}">★</button>`;
    return `<div class="frow">${star}<span class="fi" aria-hidden="true">${okThumb(i.thumb)?`<img class="th" src="${i.thumb}" alt="" loading="lazy">`:icon(i)}</span><button class="fn" data-act="open" data-id="${esc(i.id)}"><b>${esc(i.title)}</b>${where}</button><span class="meta">${esc(meta)}</span>${i.kind==='folder'?'':`<button class="btn ghost sm" data-act="save" data-id="${esc(i.id)}" aria-label="Scarica ${esc(i.title)}">Scarica</button>`}<button class="btn ghost sm" data-act="more" data-id="${esc(i.id)}" aria-label="Altre azioni per ${esc(i.title)}">⋯</button></div>`}).join('');
  const old=mine.filter(i=>!t||(i.title+' '+(i.note||'')).toLowerCase().includes(t));
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap" style="padding-bottom:${memoOpen?'210px':'90px'}"><div class="bar"><h2>File importanti</h2><span class="badge">${p==='w'?'Lettura e scrittura':'Solo lettura'}</span></div>
  <input id="qi" type="search" placeholder="Cerca nei file importanti" aria-label="Cerca nei file importanti" value="${esc(q)}" style="margin-bottom:12px">
  <div class="tools"><button class="btn ghost sm" data-act="selmode">${selMode?'Esci dalla selezione':'Seleziona'}</button>${selMode?`<button class="btn ghost sm" data-act="selall">Seleziona tutto</button><button class="btn sm" data-act="dlsel" ${sel.size?'':'disabled'}>Scarica selezionati (${sel.size})</button>`:''}</div>
  ${err?`<p class="err" role="alert">${esc(err)}</p>`:''}
  <div class="card">${list.length?rows:`<div class="mu">${t?'Nessun risultato.':(err?'':'Nessun file importante. Metti la stella a un documento in Documenti per vederlo qui.')}</div>`}</div>
  ${old.length?`<h3 style="margin:16px 0 8px">Altri elementi</h3><div class="card">${old.map(i=>`<div class="row"><div><b>${esc(i.title)}</b><div class="mu">${esc(i.note||'')}</div></div>${p==='w'?`<button class="btn ghost sm" data-d="${esc(i.id)}">Elimina</button>`:''}</div>`).join('')}</div>`:''}</div>`;
  if(f){const i=$('#qi');i.focus();i.setSelectionRange(q.length,q.length)}
  $('#qi').oninput=e=>{q=e.target.value;render()};
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act;
    if(a==='selmode'){selMode=!selMode;sel.clear();render();return}
    if(a==='selall'){vis.forEach(i=>sel.add(i.id));render();return}
    if(a==='dlsel'){dlSel();return}
    const it=byId(b.dataset.id);if(!it)return;
    if(a==='sel'){sel.has(it.id)?sel.delete(it.id):sel.add(it.id);render()}
    else if(a==='open'){if(selMode&&it.kind!=='folder'){sel.has(it.id)?sel.delete(it.id):sel.add(it.id);render()}else open1(it)}
    else if(a==='save')download(it);else if(a==='more')moreModal(it);else if(a==='unstar')unstar(it)});
  document.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>deleteDoc(doc(db,'sections',MINE,'items',b.dataset.d)).catch(()=>{}));
}

/* Promemoria in basso (come in Documenti): testo salvato in File importanti, modificabile da chi ha la scrittura */
function renderMemo(){
  const m=$('#memo');if(!me||perm()==='n'){m.innerHTML='';return}
  const w=perm()==='w';
  if(!memoOpen){m.innerHTML='<button class="btn ghost sm" id="mo" style="background:var(--sf)">Promemoria</button>';$('#mo').onclick=()=>setMemo(true);return}
  m.innerHTML=`<div class="card memo"><div class="mh"><b>Promemoria</b><span>${w&&!memoEdit?'<button class="btn ghost sm" id="me">Modifica</button> ':''}<button class="btn ghost sm" id="mc">Riduci</button></span></div>${memoEdit?`<textarea id="mt" aria-label="Testo promemoria">${esc(memoText)}</textarea><div class="dact"><button class="btn ghost sm" id="mx">Annulla</button><button class="btn sm" id="ms">Salva</button></div>`:`<div class="mb" tabindex="0">${memoText?esc(memoText):'<span class="mu">Nessun promemoria.</span>'}</div>`}</div>`;
  $('#mc').onclick=()=>{memoEdit=false;setMemo(false)};
  if($('#me'))$('#me').onclick=()=>{memoEdit=true;renderMemo()};
  if(memoEdit){$('#mx').onclick=()=>{memoEdit=false;renderMemo()};
    $('#ms').onclick=async()=>{try{await setDoc(doc(db,'sections',MINE,'meta','promemoria'),{text:$('#mt').value,by:uid,at:serverTimestamp()});memoEdit=false;renderMemo()}catch(e){modal('Errore','<div class="mu">Salvataggio non riuscito.</div>',[{label:'Chiudi'}])}}}
}
function setMemo(v){memoOpen=v;try{localStorage.setItem('imp_memo',v?'1':'0')}catch(e){}renderMemo();render()}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');$('#memo').innerHTML='';return}
      if(unsubs.length<2){
        unsubs.push(onSnapshot(col,s=>{err='';items=s.docs.map(d=>({id:d.id,...d.data()}));render()},()=>{err='Per vedere i file importanti serve il permesso di lettura su Documenti. Chiedi all’admin.';items=[];render()}));
        unsubs.push(onSnapshot(collection(db,'sections',MINE,'items'),s=>{mine=s.docs.map(d=>({id:d.id,...d.data()}));render()},()=>{}));
        unsubs.push(onSnapshot(doc(db,'sections',MINE,'meta','promemoria'),s=>{memoText=s.exists()?(s.data().text||''):'';if(!memoEdit)renderMemo()},()=>{}));
      }
      render();renderMemo();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
