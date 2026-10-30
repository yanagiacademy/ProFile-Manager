/* Promemoria in basso, in ogni sezione, di due tipi:
   1) "Questa pagina": testo della sezione (sections/<sezione>/meta/promemoria), modificabile da chi ha la scrittura
   2) "Tutte le pagine": testo comune a tutta la suite (app/promemoria), modificabile solo dall'admin */
import {doc,onSnapshot,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function memoBar({db,sec,uid}){
  const host=document.getElementById('memo');
  let perm='n',admin=false,tab='page',edit=false,errAll=false;
  let open=(()=>{try{return localStorage.getItem('memo_open')!=='0'}catch(e){return true}})();
  const txt={page:'',all:''};
  const ref=t=>t==='page'?doc(db,'sections',sec,'meta','promemoria'):doc(db,'app','promemoria');
  const unsubs=[
    onSnapshot(ref('page'),s=>{txt.page=s.exists()?(s.data().text||''):'';if(!edit)render()},()=>{}),
    onSnapshot(ref('all'),s=>{errAll=false;txt.all=s.exists()?(s.data().text||''):'';if(!edit)render()},()=>{errAll=true;if(!edit)render()})];
  const canEdit=()=>tab==='page'?perm==='w':admin;
  const pad=()=>{document.body.style.paddingBottom=perm==='n'?'':(open?'250px':'90px')};
  function setOpen(v){open=v;edit=false;try{localStorage.setItem('memo_open',v?'1':'0')}catch(e){}render()}
  function render(){
    if(!host)return;pad();
    if(perm==='n'){host.innerHTML='';return}
    const dot=(txt.page||txt.all)?' •':'';
    if(!open){host.innerHTML=`<button class="btn ghost sm" id="mo" style="background:var(--sf)">Promemoria${dot}</button>`;host.querySelector('#mo').onclick=()=>setOpen(true);return}
    const ce=canEdit();
    let body;
    if(tab==='all'&&errAll)body='<div class="mb mu">Il promemoria generale non è ancora attivo: l’admin deve pubblicare le regole di Firestore aggiornate (file firestore.rules).</div>';
    else if(edit)body=`<textarea id="mt" aria-label="Testo del promemoria">${esc(txt[tab])}</textarea><div class="dact"><button class="btn ghost sm" id="mx">Annulla</button><button class="btn sm" id="ms">Salva</button></div>`;
    else body=`<div class="mb" tabindex="0">${txt[tab]?esc(txt[tab]):'<span class="mu">Nessun promemoria.</span>'}</div>`;
    host.innerHTML=`<div class="card memo"><div class="mh"><span class="seg" role="group" aria-label="Tipo di promemoria"><button data-t="page" aria-pressed="${tab==='page'}">Questa pagina</button><button data-t="all" aria-pressed="${tab==='all'}">Tutte le pagine</button></span><span>${ce&&!edit&&!(tab==='all'&&errAll)?'<button class="btn ghost sm" id="me">Modifica</button> ':''}<button class="btn ghost sm" id="mc">Riduci</button></span></div>${body}</div>`;
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
