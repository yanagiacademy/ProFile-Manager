import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio,limiteMB} from "./archivio.js";
import {tgErrText} from "./telegram.js";
import {memoBar} from "./promemoria.js";
import {showPreview,saveBlob,guessMime,okThumb} from "./file-tools.js";
import {inScadenza,giorni,fmtD,isD,pill} from "./scadenze.js";
import {archiviaDoc,archiviaScaduti} from "./conservazione.js";

/* Documenti in scadenza: mostra i file di "Documenti" con scadenza entro 30 giorni (o già scaduti).
   "Sostituisci" carica il documento nuovo nella stessa cartella e toglie quello vecchio. */
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='documenti',MINE='documenti-in-scadenza';
let auth,db,col,arch,uid=null,me=null,items=[],q='',unsubs=[],err='',memo=null;
const level=k=>me?(me.admin?'w':((me.perms||{})[k]||'n')):'n';
const perm=()=>level(MINE),canW=()=>level(SEC)==='w'&&level(MINE)==='w';
const byId=id=>items.find(i=>i.id===id);
const pathOf=id=>{const a=[];let x=byId(id);while(x){a.unshift(x.title);x=byId(x.parent)}return a.join(' / ')};
const where=i=>i.parent?pathOf(i.parent):'Documenti (cartella principale)';
function icon(i){const m=i.mime||'',n=i.title.toLowerCase();
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
const dlErr=e=>e&&e.message==='MISSING'?'Il file non è più presente su Telegram.':(e&&e.message==='EMPTY')?'Impossibile leggere il file.':'Operazione non riuscita: '+tgErrText(e);

async function download(it){
  const p=$('#prog');p.style.display='block';p.textContent='Preparazione del file…';
  try{saveBlob(await arch.getBlob(it,t=>{p.textContent=t}),it.title);p.style.display='none'}
  catch(e){p.style.display='none';console.error(e);modal('Errore','<div class="mu">'+esc(dlErr(e))+'</div>',[{label:'Chiudi'}])}}
function preview(it){
  let pv;
  pv=showPreview({title:it.title,mime:it.mime,load:say=>arch.getBlob(it,say),errText:dlErr,
    extra:canW()?[{label:'Sostituisci',fn:()=>{pv.close();replaceModal(it)}}]:[]})}

/* ---------- sostituzione ---------- */
function replaceModal(old){
  let touched=false;
  const o=modal('Sostituisci documento',
    `<div class="mu">Documento attuale: <b>${esc(old.title)}</b> (scadenza ${esc(fmtD(old.scadenza))}). Il nuovo documento viene salvato nella stessa cartella; quello attuale va in Archivio, dove viene conservato per 10 anni.</div>
    <label for="nf">File nuovo (limite ${limiteMB()} MB)</label><input id="nf" type="file">
    <label for="nn">Nome del documento</label><input id="nn" type="text" autocomplete="off">
    <label for="nd">Data di scadenza del nuovo documento</label><input id="nd" type="date">`,
    [cancel,{label:'Sostituisci',fn:async o=>{
      const file=o.querySelector('#nf').files[0],date=o.querySelector('#nd').value;let name=o.querySelector('#nn').value.trim();
      if(!file)return merr(o,'Scegli il file nuovo.');
      if(!name)return merr(o,'Inserisci il nome del documento.');
      if(!isD(date))return merr(o,'Inserisci la data di scadenza.');
      if(giorni(date)<=0)return merr(o,'La nuova scadenza deve essere successiva a oggi.');
      if(file.size>arch.maxBytes())return merr(o,'Il file supera il limite di '+limiteMB()+' MB.');
      if(arch.needsTelegram()){if(confirm('I file vengono salvati su Telegram: prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';return false}
      const m=file.name.match(/\.[A-Za-z0-9]{1,5}$/);
      if(m&&!/\.[A-Za-z0-9]{1,5}$/.test(name))name+=m[0];
      setTimeout(()=>doReplace(old,file,name,date),0)}}]);
  const nn=o.querySelector('#nn');
  nn.oninput=()=>{touched=true};
  o.querySelector('#nf').onchange=e=>{const f=e.target.files[0];if(f&&(!touched||!nn.value.trim())){nn.value=f.name;touched=false}};
  const hint=document.createElement('p');hint.className='mu';hint.style.margin='8px 0 0';hint.textContent='Se scrivi il nome senza estensione viene aggiunta quella del file.';nn.after(hint)}
async function doReplace(old,file,title,date){
  const p=$('#prog');p.style.display='block';p.textContent='Caricamento: '+title;
  try{await arch.save(file,{title,parent:old.parent||'',scadenza:date,star:!!old.star,note:old.note||''},pc=>{p.textContent='Caricamento: '+title+' '+pc+'%'})}
  catch(e){console.error(e);p.style.display='none';modal('Sostituzione non riuscita','<div class="mu">Il documento nuovo non è stato caricato ('+esc(arch.errText(e))+'). Il documento attuale non è stato toccato.</div>',[{label:'Chiudi'}]);return}
  p.textContent='Archiviazione del documento vecchio…';
  try{await archiviaDoc(db,old,items,'sostituito');p.textContent='Documento sostituito: “'+title+'”. Quello vecchio è in Archivio.';setTimeout(()=>{p.style.display='none'},5000)}
  catch(e){console.error(e);p.style.display='none';
    modal('Sostituzione quasi completata','<div class="mu">Il documento nuovo è stato caricato, ma non è stato possibile archiviare quello vecchio: resta in Documenti in scadenza. Riprova a sostituirlo o contatta l’admin.</div>',[{label:'Chiudi'}])}}

/* ---------- archiviazione senza sostituzione (es. documento non più obbligatorio) ---------- */
function archiveModal(it){
  modal('Archivia senza sostituire',
    `<div class="mu">“${esc(it.title)}” esce da Documenti e va in Archivio, dove viene conservato 10 anni e non può essere eliminato. Nessun documento nuovo prende il suo posto.</div>
    <label for="mv">Motivo (facoltativo)</label><input id="mv" type="text" autocomplete="off" placeholder="Es. documento non più obbligatorio">`,
    [cancel,{label:'Archivia',fn:async o=>{
      const cur=byId(it.id);if(!cur||cur.archiviatoIl)return merr(o,'Il documento è già stato archiviato.');
      const mv=o.querySelector('#mv').value.trim();
      try{await archiviaDoc(db,cur,items,'archiviato senza sostituzione'+(mv?': '+mv:''))}catch(e){console.error(e);return merr(o,'Archiviazione non riuscita.')}}}])}

/* ---------- elenco ---------- */
function render(){
  if(!me||perm()==='n')return;
  const p=perm(),w=canW(),f=document.activeElement&&document.activeElement.id==='qs',t=q.trim().toLowerCase();
  const all=items.filter(inScadenza).sort((a,b)=>giorni(a.scadenza)-giorni(b.scadenza)||a.title.localeCompare(b.title,'it'));
  const exp=all.filter(i=>giorni(i.scadenza)<0).length;
  const list=t?all.filter(i=>(i.title+' '+where(i)+' '+(i.note||'')).toLowerCase().includes(t)):all;
  const rows=list.map(i=>`<div class="frow"><span class="fi" aria-hidden="true">${okThumb(i.thumb)?`<img class="th" src="${i.thumb}" alt="" loading="lazy">`:icon(i)}</span><button class="fn" data-act="open" data-id="${esc(i.id)}"><b>${esc(i.title)}</b><div class="mu sm2">📁 ${esc(where(i))}</div><div class="mu sm2">Scadenza ${esc(fmtD(i.scadenza))}</div></button><span class="cd" role="status">${esc(pill(giorni(i.scadenza)))}</span>${w?`<button class="btn sm" data-act="rep" data-id="${esc(i.id)}" aria-label="Sostituisci ${esc(i.title)}">Sostituisci</button><button class="btn ghost sm" data-act="arc" data-id="${esc(i.id)}" aria-label="Archivia ${esc(i.title)} senza sostituirlo">Archivia</button>`:''}<button class="btn ghost sm" data-act="save" data-id="${esc(i.id)}" aria-label="Scarica ${esc(i.title)}">Scarica</button></div>`).join('');
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="qs" type="search" placeholder="Cerca nei documenti in scadenza" aria-label="Cerca" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2 class="ttl${all.length?' alarm':''}">Documenti in scadenza</h2><span class="badge">${p==='w'?'Lettura e scrittura':'Solo lettura'}</span></div>
  ${err?`<p class="err" role="alert">${esc(err)}</p>`:''}
  ${all.length?`<div class="card alarm" role="status" style="margin-bottom:12px"><b>${all.length} ${all.length===1?'documento':'documenti'} da rinnovare</b>${exp?` · ${exp} già ${exp===1?'scaduto':'scaduti'}`:''}</div>`:''}
  <div class="card">${list.length?rows:`<div class="mu">${t?'Nessun risultato.':(err?'':'Nessun documento in scadenza. Qui compaiono i file di Documenti con scadenza entro 30 giorni: per impostarla apri ⋯ su un file in Documenti e scegli “Imposta scadenza”.')}</div>`}</div>
  ${all.length&&!w&&!err?'<p class="mu" style="margin-top:10px">Per sostituire o archiviare un documento serve la scrittura su Documenti e su questa sezione.</p>':''}</div>`;
  if(f){const i=$('#qs');i.focus();i.setSelectionRange(q.length,q.length)}
  $('#qs').oninput=e=>{q=e.target.value;render()};
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const it=byId(b.dataset.id);if(!it)return;const a=b.dataset.act;
    if(a==='open')preview(it);else if(a==='save')download(it);else if(a==='rep')replaceModal(it);else if(a==='arc')archiveModal(it)});
}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;arch=archivio(db,SEC,uid);
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');if(memo)memo.setAccess('n',false);return}
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{err='';items=s.docs.map(d=>({id:d.id,...d.data()}));if(level(SEC)==='w')archiviaScaduti(db,items);render()},()=>{err='Per vedere i documenti in scadenza serve il permesso di lettura su Documenti. Chiedi all’admin.';items=[];render()}));
      if(!memo)memo=memoBar({db,sec:MINE,uid});memo.setAccess(perm(),!!me.admin);render();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
  /* i giorni mancanti si aggiornano da soli (ogni ora), se non c'è una finestra aperta */
  setInterval(()=>{if(me&&!document.querySelector('.ov,.pv-ov'))render()},3600000);
}
