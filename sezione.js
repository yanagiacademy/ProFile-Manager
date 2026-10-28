import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,deleteDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>s.toLowerCase().replace(/\s+/g,'-');
const box=(t,m,extra='')=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div>${extra}<p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;

export function startSection(name){
  tick();setInterval(tick,15000);
  if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.');return}
  const auth=getAuth(initializeApp(firebaseConfig)),db=getFirestore(auth.app);
  let uid=null,me=null,items=[],q='',unsubs=[];
  const perm=()=>me?(me.admin?'w':((me.perms||{})[key(name)]||'n')):'n';
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');return}
      if(!unsubs[1])unsubs[1]=onSnapshot(collection(db,'sections',key(name),'items'),s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));render()},()=>{});
      render();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
  function render(){
    if(!me||perm()==='n')return;
    const p=perm(),f=document.activeElement&&document.activeElement.id==='q',t=q.trim().toLowerCase();
    const list=items.filter(i=>!t||(i.title+' '+(i.note||'')).toLowerCase().includes(t));
    app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca in ${esc(name)}" aria-label="Cerca" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
    <div class="wrap"><div class="bar"><h2>${esc(name)}</h2><span class="badge">${p==='w'?'Lettura e scrittura':'Solo lettura'}</span></div>
    ${p==='w'?`<div class="card" style="margin-bottom:12px"><label for="nt" style="margin-top:0">Titolo</label><input id="nt" type="text"><label for="nn">Nota</label><input id="nn" type="text"><p class="err" id="er" role="alert"></p><button class="btn" id="add">Aggiungi elemento</button></div>`:''}
    <div class="card">${list.length?list.map(i=>`<div class="row"><div><b>${esc(i.title)}</b><div class="mu">${esc(i.note||'')}</div></div>${p==='w'?`<button class="btn ghost sm" data-d="${esc(i.id)}">Elimina</button>`:''}</div>`).join(''):'<div class="mu">'+(t?'Nessun risultato.':'Nessun elemento in questa sezione.'+(p==='w'?' Aggiungine uno qui sopra.':''))+'</div>'}</div></div>`;
    if(f){const i=$('#q');i.focus();i.setSelectionRange(q.length,q.length)}
    $('#q').oninput=e=>{q=e.target.value;render()};
    $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
    if(p==='w'){
      $('#add').onclick=async()=>{const t=$('#nt').value.trim();if(!t){$('#er').textContent='Inserisci un titolo.';return}
        try{await addDoc(collection(db,'sections',key(name),'items'),{title:t,note:$('#nn').value.trim(),by:uid,at:serverTimestamp()})}catch(e){$('#er').textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}};
      document.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>deleteDoc(doc(db,'sections',key(name),'items',b.dataset.d)).catch(()=>{}));
    }
  }
}
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
