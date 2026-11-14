/* Promemoria in basso, in ogni sezione, di due tipi:
   1) "Questa pagina": testo della sezione (sections/<sezione>/meta/promemoria)
   2) "Tutte le pagine": testo comune a tutta la suite (app/promemoria)
   Chi li vede e chi li modifica lo decide l'admin in Gestione account → Promemoria (users/<uid>.memo = {page, all}):
   • page: 'auto' (default) = come la scheda (Lettura: vede, Scrittura: modifica), oppure 'n' nessuno, 'r' solo lettura, 'w' lettura e scrittura
   • all: 'n' nessuno, 'r' solo lettura (default), 'w' lettura e scrittura
   Valgono solo nelle pagine a cui l'account ha accesso con Lettura o Scrittura. L'admin vede e modifica tutto. */
import {doc,onSnapshot,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function memoBar({db,sec,uid}){
  const host=document.getElementById('memo');
  let perm='n',admin=false,tab='page',edit=false,errAll=false,cfg={};
  let open=(()=>{try{return localStorage.getItem('memo_open')!=='0'}catch(e){return true}})();
  const txt={page:'',all:''};
  const ref=t=>t==='page'?doc(db,'sections',sec,'meta','promemoria'):doc(db,'app','promemoria');
  const unsubs=[
    onSnapshot(ref('page'),s=>{txt.page=s.exists()?(s.data().text||''):'';if(!edit)render()},()=>{}),
    onSnapshot(ref('all'),s=>{errAll=false;txt.all=s.exists()?(s.data().text||''):'';if(!edit)render()},()=>{errAll=true;if(!edit)render()}),
    onSnapshot(doc(db,'users',uid),s=>{cfg=s.exists()?(s.data().memo||{}):{};if(!edit)render()},()=>{})];
  /* permessi effettivi sui due promemoria: perm = permesso sulla scheda ('r', 'w' oppure 'n' se non c'è accesso) */
  const ok=()=>perm==='r'||perm==='w';      /* «Solo dati utente» e nessun accesso: nessun promemoria */
  const eP=()=>admin?'w':(!ok()?'n':((cfg.page&&cfg.page!=='auto')?cfg.page:perm));
  const eA=()=>admin?'w':(!ok()?'n':(cfg.all||'r'));
  const shown=()=>eP()!=='n'||eA()!=='n';
  const canEdit=()=>tab==='page'?eP()==='w':eA()==='w';
  const pad=()=>{document.body.style.paddingBottom=!shown()?'':(open?'250px':'90px')};
  function setOpen(v){open=v;edit=false;try{localStorage.setItem('memo_open',v?'1':'0')}catch(e){}render()}
  function render(){
    if(!host)return;pad();
    if(!shown()){host.innerHTML='';return}
    if(tab==='page'&&eP()==='n')tab='all';
    if(tab==='all'&&eA()==='n')tab='page';
    const dot=((eP()!=='n'&&txt.page)||(eA()!=='n'&&txt.all))?' •':'';
    if(!open){host.innerHTML=`<button class="btn ghost sm" id="mo" style="background:var(--sf)">Promemoria${dot}</button>`;host.querySelector('#mo').onclick=()=>setOpen(true);return}
    const ce=canEdit();
    let body;
    if(tab==='all'&&errAll)body='<div class="mb mu">Il promemoria generale non è ancora attivo: l’admin deve pubblicare le regole di Firestore aggiornate (file firestore.rules).</div>';
    else if(edit)body=`<textarea id="mt" aria-label="Testo del promemoria">${esc(txt[tab])}</textarea><div class="dact"><button class="btn ghost sm" id="mx">Annulla</button><button class="btn sm" id="ms">Salva</button></div>`;
    else body=`<div class="mb" tabindex="0">${txt[tab]?esc(txt[tab]):'<span class="mu">Nessun promemoria.</span>'}</div>`;
    host.innerHTML=`<div class="card memo"><div class="mh"><span class="seg" role="group" aria-label="Tipo di promemoria">${eP()!=='n'?`<button data-t="page" aria-pressed="${tab==='page'}">Questa pagina</button>`:''}${eA()!=='n'?`<button data-t="all" aria-pressed="${tab==='all'}">Tutte le pagine</button>`:''}</span><span>${ce&&!edit&&!(tab==='all'&&errAll)?'<button class="btn ghost sm" id="me">Modifica</button> ':''}<button class="btn ghost sm" id="mc">Riduci</button></span></div>${body}</div>`;
    host.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;edit=false;render()});
    host.querySelector('#mc').onclick=()=>setOpen(false);
    const me=host.querySelector('#me');if(me)me.onclick=()=>{edit=true;render()};
    if(edit){
      host.querySelector('#mx').onclick=()=>{edit=false;render()};
      host.querySelector('#ms').onclick=async()=>{
        try{await setDoc(ref(tab),{text:host.querySelector('#mt').value,by:uid,at:serverTimestamp()});edit=false;render()}
        catch(e){console.error(e);alert('Salvataggio del promemoria non riuscito. Controlla i permessi.')}}}
  }
  return {
    setAccess(p,a){if(p===perm&&!!a===admin)return;perm=p;admin=!!a;edit=false;render()},
    destroy(){unsubs.forEach(f=>f());if(host)host.innerHTML='';document.body.style.paddingBottom=''}};
}
