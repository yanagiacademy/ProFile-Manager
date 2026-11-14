import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,deleteField,getDocs,Bytes,serverTimestamp} from "./fsx.js";
import {doc as rdoc,collection as rcollection,getDoc as rgetDoc,query as rquery,where as rwhere,onSnapshot as ronSnapshot} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {tgConfigured,tgClient,tgEntity,hasSession,tgErrText,tgTopic} from "./telegram.js";
import {tgSendCifrato,decifraBlob,CIFRA_ATTIVA} from "./cifra.js";
import {TG_FILES} from "./telegram-config.js";
import {memoBar} from "./promemoria.js";
import {showPreview,saveBlob,guessMime,makeThumb,okThumb} from "./file-tools.js";
import {GRADI,gradoLabel,gradoByLiv} from "./gradi.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

/* Esami: 16 categorie fisse (6 kyu … 10 dan, vedi gradi.js). In ogni categoria: documenti, foto, video e link.
   Ogni contenuto ha liv (1–16) = categoria. Chi ha la scrittura vede tutto; chi ha «Solo dati utente» (account collegato in Atleti)
   vede le categorie dalla prima fino al proprio grado; con la lettura vede tutto (atletiEmail/<email>.liv); le regole Firestore applicano lo stesso limite.
   Gli atleti non hanno la sessione Telegram: leggono solo i contenuti con la copia su Firebase (fb:true), per questo la casella è spuntata di default. */
const SEC='esami',MAX=20*1024*1024,CH=900000,MAX_TG=500*1024*1024;
let auth,db,col,uid=null,me=null,items=[],cat=0,flt='all',q='',unsubs=[],memo=null;
let subMode='',subOff=null,restricted=false,livMax=16,errRead=false,fbNew=true;
const perm=()=>me?(me.admin?'w':(((me.perms||{})[SEC]||'n')==='u'?'r':((me.perms||{})[SEC]||'n'))):'n';
const solo=()=>!!(me&&!me.admin&&(me.perms||{})[SEC]==='u');      /* «Solo dati utente»: vede le categorie fino al proprio grado; con Lettura o Scrittura vede tutto */
const canW=()=>perm()==='w';

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];if(subOff){subOff();subOff=null}subMode='';
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(solo()?'n':perm(),!!me.admin);
      subscribe();render();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
/* chi scrive legge dal registro (Telegram + Firebase); chi legge soltanto, da Firebase: l'atleta con la query limitata al proprio grado */
async function subscribe(){
  const mode=canW()?'w':'r';if(mode===subMode)return;
  subMode=mode;if(subOff){subOff();subOff=null}errRead=false;
  const cb=s=>{errRead=false;items=s.docs.map(d=>({id:d.id,...d.data()})).filter(i=>!i.archiviatoIl&&Number.isInteger(i.liv));render()};
  if(mode==='w'){restricted=false;livMax=16;subOff=onSnapshot(col,cb,()=>{});return}
  restricted=false;livMax=16;
  try{const e=auth.currentUser&&auth.currentUser.email;
    if(solo()){restricted=true;livMax=0;const k=e?await rgetDoc(rdoc(db,'atletiEmail',e.toLowerCase())):null;if(k&&k.exists())livMax=Number(k.data().liv)||0}}catch(x){console.error(x)}
  if(subMode!==mode)return;
  const rc=rcollection(db,'sections',SEC,'items');
  subOff=ronSnapshot(restricted?rquery(rc,rwhere('liv','<=',livMax)):rc,cb,e=>{console.error(e);errRead=true;render()});
  render()}

const byId=id=>items.find(i=>i.id===id);
const fmtSize=n=>!n?'':n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';
const fmtDate=i=>i.at&&i.at.toDate?i.at.toDate().toLocaleDateString('it-IT'):'';
const tipoOf=i=>{if(i.kind==='link')return 'link';const m=i.mime||'',n=(i.title||'').toLowerCase();
  if(m.startsWith('video/')||/\.(mp4|mov|m4v|avi|mkv|webm)$/.test(n))return 'video';
  if(m.startsWith('image/')||/\.(jpe?g|png|gif|webp|heic)$/.test(n))return 'foto';return 'documento'};
const TIPI={all:'Tutti',documento:'Documenti',foto:'Foto',video:'Video',link:'Link'};
const ICONE={link:'🔗',video:'🎞️',foto:'🖼️',documento:'📄'};
function icon(i){const t=tipoOf(i),n=(i.title||'').toLowerCase();if(t==='documento'){if(i.mime==='application/pdf'||n.endsWith('.pdf'))return '📕';if(/\.(docx?|odt|rtf)$/.test(n))return '📘';if(/\.(xlsx?|csv|ods)$/.test(n))return '📊'}return ICONE[t]}
const ico=i=>okThumb(i.thumb)?`<img class="th" src="${i.thumb}" alt="" loading="lazy">`:icon(i);
const belt=(g,c='')=>`<span class="belt ${c}" style="background:${g.bg}" aria-hidden="true"></span>`;
const visCats=()=>canW()?GRADI:GRADI.filter(g=>g.liv<=livMax);
const visItems=()=>items.filter(i=>canW()||!restricted||i.liv<=livMax);

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
  const all=visItems(),g=cat?gradoByLiv(cat):null;
  let body='';
  if(!w&&restricted&&!livMax)body=`<div class="note">Il tuo grado non è ancora stato impostato nella scheda Atleti: chiedilo al tuo allenatore o all’admin per vedere il materiale d’esame.</div>`;
  else if(errRead)body=`<div class="note">Non riesco a leggere il materiale. Se l’admin ha appena aggiornato le regole o il tuo grado, riapri la pagina tra poco.</div>`;
  const hdrNote=!w&&restricted&&livMax?`<div class="note">Vedi il materiale dalla prima categoria fino a <b>${esc(gradoLabel(gradoByLiv(livMax)))}</b>.</div>`:'';
  if(t){
    const list=all.filter(i=>(i.title+' '+(i.note||'')+' '+(i.url||'')).toLowerCase().includes(t)).sort((a,b)=>a.liv-b.liv||(a.title||'').localeCompare(b.title||'','it',{numeric:true}));
    body+=`<div class="card">${list.length?list.map(i=>row(i,true)).join(''):'<div class="mu">Nessun risultato.</div>'}</div>`}
  else if(!cat){
    const n=l=>all.filter(i=>i.liv===l).length;
    body+=`<div class="cats">${visCats().map(x=>`<button class="cat" data-act="cat" data-id="${x.liv}">${belt(x)}<span class="nm"><b>${esc(x.nome)}</b><span class="mu">${esc(x.cint)}</span></span><span class="n">${n(x.liv)||''}</span></button>`).join('')}</div>`}
  else{
    const inCat=all.filter(i=>i.liv===cat),cnt=k=>k==='all'?inCat.length:inCat.filter(i=>tipoOf(i)===k).length;
    const list=inCat.filter(i=>flt==='all'||tipoOf(i)===flt).sort((a,b)=>(a.title||'').localeCompare(b.title||'','it',{numeric:true}));
    body+=`${w?`<div class="tools"><button class="btn sm" data-act="upf">Carica file</button><button class="btn ghost sm" data-act="addlink">Aggiungi link</button><label class="mu" style="display:inline-flex;gap:6px;align-items:center;font-size:.85rem"><input type="checkbox" data-act="fbn" ${fbNew?'checked':''}> Visibile agli atleti (copia su Firebase)</label><input type="file" id="uf" multiple hidden></div>`:''}
    <div class="seg2" role="group" aria-label="Tipo di materiale">${Object.entries(TIPI).map(([k,l])=>`<button data-act="flt" data-id="${k}" aria-pressed="${flt===k}">${l}${cnt(k)?' · '+cnt(k):''}</button>`).join('')}</div>
    <div class="card">${list.length?list.map(i=>row(i,false)).join(''):'<div class="mu">'+(inCat.length?'Nessun elemento di questo tipo.':'Categoria vuota.'+(w?' Carica file o aggiungi un link.':''))+'</div>'}</div>`}
  const crumb=`<nav class="crumb" aria-label="Percorso"><button data-act="cat" data-id="0">Esami</button>${g?`<span aria-hidden="true">/</span><button data-act="cat" data-id="${g.liv}">${esc(g.nome)} - ${esc(g.cint)}</button>`:''}</nav>`;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca in Esami" aria-label="Cerca" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2>${g?belt(g,'beltS')+esc(g.nome)+' - '+esc(g.cint):'Esami'}</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div>
  ${w&&!cat&&!t?'<div class="mu" style="margin-bottom:10px;font-size:.85rem">Un atleta vede il materiale dalla prima categoria fino al grado indicato nella sua scheda in Atleti.</div>':''}${hdrNote}${crumb}${body}</div>`;
  if(f){const i=$('#q');i.focus();i.setSelectionRange(q.length,q.length)}
  $('#q').oninput=e=>{q=e.target.value;render()};
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{if(b.dataset.act==='fbn'){fbNew=b.checked;return}act(b.dataset.act,b.dataset.id)});
  const uf=$('#uf');if(uf)uf.onchange=()=>{uploadMany([...uf.files],cat);uf.value=''}}

function row(i,showCat){
  const g=gradoByLiv(i.liv),meta=[i.kind==='link'?'':fmtSize(i.size),fmtDate(i)].filter(Boolean).join(' · ');
  const where=showCat&&g?`<div class="mu" style="font-size:.75rem">${esc(g.nome)} - ${esc(g.cint)}</div>`:'';
  const sub=i.kind==='link'?`<div class="mu" style="font-size:.75rem;overflow:hidden;text-overflow:ellipsis">${esc(i.url||'')}</div>`:'';
  const nofb=canW()&&!i.fb?' <span class="mu" title="Solo su Telegram: gli atleti non lo vedono" aria-label="Solo su Telegram: gli atleti non lo vedono">🔒</span>':'';
  return `<div class="frow"><span class="fi" aria-hidden="true">${ico(i)}</span><button class="fn" data-act="open" data-id="${esc(i.id)}"><b>${esc(i.title)}</b>${nofb}${where}${sub}</button><span class="meta">${esc(meta)}</span>${i.note||canW()?`<button class="btn ghost sm" data-act="note" data-id="${esc(i.id)}" aria-label="Note di ${esc(i.title)}">Note${i.note?' •':''}</button>`:''}<button class="btn ghost sm" data-act="more" data-id="${esc(i.id)}" aria-label="Altre azioni per ${esc(i.title)}">⋯</button></div>`}

function act(a,id){
  const it=id?byId(id):null;
  if(a==='cat'){cat=+id||0;flt='all';q='';render()}
  else if(a==='flt'){flt=id;render()}
  else if(a==='upf')$('#uf').click();
  else if(a==='addlink')linkModal(null);
  else if(!it)return;
  else if(a==='open')openItem(it);
  else if(a==='note')noteModal(it);
  else if(a==='more')moreModal(it)}
function openItem(it){
  if(it.kind==='link'){const u=safeUrl(it.url);if(u)window.open(u,'_blank','noopener,noreferrer');return}
  preview(it)}
const safeUrl=u=>{try{const x=new URL(String(u||'').trim());return /^https?:$/.test(x.protocol)?x.href:''}catch(e){return ''}};

async function getBlob(it,say=()=>{}){
  if(it.tg&&!(it.chunks&&tgConfigured()&&!hasSession())){try{
    say('Collegamento a Telegram…');
    const {client}=await tgClient();const ent=await tgEntity(TG_FILES);const [m]=await client.getMessages(ent,{ids:[it.tg]});
    if(!m||!m.media)throw new Error('MISSING');
    const buf=await client.downloadMedia(m,{progressCallback:(r,t)=>say('Download: '+Math.round(Number(r)/Number(t)*100)+'%')});
    return await decifraBlob(new Blob([buf]),guessMime(it.title,it.mime))}catch(e){if(!it.chunks)throw e}}
  say('Preparazione del file…');
  const sn=await getDocs(collection(db,'sections',SEC,'items',it.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  return new Blob(parts,{type:guessMime(it.title,it.mime)})}
const dlErr=e=>e&&e.message==='MISSING'?'Il file non è più presente su Telegram.':(e&&e.message==='EMPTY')?'Il file non è disponibile: non ha una copia su Firebase.':'Operazione non riuscita: '+tgErrText(e);
function preview(it){showPreview({title:it.title,mime:it.mime,load:async say=>getBlob(it,say),errText:dlErr,extra:[]})}
async function download(it){
  const p=$('#prog');p.style.display='block';p.textContent='Preparazione del file…';
  try{saveBlob(await getBlob(it,t=>{p.textContent=t}),it.title);p.style.display='none'}
  catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}

function moreModal(it){
  const w=canW(),b=[];
  b.push({label:it.kind==='link'?'Apri il link':'Apri online',cls:'ghost',fn:()=>{setTimeout(()=>openItem(it),0)}});
  if(it.kind==='file')b.push({label:'Scarica',cls:'ghost',fn:()=>{setTimeout(()=>download(it),0)}});
  b.push({label:'Note',cls:'ghost',fn:()=>{setTimeout(()=>noteModal(it),0)}});
  if(w){
    if(it.kind==='link')b.push({label:'Modifica link',cls:'ghost',fn:()=>{setTimeout(()=>linkModal(it),0)}});
    else b.push({label:it.fb?'Togli la copia su Firebase':'Rendi visibile agli atleti',cls:'ghost',fn:()=>{setTimeout(()=>fbSet(it,!it.fb),0)}});
    b.push({label:'Rinomina',cls:'ghost',fn:()=>{setTimeout(()=>renameModal(it),0)}});
    b.push({label:'Sposta in un’altra categoria',cls:'ghost',fn:()=>{setTimeout(()=>moveModal(it),0)}});
    b.push({label:'Elimina',cls:'ghost',fn:()=>{setTimeout(()=>delModal(it),0)}})}
  const o=modal(it.title,'<div class="acts"></div>',[{label:'Chiudi',cls:'ghost'}]);
  const c=o.querySelector('.acts');b.forEach(x=>{const e=document.createElement('button');e.className='btn '+(x.cls||'');e.textContent=x.label;e.onclick=()=>{o.remove();x.fn()};c.append(e)})}
function noteModal(it){const w=canW();
  modal('Note – '+it.title,`<label for="nt" style="margin-top:0">Note</label><textarea id="nt" ${w?'':'readonly'}>${esc(it.note||'')}</textarea>`,
    w?[cancel,{label:'Salva',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{note:o.querySelector('#nt').value.trim()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}]:[{label:'Chiudi'}])}
function renameModal(it){
  modal('Rinomina',`<label for="n" style="margin-top:0">Nuovo nome</label><input id="n" type="text" value="${esc(it.title)}">`,[cancel,{label:'Rinomina',fn:async o=>{const n=o.querySelector('#n').value.trim();if(!n)return merr(o,'Inserisci un nome.');
    try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:n})}catch(e){return merr(o,'Operazione non riuscita.')}}}])}
function moveModal(it){
  modal('Sposta in…',`<label for="d" style="margin-top:0">Categoria di destinazione</label><select id="d">${GRADI.map(g=>`<option value="${g.liv}" ${g.liv===it.liv?'selected':''}>${esc(gradoLabel(g))}</option>`).join('')}</select>`,
    [cancel,{label:'Sposta',fn:async o=>{try{await updateDoc(doc(db,'sections',SEC,'items',it.id),{liv:+o.querySelector('#d').value})}catch(e){return merr(o,'Operazione non riuscita.')}}}])}
function linkModal(it){
  modal(it?'Modifica link':'Aggiungi link',`<label for="lt" style="margin-top:0">Titolo (facoltativo)</label><input id="lt" type="text" value="${esc(it?it.title:'')}"><label for="lu">Indirizzo (https://…)</label><input id="lu" type="url" inputmode="url" autocapitalize="off" spellcheck="false" value="${esc(it?it.url:'')}">`,
    [cancel,{label:'Salva',fn:async o=>{const u=safeUrl(o.querySelector('#lu').value);if(!u)return merr(o,'Inserisci un indirizzo valido che inizi con http:// o https://.');
      const t=o.querySelector('#lt').value.trim()||u.replace(/^https?:\/\/(www\.)?/,'').slice(0,80);
      try{if(it)await updateDoc(doc(db,'sections',SEC,'items',it.id),{title:t,url:u});
        else await addDoc(col,{kind:'link',liv:cat,title:t,url:u,note:'',fb:true,by:uid,at:serverTimestamp()})}catch(e){return merr(o,'Salvataggio non riuscito.')}}}])}
function delModal(it){
  modal('Spostare nel Cestino?',`<div class="mu">Spostare “${esc(it.title)}” nel Cestino? Resta recuperabile per 30 giorni, poi viene eliminato per sempre.</div>`,[cancel,{label:'Sposta nel Cestino',fn:async o=>{
    try{await deleteDoc(doc(db,'sections',SEC,'items',it.id))}
    catch(e){console.error(e);return merr(o,e&&e.message==='NOPUB'?'Il Cestino non è ancora attivo: l’admin deve aprire la Home una volta.':'Eliminazione non riuscita.')}}}])}

async function putChunks(id,file){
  const n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',SEC,'items',id,'chunks');
  try{for(let k=0;k<n;k++){const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)})}return n}
  catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}}
/* copia su Firebase di un file già su Telegram (fino a 20 MB), o sua rimozione */
async function fbSet(it,on){
  const p=$('#prog'),say=t=>{p.style.display='block';p.textContent=t},ref=doc(db,'sections',SEC,'items',it.id);
  try{
    if(!on){
      if(it.chunks&&it.tg){say('Rimozione della copia su Firebase…');await Promise.all(Array.from({length:it.chunks},(_,k)=>deleteDoc(doc(db,'sections',SEC,'items',it.id,'chunks','c'+k)).catch(()=>{})));await updateDoc(ref,{fb:false,chunks:deleteField()})}
      else await updateDoc(ref,{fb:false})}
    else if(it.kind==='file'&&it.tg&&!it.chunks){
      if(it.size>MAX){modal('File troppo grande','<div class="mu">Su Firebase si possono copiare file fino a 20 MB. Questo resta solo su Telegram e gli atleti non lo vedono: per i video grandi usa un link.</div>',[{label:'Chiudi'}]);p.style.display='none';return}
      const b=await getBlob(it,say);say('Copia su Firebase…');const n=await putChunks(it.id,b);await updateDoc(ref,{fb:true,chunks:n})}
    else await updateDoc(ref,{fb:true});
    p.style.display='none'
  }catch(e){p.style.display='none';console.error(e);modal('Operazione non riuscita','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}

async function upTg(file){
  const {client,tg}=await tgClient();const ent=await tgEntity(TG_FILES);
  const r=await tgSendCifrato(tg,client,ent,file,pr=>{$('#prog').textContent=file.name+': '+Math.round(pr*100)+'%'},await tgTopic(TG_FILES,SEC),SEC);
  return r.id}
/* ritorna true se il file è visibile agli atleti (copia su Firebase) */
async function up1(file,liv){
  const th=await makeThumb(file,file.name,file.type),tx=th?{thumb:th}:{};
  if(tgConfigured()){
    if(file.size>MAX_TG)throw new Error('size');
    const id=await upTg(file);
    const base={title:file.name,kind:'file',liv,size:file.size,mime:file.type||'',tg:id,...(CIFRA_ATTIVA?{enc:true}:{}),note:'',by:uid,at:serverTimestamp(),...tx};
    if(fbNew&&file.size<=MAX){const dref=doc(col),n=await putChunks(dref.id,file);await setDoc(dref,{...base,chunks:n,fb:true});return true}
    await addDoc(col,base);return false}
  if(file.size>MAX)throw new Error('size');
  const dref=doc(col),n=Math.max(1,Math.ceil(file.size/CH)),cc=collection(db,'sections',SEC,'items',dref.id,'chunks');
  try{for(let k=0;k<n;k++){const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());await setDoc(doc(cc,'c'+k),{i:k,data:Bytes.fromUint8Array(buf)})}
    await setDoc(dref,{title:file.name,kind:'file',liv,size:file.size,mime:file.type||'',chunks:n,fb:true,note:'',by:uid,at:serverTimestamp(),...tx});return true
  }catch(e){await Promise.all(Array.from({length:n},(_,k)=>deleteDoc(doc(cc,'c'+k)).catch(()=>{})));throw e}}
async function uploadMany(files,liv){
  if(!files.length||!liv)return;
  if(tgConfigured()&&!hasSession()){modal('Collega Telegram','<div class="mu">I file vengono salvati su Telegram. Accedi prima dalla pagina Chat, poi torna qui.</div>',[{label:'Chiudi',cls:'ghost'},{label:'Vai alla Chat',fn:()=>{location.href='chat.html'}}]);return}
  const p=$('#prog');let done=0,fail=0,idx=0,solo=0,lastErr='';
  const upd=()=>{p.style.display='block';p.textContent=`Caricamento ${done}/${files.length}`+(fail?` · errori: ${fail}`:'')};upd();
  const worker=async()=>{while(idx<files.length){const f=files[idx++];try{if(!(await up1(f,liv)))solo++}catch(x){fail++;lastErr=(x&&x.message==='size')?'size':tgErrText(x);console.error(x)}done++;upd()}};
  await Promise.all([worker(),worker(),worker()]);
  p.textContent=`Completato: ${files.length-fail} file caricati`+(solo?`; ${solo} solo su Telegram (gli atleti non li vedono)`:'')+(fail?`, ${fail} non riusciti (limite ${tgConfigured()?'500':'20'} MB a file; motivo: ${lastErr==='size'?'file troppo grande':lastErr})`:'');
  setTimeout(()=>{p.style.display='none'},fail||solo?15000:4000)}
