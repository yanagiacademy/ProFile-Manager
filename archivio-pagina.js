import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";
import {archivio} from "./archivio.js";
import {tgErrText} from "./telegram.js";
import {memoBar} from "./promemoria.js";
import {showPreview,saveBlob,canThumb,makeThumb,okThumb} from "./file-tools.js";
import {fmtD} from "./scadenze.js";
import {archiviato,zona,riarchiviaDoc,archiviaScaduti,addMesi,oggiISO,ANNI} from "./conservazione.js";

/* Archivio: documenti scaduti o sostituiti, conservati 10 anni (obbligo A.S.D.).
   Da conservare = eliminazione bloccata. Verifica = periodo concluso: l'operatore guarda il documento e decide se eliminarlo o riarchiviarlo. */
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='documenti',MINE='archivio';
let auth,db,col,arch,uid=null,me=null,items=[],q='',tab='conservare',tabSet=false,unsubs=[],err='',memo=null;
const level=k=>me?(me.admin?'w':((me.perms||{})[k]||'n')):'n';
const perm=()=>level(MINE),canW=()=>level(SEC)==='w'&&level(MINE)==='w';
const byId=id=>items.find(i=>i.id===id);
const origine=i=>i.origine||'Documenti (cartella principale)';
function icon(i){const m=i.mime||'',n=i.title.toLowerCase();
  if(m.startsWith('image/'))return '🖼️';if(m.startsWith('video/'))return '🎞️';if(m.startsWith('audio/'))return '🎵';if(m==='application/pdf'||n.endsWith('.pdf'))return '📕';
  if(/\.(xlsx?|csv|ods)$/.test(n))return '📊';if(/\.(docx?|odt|rtf)$/.test(n))return '📘';if(/\.(zip|rar|7z)$/.test(n))return '🗜️';return '📄'}
const nRiarch=i=>(i.storico||[]).filter(x=>/riarchiviato/.test(x)).length;

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
  let pv;const dec=canW()&&zona(it)==='verifica';
  pv=showPreview({title:it.title,mime:it.mime,errText:dlErr,
    load:async say=>{const b=await arch.getBlob(it,say);
      if(canW()&&!it.thumb&&!it.thumbTry&&canThumb(it.title,it.mime))makeThumb(b,it.title,it.mime).then(u=>updateDoc(doc(db,'sections',SEC,'items',it.id),u?{thumb:u}:{thumbTry:true})).catch(()=>{});return b},
    extra:dec?[{label:'Riarchivia…',fn:()=>{pv.close();rearchModal(it)}},{label:'Elimina…',fn:()=>{pv.close();delModal(it)}}]:[]})}

/* ---------- decisioni sulla Verifica ---------- */
const PERIODI=[[6,'6 mesi'],[12,'1 anno'],[24,'2 anni'],[60,'5 anni'],[120,'10 anni']];
function rearchModal(it){
  const o=modal('Riarchivia – '+it.title,
    `<div class="mu">Il documento torna in “Da conservare” e non potrà essere eliminato fino alla nuova scadenza.</div>
    <label for="pe">Conserva per</label><select id="pe">${PERIODI.map(([m,t])=>`<option value="${m}">${t}</option>`).join('')}</select>
    <p class="mu" id="pd" style="margin-top:8px"></p>`,
    [cancel,{label:'Riarchivia',fn:async o=>{
      const cur=byId(it.id);if(!cur||zona(cur)!=='verifica')return merr(o,'Il documento non è più in Verifica.');
      const m=Number(o.querySelector('#pe').value),et=(PERIODI.find(x=>x[0]===m)||[0,m+' mesi'])[1];
      try{await riarchiviaDoc(db,cur,m,et)}catch(e){console.error(e);return merr(o,'Operazione non riuscita.')}}}]);
  const sel=o.querySelector('#pe'),pd=o.querySelector('#pd');
  const upd=()=>{pd.textContent='Conservazione fino al '+fmtD(addMesi(oggiISO(),Number(sel.value)))+'.'};
  sel.onchange=upd;upd()}
function delModal(it){
  modal('Eliminare definitivamente?',`<div class="mu">“${esc(it.title)}” ha concluso il periodo di conservazione (${esc(fmtD(it.conservaFino))}). Eliminandolo spariscono il documento e il file: l’operazione non si può annullare.</div>`,
    [cancel,{label:'Elimina',fn:async o=>{
      const cur=byId(it.id);if(!cur||zona(cur)!=='verifica')return merr(o,'Il documento non è più in Verifica.');
      try{await arch.removeSafe(cur)}catch(e){console.error(e);return merr(o,'Eliminazione non riuscita: il documento risulta ancora in conservazione o non hai i permessi.')}}}])}

/* ---------- elenco ---------- */
function render(){
  if(!me||perm()==='n')return;
  const p=perm(),w=canW(),f=document.activeElement&&document.activeElement.id==='qa',t=q.trim().toLowerCase();
  const arc=items.filter(archiviato).sort((a,b)=>String(a.conservaFino||'').localeCompare(String(b.conservaFino||''))||a.title.localeCompare(b.title,'it'));
  const con=arc.filter(i=>zona(i)==='conservare'),ver=arc.filter(i=>zona(i)==='verifica');
  if(!tabSet&&arc.length){tabSet=true;if(ver.length)tab='verifica'}
  const base=tab==='verifica'?ver:con,list=t?base.filter(i=>(i.title+' '+origine(i)+' '+(i.note||'')).toLowerCase().includes(t)):base;
  const rows=list.map(i=>{
    const r=nRiarch(i),info=`Archiviato il ${esc(fmtD(i.archiviatoIl))}${r?` · riarchiviato ${r} ${r===1?'volta':'volte'}`:''}`;
    const last=tab==='verifica'?`Conservazione terminata il ${esc(fmtD(i.conservaFino))}`:`🔒 Da conservare fino al ${esc(fmtD(i.conservaFino))} · non eliminabile`;
    const acts=tab==='verifica'?(w?`<button class="btn sm" data-act="rea" data-id="${esc(i.id)}" aria-label="Riarchivia ${esc(i.title)}">Riarchivia</button><button class="btn ghost sm" data-act="del" data-id="${esc(i.id)}" aria-label="Elimina ${esc(i.title)}">Elimina</button>`:''):'';
    return `<div class="frow"><span class="fi" aria-hidden="true">${okThumb(i.thumb)?`<img class="th" src="${i.thumb}" alt="" loading="lazy">`:icon(i)}</span><button class="fn" data-act="open" data-id="${esc(i.id)}"><b>${esc(i.title)}</b><div class="mu sm2">📁 ${esc(origine(i))}</div><div class="mu sm2">${info}</div><div class="mu sm2"${tab==='verifica'?' style="color:var(--tx);font-weight:700"':''}>${last}</div></button>${tab==='verifica'?'<span class="chip">Da verificare</span>':''}${acts}<button class="btn ghost sm" data-act="save" data-id="${esc(i.id)}" aria-label="Scarica ${esc(i.title)}">Scarica</button></div>`}).join('');
  const vuoto=t?'Nessun risultato.':err?'':tab==='verifica'?'Nessun documento da verificare.':'Nessun documento in conservazione. Qui arrivano i documenti scaduti o sostituiti.';
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="qa" type="search" placeholder="Cerca nell’archivio" aria-label="Cerca nell’archivio" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="bar"><h2>Archivio</h2><span class="badge">${p==='w'?'Lettura e scrittura':'Solo lettura'}</span></div>
  <p class="mu" style="margin:0 0 12px">Le A.S.D. devono conservare i documenti per ${ANNI} anni. In “Da conservare” i documenti non si possono eliminare; finito il periodo passano in “Verifica”.</p>
  ${err?`<p class="err" role="alert">${esc(err)}</p>`:''}
  <div class="seg" role="group" aria-label="Zona dell’archivio"><button data-act="tab" data-id="conservare" aria-pressed="${tab==='conservare'}">Da conservare (${con.length})</button><button data-act="tab" data-id="verifica" aria-pressed="${tab==='verifica'}">Verifica (${ver.length})</button></div>
  <div class="card">${list.length?rows:`<div class="mu">${vuoto}</div>`}</div>
  ${tab==='verifica'&&ver.length&&!w&&!err?'<p class="mu" style="margin-top:10px">Per eliminare o riarchiviare serve la scrittura su Documenti e su Archivio.</p>':''}</div>`;
  if(f){const i=$('#qa');i.focus();i.setSelectionRange(q.length,q.length)}
  $('#qa').oninput=e=>{q=e.target.value;render()};
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act;
    if(a==='tab'){tab=b.dataset.id;tabSet=true;render();return}
    const it=byId(b.dataset.id);if(!it)return;
    if(a==='open')preview(it);else if(a==='save')download(it);else if(a==='rea')rearchModal(it);else if(a==='del')delModal(it)});
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
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{err='';items=s.docs.map(d=>({id:d.id,...d.data()}));if(level(SEC)==='w')archiviaScaduti(db,items);render()},()=>{err='Per vedere l’archivio serve il permesso di lettura su Documenti. Chiedi all’admin.';items=[];render()}));
      if(!memo)memo=memoBar({db,sec:MINE,uid});memo.setAccess(perm(),!!me.admin);render();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
  /* il passaggio da "Da conservare" a "Verifica" avviene da solo a mezzanotte: ricalcolo ogni ora */
  setInterval(()=>{if(me&&!document.querySelector('.ov,.pv-ov'))render()},3600000);
}
