import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,deleteField,getDocs,Bytes,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {tgConfigured,tgClient,tgEntity,hasSession,tgErrText,tgSendFile,tgTopic} from "./telegram.js";
import {TG_FILES} from "./telegram-config.js";
import {memoBar} from "./promemoria.js";
import {inScadenza,giorni,fmtD,isD,testo} from "./scadenze.js";
import {archiviaScaduti} from "./conservazione.js";
import {showPreview,saveBlob,saveZip,guessMime,makeThumb,canThumb,okThumb,thumbWatcher} from "./file-tools.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='documenti',MAX=20*1024*1024,CH=900000,MAX_TG=500*1024*1024;
let auth,db,col,uid=null,me=null,items=[],cur='',q='',unsubs=[],hashDone=false,selMode=false,sel=new Set(),vis=[];
let view=(()=>{try{return localStorage.getItem('doc_view')||'list'}catch(e){return 'list'}})();
let memo=null;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const canW=()=>perm()==='w';

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');if(memo)memo.setAccess('n',false);return}
      if(unsubs.length<2){
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()})).filter(i=>!i.archiviatoIl);if(canW())archiviaScaduti(db,items);if(!hashDone){hashDone=true;const h=location.hash.slice(1);if(h&&byId(h)&&byId(h).kind==='folder')cur=h}if(cur&&!byId(cur))cur='';render()},()=>{}));
      }
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);render();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}

const byId=id=>items.find(i=>i.id===id);
const children=id=>items.filter(i=>(i.parent||'')===id);
const descendants=id=>children(id).flatMap(c=>[c,...descendants(c.id)]);
const pathOf=id=>{const a=[];let x=byId(id);while(x){a.unshift(x.title);x=byId(x.parent)}return a.join(' / ')};
const sortL=l=>l.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.title.localeCompare(b.title,'it',{numeric:true}));
const fmtSize=n=>!n?'':n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';
const fmtDate=i=>i.at&&i.at.toDate?i.at.toDate().toLocaleDateString('it-IT'):'';
function icon(i){if(i.kind==='folder')return '📁';if(i.kind==='text')return '📝';const m=i.mime||'',n=i.title.toLowerCase();
  if(m.startsWith('image/'))return '🖼️';if(m.startsWith('video/'))return '🎞️';if(m.startsWith('audio/'))return '🎵';if(m==='application/pdf'||n.endsWith('.pdf'))return '📕';
  if(/\.(xlsx?|csv|ods)$/.test(n))return '📊';if(/\.(docx?|odt|rtf)$/.test(n))return '📘';if(/\.(zip|rar|7z)$/.test(n))return '🗜️';return '📄'}

const starBtn=i=>`<button class="star${i.star?' on':''}" data-act="star" data-id="${esc(i.id)}" aria-pressed="${!!i.star}" aria-label="${i.star?'Togli dai file importanti':'Aggiungi ai file importanti'}: ${esc(i.title)}">${i.star?'★':'☆'}</button>`;
const chk=i=>`<input type="checkbox" class="sk" data-act="sel" data-id="${esc(i.id)}" ${sel.has(i.id)?'checked':''} aria-label="Seleziona ${esc(i.title)}">`;
const lead=i=>selMode?chk(i):starBtn(i);
async function toggleStar(it){
  if(!it)return false;
  if(!canW()){modal('Permesso mancante','<div class="mu">Per mettere la stella serve il permesso di scrittura su Documenti. Chiedi all’admin.</div>',[{label:'Chiudi'}]);return false}
  try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{star:!it.star});return true}
  catch(e){console.error(e);modal('Errore','<div class="mu">Impossibile aggiornare la stella'+(e&&e.code?' ('+esc(e.code)+')':'')+'. Riprova tra poco.</div>',[{label:'Chiudi'}]);return false}}

const scadLine=i=>{if(i.kind!=='file'||!isD(i.scadenza))return '';const g=giorni(i.scadenza),hot=inScadenza(i);
  return `<div class="mu" style="font-size:.75rem${hot?';color:var(--er);font-weight:700':''}">Scadenza ${esc(fmtD(i.scadenza))} · ${esc(testo(g))}</div>`};
const ico=i=>okThumb(i.thumb)?`<img class="th" src="${i.thumb}" alt="" loading="lazy">`:icon(i);

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

function render(){
  if(!me||perm()==='n')return;
  const w=canW(),f=document.activeElement&&document.activeElement.id==='q',t=q.trim().toLowerCase();
  const list=sortL(t?items.filter(i=>i.title.toLowerCase().includes(t)):children(cur));vis=list;
  const crumbs=[];let x=byId(cur);while(x){crumbs.unshift(x);x=byId(x.parent)}
  const rows=list.map(i=>{const meta=[i.kind==='folder'?'':fmtSize(i.size),fmtDate(i)].filter(Boolean).join(' · ');
    const where=t&&i.parent?`<div class="mu" style="font-size:.75rem">${esc(pathOf(i.parent))}</div>`:'';
    return view==='list'
      ?`<div class="frow"${thAttr(i)}>${lead(i)}<span class="fi" aria-hidden="true">${ico(i)}</span><button class="fn" data-act="open" data-id="${esc(i.id)}"><b>${esc(i.title)}</b>${i.fb?' <span class="mu" title="Salvato anche su Firebase" aria-label="Salvato anche su Firebase">☁</span>':''}${where}${scadLine(i)}</button><span class="meta">${esc(meta)}</span><button class="btn ghost sm" data-act="note" data-id="${esc(i.id)}" aria-label="Note di ${esc(i.title)}">Note${i.note?' •':''}</button><button class="btn ghost sm" data-act="more" data-id="${esc(i.id)}" aria-label="Altre azioni per ${esc(i.title)}">⋯</button></div>`
      :`<div class="ico"${thAttr(i)}>${lead(i)}<button class="big" data-act="open" data-id="${esc(i.id)}" aria-label="Apri ${esc(i.title)}">${ico(i)}</button><button class="nm" data-act="open" data-id="${esc(i.id)}">${esc(i.title)}</button><button class="more" data-act="more" data-id="${esc(i.id)}" aria-label="Altre azioni per ${esc(i.title)}">⋯</button></div>`}).join('');
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca in Documenti" aria-label="Cerca" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2>Documenti</h2><div class="seg" role="group" aria-label="Vista"><button data-act="view" data-id="icons" aria-pressed="${view==='icons'}">Icone</button><button data-act="view" data-id="list" aria-pressed="${view==='list'}">Elenco</button></div></div>
  ${w?`<div class="tools"><button class="btn sm" data-act="upf">Carica file</button><button class="btn sm" data-act="upd">Carica cartella</button><button class="btn ghost sm" data-act="newdir">Nuova cartella</button><button class="btn ghost sm" data-act="newtxt">Nuova nota .txt</button><label class="mu" style="display:inline-flex;gap:6px;align-items:center;font-size:.85rem"><input type="checkbox" data-act="fbn" ${fbNew?'checked':''}> Salva anche su Firebase</label><input type="file" id="uf" multiple hidden><input type="file" id="ud" webkitdirectory hidden></div>`:''}
  <div class="tools"><button class="btn ghost sm" data-act="selmode">${selMode?'Esci dalla selezione':'Seleziona'}</button>${selMode?`<button class="btn ghost sm" data-act="selall">Seleziona tutto</button><button class="btn sm" data-act="dlsel" ${sel.size?'':'disabled'}>Scarica selezionati (${sel.size})</button>`:''}</div>
  <nav class="crumb" aria-label="Percorso"><button data-act="goto" data-id="">Documenti</button>${crumbs.map(c=>`<span aria-hidden="true">/</span><button data-act="goto" data-id="${esc(c.id)}">${esc(c.title)}</button>`).join('')}</nav>
  <div class="card">${list.length?(view==='list'?rows:`<div class="icons">${rows}</div>`):`<div class="mu">${t?'Nessun risultato.':'Cartella vuota.'+(w?' Carica file o crea una cartella.':'')}</div>`}</div></div>`;
  if(f){const i=$('#q');i.focus();i.setSelectionRange(q.length,q.length)}
  $('#q').oninput=e=>{q=e.target.value;render()};
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{if(b.dataset.act==='fbn'){fbNew=b.checked;return}act(b.dataset.act,b.dataset.id)});
  if(w){const uf=$('#uf'),ud=$('#ud');
    uf.onchange=()=>{uploadMany([...uf.files].map(file=>({file,parent:cur})));uf.value=''};
    ud.onchange=()=>uploadFolder([...ud.files]);}
  tw.watch(app);
}

function act(a,id){
  const it=id?byId(id):null;
  if(a==='view'){view=id;try{localStorage.setItem('doc_view',view)}catch(e){}render()}
  else if(a==='goto'){cur=id;q='';render()}
  else if(a==='upf')$('#uf').click();
  else if(a==='upd')$('#ud').click();
  else if(a==='newdir')newDir();
  else if(a==='newtxt')editText(null);
  else if(a==='selmode'){selMode=!selMode;sel.clear();render()}
  else if(a==='selall'){vis.forEach(i=>sel.add(i.id));render()}
  else if(a==='dlsel')dlSel();
  else if(!it)return;
  else if(a==='sel'){sel.has(it.id)?sel.delete(it.id):sel.add(it.id);render()}
  else if(a==='open'){if(selMode&&it.kind!=='folder'){sel.has(it.id)?sel.delete(it.id):sel.add(it.id);render()}else openItem(it)}
  else if(a==='star')toggleStar(it);
  else if(a==='note')noteModal(it);
  else if(a==='more')moreModal(it);
}
async function openItem(it){
  if(it.kind==='folder'){cur=it.id;q='';render()}
  else if(it.kind==='text')editText(it);
  else preview(it)}
async function getBlob(it,say=()=>{}){
  if(it.kind==='text')return new Blob([it.text||''],{type:'text/plain'});
  if(it.tg&&!(it.chunks&&tgConfigured()&&!hasSession())){try{
    say('Collegamento a Telegram…');
    const {client}=await tgClient();const ent=await tgEntity(TG_FILES);const [m]=await client.getMessages(ent,{ids:[it.tg]});
    if(!m||!m.media)throw new Error('MISSING');
    const buf=await client.downloadMedia(m,{progressCallback:(r,t)=>say('Download: '+Math.round(Number(r)/Number(t)*100)+'%')});
    return new Blob([buf],{type:guessMime(it.title,it.mime)})}catch(e){if(!it.chunks)throw e}}
  say('Preparazione del file…');
  const sn=await getDocs(collection(db,'sections',SEC,'items',it.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(it.title,it.mime)})}
const dlErr=e=>e&&e.message==='MISSING'?'Il file non è più presente su Telegram.':(e&&e.message==='EMPTY')?'Impossibile leggere il file.':'Operazione non riuscita: '+tgErrText(e);
function saveThumbLater(it,blob){
  if(!canW()||it.thumb||it.thumbTry||!canThumb(it.title,it.mime))return;
  makeThumb(blob,it.title,it.mime).then(u=>updateDoc(doc(db,'sections',SEC,'items',it.id),u?{thumb:u}:{thumbTry:true})).catch(()=>{})}
/* Miniature automatiche: solo per i file rimasti visibili a schermo per un paio di secondi */
const tw=thumbWatcher(async id=>{
  const it=byId(id);if(!it||it.thumb||it.thumbTry||!canW())return;
  if(it.tg&&tgConfigured()&&!hasSession())return;
  const b=await getBlob(it),u=await makeThumb(b,it.title,it.mime);
  await updateDoc(doc(db,'sections',SEC,'items',it.id),u?{thumb:u}:{thumbTry:true})});
const thAttr=i=>canW()&&i.kind==='file'&&!i.thumb&&!i.thumbTry&&canThumb(i.title,i.mime)&&(i.size||0)<=40*1024*1024?` data-thid="${esc(i.id)}"`:'';
function preview(it){
  const lab=on=>on?'★ Togli dai file importanti':'☆ Aggiungi ai file importanti';
  showPreview({title:it.title,mime:it.mime,load:async say=>{const b=await getBlob(it,say);saveThumbLater(it,b);return b},errText:dlErr,
    extra:[{label:()=>lab(!!(byId(it.id)||it).star),fn:async b=>{const cur0=byId(it.id)||it,was=!!cur0.star;if(await toggleStar(cur0))b.textContent=lab(!was)}}]})}
async function upTg(file){
  const {client,tg}=await tgClient();const ent=await tgEntity(TG_FILES);
  const r=await tgSendFile(tg,client,ent,file,pr=>{$('#prog').textContent=file.name+': '+Math.round(pr*100)+'%'},'auto',undefined,await tgTopic(TG_FILES,SEC));
  return r.id}
async function download(it){
  const p=$('#prog');p.style.display='block';p.textContent='Preparazione del file…';
  try{saveBlob(await getBlob(it,t=>{p.textContent=t}),it.title);p.style.display='none'}
  catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}
async function dlSel(){
  const picked=[...sel].map(byId).filter(Boolean);if(!picked.length)return;
  const p=$('#prog');p.style.display='block';const say=t=>{p.textContent=t};
  try{
    if(picked.length===1&&picked[0].kind!=='folder'){say('Preparazione del file…');saveBlob(await getBlob(picked[0],say),picked[0].title);p.style.display='none';return}
    const entries=[];const walk=(x,base)=>{if(x.kind==='folder')children(x.id).forEach(c=>walk(c,base+x.title+'/'));else entries.push({path:base+x.title,load:()=>getBlob(x,say)})};
    picked.forEach(x=>walk(x,''));
    if(!entries.length){p.style.display='none';modal('Selezione vuota','<div class="mu">Le cartelle scelte non contengono file.</div>',[{label:'Chiudi'}]);return}
    const bad=await saveZip(entries,'documenti.zip',say);p.style.display='none';
    if(bad)modal('Download completato in parte','<div class="mu">'+bad+' file non sono stati inclusi nello ZIP perché non è stato possibile leggerli.</div>',[{label:'Chiudi'}])
  }catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}

function moreModal(it){
  const w=canW(),b=[];
  b.push({label:it.kind==='folder'?'Apri':'Apri online',cls:'ghost',fn:()=>{setTimeout(()=>openItem(it),0)}});
  if(it.kind!=='folder')b.push({label:'Scarica',cls:'ghost',fn:()=>{setTimeout(()=>download(it),0)}});
  b.push({label:'Note',cls:'ghost',fn:()=>{setTimeout(()=>noteModal(it),0)}});
  if(w){b.push({label:it.star?'Togli dai file importanti':'Aggiungi ai file importanti',cls:'ghost',fn:()=>{toggleStar(it)}});
    if(it.kind==='text')b.push({label:'Modifica',cls:'ghost',fn:()=>{setTimeout(()=>editText(it),0)}});
    if(it.kind==='file')b.push({label:it.scadenza?'Scadenza…':'Imposta scadenza',cls:'ghost',fn:()=>{setTimeout(()=>scadModal(it),0)}});
    b.push({label:it.fb?'Togli da Firebase':'Salva anche su Firebase',cls:'ghost',fn:()=>{setTimeout(()=>fbSet(it,!it.fb),0)}});
    b.push({label:'Rinomina',cls:'ghost',fn:()=>{setTimeout(()=>renameModal(it),0)}});
    b.push({label:'Sposta',cls:'ghost',fn:()=>{setTimeout(()=>moveModal(it),0)}});
    b.push({label:'Elimina',cls:'ghost',fn:()=>{setTimeout(()=>delModal(it),0)}})}
  const o=modal(it.title,'<div class="acts"></div>',[{label:'Chiudi',cls:'ghost'}]);
  const c=o.querySelector('.acts');b.forEach(x=>{const e=document.createElement('button');e.className='btn '+(x.cls||'');e.textContent=x.label;e.onclick=()=>{o.remove();x.fn()};c.append(e)});
}
function scadModal(it){
  const btns=[cancel];
  if(isD(it.scadenza))btns.push({label:'Rimuovi scadenza',cls:'ghost',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{scadenza:deleteField()})}catch(e){return merr(o,'Operazione non riuscita.')}}});
  btns.push({label:'Salva',fn:async o=>{const d=o.querySelector('#sd').value;if(!isD(d))return merr(o,'Inserisci una data valida.');
    try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{scadenza:d})}catch(e){return merr(o,'Salvataggio non riuscito.')}}});
  modal('Scadenza – '+it.title,`<div class="mu">Quando mancano 30 giorni o meno il file compare in “Documenti in scadenza”.</div><label for="sd">Data di scadenza</label><input id="sd" type="date" value="${esc(isD(it.scadenza)?it.scadenza:'')}" style="width:100%;padding:10px 12px;border:1px solid var(--ln);border-radius:8px;background:var(--bg);min-height:44px">`,btns)}
function noteModal(it){const w=canW();
  modal('Note – '+it.title,`<label for="nt" style="margin-top:0">Note su questo ${it.kind==='folder'?'elemento':'file'}</label><textarea id="nt" ${w?'':'readonly'}>${esc(it.note||'')}</textarea>`,
    w?[cancel,{label:'Salva',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{note:o.querySelector('#nt').value.trim()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}]:[{label:'Chiudi'}])}
function newDir(){
  modal('Nuova cartella','<label for="n" style="margin-top:0">Nome</label><input id="n" type="text">',[cancel,{label:'Crea',fn:async o=>{const n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');
    try{await mkFolder(n,cur)}catch(e){return merr(o,'Creazione non riuscita.')}}}])}
/* "Salva anche su Firebase": vale per i contenuti creati mentre la casella è spuntata (fb:true = copia su Firebase) */
let fbNew=false;
const fbx=()=>fbNew?{fb:true}:{};
const mkFolder=(name,parent)=>addDoc(col,{title:name,kind:'folder',parent,note:'',by:uid,at:serverTimestamp(),...fbx()});
function editText(it){const w=canW();
  modal(it?it.title:'Nuova nota .txt',`<label for="n" style="margin-top:0">Nome file</label><input id="n" type="text" value="${esc(it?it.title:'note.txt')}" ${it&&!w?'readonly':''}><label for="tx">Testo</label><textarea id="tx" ${w?'':'readonly'}>${esc(it?it.text:'')}</textarea>`,
    w?[cancel,{label:'Salva',fn:async o=>{let n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');if(!/\.txt$/i.test(n))n+='.txt';
      const text=o.querySelector('#tx').value;
      try{if(it)await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:n,text,size:text.length});
        else await addDoc(col,{title:n,kind:'text',parent:cur,text,size:text.length,mime:'text/plain',note:'',by:uid,at:serverTimestamp(),...fbx()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}]:[{label:'Chiudi'}])}
function renameModal(it){
  modal('Rinomina',`<label for="n" style="margin-top:0">Nuovo nome</label><input id="n" type="text" value="${esc(it.title)}">`,[cancel,{label:'Rinomina',fn:async o=>{const n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');
    try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:n})}catch(e){return merr(o,'Operazione non riuscita.')}}}])}
function moveModal(it){
  const bad=new Set([it.id,...(it.kind==='folder'?descendants(it.id).map(d=>d.id):[])]);
  const dirs=items.filter(i=>i.kind==='folder'&&!bad.has(i.id)).map(i=>({id:i.id,p:pathOf(i.id)})).sort((a,b)=>a.p.localeCompare(b.p,'it'));
  modal('Sposta in…',`<label for="d" style="margin-top:0">Cartella di destinazione</label><select id="d"><option value="">Documenti (radice)</option>${dirs.map(d=>`<option value="${esc(d.id)}" ${d.id===(it.parent||'')?'selected':''}>${esc(d.p)}</option>`).join('')}</select>`,
    [cancel,{label:'Sposta',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{parent:o.querySelector('#d').value})}catch(e){return merr(o,'Operazione non riuscita.')}}}])}
function delModal(it){
  const n=it.kind==='folder'?descendants(it.id).length:0;
  modal('Eliminare?',`<div class="mu">Eliminare “${esc(it.title)}”${n?` e i suoi ${n} elementi`:''}? L’operazione non si può annullare.</div>`,[cancel,{label:'Elimina',fn:async o=>{
    const all=[it,...(it.kind==='folder'?descendants(it.id):[])];
    try{await Promise.all(all.map(async x=>{
      if(x.kind==='file'&&x.tg){try{const {client}=await tgClient();await client.deleteMessages(await tgEntity(TG_FILES),[x.tg],{revoke:true})}catch(e){}}
      if(x.kind==='file'&&x.chunks)await Promise.all(Array.from({length:x.chunks},(_,k)=>deleteDoc(doc(db,'sections',SEC,'items',x.id,'chunks','c'+k)).catch(()=>{})));
      await deleteDoc(doc(db,'sections',SEC,'items',x.id))}))}catch(e){return merr(o,'Eliminazione non riuscita.')}}}])}

async function putChunks(id,file){
  const n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',SEC,'items',id,'chunks');
  try{for(let k=0;k<n;k++){const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)})}return n}
  catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}}
/* Aggiunge o toglie la copia su Firebase di un contenuto (per i file copia anche il contenuto, fino a 20 MB) */
async function fbSet(it,on){
  const p=$('#prog'),say=t=>{p.style.display='block';p.textContent=t},ref=doc(db,'sections',SEC,'items',it.id);
  try{
    if(!on){
      if(it.chunks&&it.tg){say('Rimozione della copia su Firebase…');await Promise.all(Array.from({length:it.chunks},(_,k)=>deleteDoc(doc(db,'sections',SEC,'items',it.id,'chunks','c'+k)).catch(()=>{})));await updateDoc(ref,{fb:false,chunks:deleteField()})}
      else await updateDoc(ref,{fb:false})}
    else if(it.kind==='file'&&it.tg&&!it.chunks){
      if(it.size>MAX){modal('File troppo grande','<div class="mu">Su Firebase si possono copiare file fino a 20 MB. Questo resta solo su Telegram.</div>',[{label:'Chiudi'}]);p.style.display='none';return}
      const b=await getBlob(it,say);say('Copia su Firebase…');const n=await putChunks(it.id,b);await updateDoc(ref,{fb:true,chunks:n})}
    else await updateDoc(ref,{fb:true});
    p.style.display='none'
  }catch(e){p.style.display='none';console.error(e);modal('Operazione non riuscita','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}
async function up1(file,parent){
  const th=await makeThumb(file,file.name,file.type),tx=th?{thumb:th}:{};
  if(tgConfigured()){
    if(file.size>MAX_TG)throw new Error('size');
    const id=await upTg(file);
    const base={title:file.name,kind:'file',parent,size:file.size,mime:file.type||'',tg:id,note:'',by:uid,at:serverTimestamp(),...tx};
    if(fbNew&&file.size<=MAX){const dref=doc(col),n=await putChunks(dref.id,file);await setDoc(dref,{...base,chunks:n,fb:true});return}
    await addDoc(col,{...base,...fbx()});return}
  if(file.size>MAX)throw new Error('size');
  const dref=doc(col),n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',SEC,'items',dref.id,'chunks');
  try{for(let k=0;k<n;k++){const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)})}
    await setDoc(dref,{title:file.name,kind:'file',parent,size:file.size,mime:file.type||'',chunks:n,note:'',by:uid,at:serverTimestamp(),...tx})
  }catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}}
async function uploadMany(entries){
  if(!entries.length)return;
  if(tgConfigured()&&!hasSession()){modal('Collega Telegram','<div class="mu">I file vengono salvati su Telegram. Accedi prima dalla pagina Chat, poi torna qui.</div>',[{label:'Chiudi',cls:'ghost'},{label:'Vai alla Chat',fn:()=>{location.href='chat.html'}}]);return}
  const p=$('#prog');let done=0,fail=0,idx=0,lastErr='';
  const upd=()=>{p.style.display='block';p.textContent=`Caricamento ${done}/${entries.length}`+(fail?` · errori: ${fail}`:'')};upd();
  const worker=async()=>{while(idx<entries.length){const e=entries[idx++];try{await up1(e.file,e.parent)}catch(x){fail++;lastErr=(x&&x.message==='size')?'size':tgErrText(x);console.error(x)}done++;upd()}};
  await Promise.all([worker(),worker(),worker()]);
  p.textContent=`Completato: ${entries.length-fail} file caricati`+(fail?`, ${fail} non riusciti (limite ${tgConfigured()?'500':'20'} MB a file; motivo: ${lastErr==='size'?'file troppo grande':lastErr})`:'');setTimeout(()=>{p.style.display='none'},fail?15000:4000)}
async function uploadFolder(files){
  const map={},entries=[];
  try{for(const f of files){const parts=(f.webkitRelativePath||f.name).split('/'),dirs=parts.slice(0,-1);let parent=cur,acc='';
    for(const d of dirs){acc+='/'+d;if(!(acc in map))map[acc]=(await mkFolder(d,parent)).id;parent=map[acc]}
    entries.push({file:f,parent})}}catch(e){modal('Errore','<div class="mu">Creazione delle cartelle non riuscita.</div>',[{label:'Chiudi'}]);return}
  uploadMany(entries)}

