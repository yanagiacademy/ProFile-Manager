/* Storico (solo admin): registro di tutti i movimenti — chi ha creato, modificato, eliminato, ripristinato, quando si è acceso, backup, account.
   Le voci le scrive fsx.js (logEvento) nell'argomento "Storico" di Telegram, cifrate con la chiave PUBBLICA "storico": tutti gli account possono
   aggiungerne, ma solo l'admin (chiave privata in Firestore) può leggerle. Le voci contengono titolo e nome dei campi, non i contenuti. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {getFirestore,doc,collection,onSnapshot} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {assicuraCoppia} from "./cifra.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const NOMI={documenti:'Documenti','file-importanti':'File importanti','documenti-in-scadenza':'Documenti in scadenza',archivio:'Archivio',tecnici:'Tecnici',atleti:'Atleti',tessere:'Tessere',lezioni:'Lezioni',eventi:'Eventi',video:'Video',foto:'Foto',commercialista:'Commercialista',mail:'Mail',cestino:'Cestino'};
const nomeSez=k=>!k?'':NOMI[k]||(k.charAt(0).toUpperCase()+k.slice(1).replace(/-/g,' '));
const AZ={crea:['Creato','ok'],modifica:['Modificato',''],elimina:['Eliminato','bad'],'elimina-definitivo':['Eliminato per sempre','bad'],ripristina:['Ripristinato','ok'],accesso:['Accesso',''],account:['Account','am'],backup:['Backup','am']};
const PAGINA=100;
let auth,db,me=null,voci=[],q='',fu='',fa='',fs='',da='',a_='',mostra=PAGINA,shell=false,unsubs=[];
const fmt=t=>{const d=new Date(t);return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})};
const isoDay=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

function costruisci(){
  shell=true;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Storico</h2><span class="badge">Solo admin</span></div></div>
  <div class="card"><div class="mu">Tutti i movimenti degli account: cosa è stato creato, modificato, eliminato o ripristinato, chi e quando. Le voci riportano il titolo e i nomi dei campi, non il contenuto. Lo storico parte da quando è stato attivato.</div>
    <div class="flt"><input id="q" type="search" placeholder="Cerca (titolo, utente, dettaglio)" aria-label="Cerca nello storico"><select id="fu" aria-label="Utente"></select><select id="fa" aria-label="Azione"></select><select id="fs" aria-label="Sezione"></select></div>
    <div class="flt"><div class="dtf"><label>Dal<input id="da" type="date"></label><label>Al<input id="a" type="date"></label></div><span style="flex:1"></span><button class="btn ghost sm" id="csv">Scarica CSV</button></div>
    <p class="mu" id="n" role="status" style="margin:6px 0 0"></p><div id="ls"></div><div style="text-align:center;margin-top:10px"><button class="btn ghost" id="piu" hidden>Mostra altri</button></div></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;mostra=PAGINA;render()};
  for(const [i,f] of [['fu',v=>fu=v],['fa',v=>fa=v],['fs',v=>fs=v]])$('#'+i).onchange=e=>{f(e.target.value);mostra=PAGINA;render()};
  $('#da').onchange=e=>{da=e.target.value;mostra=PAGINA;render()};$('#a').onchange=e=>{a_=e.target.value;mostra=PAGINA;render()};
  $('#piu').onclick=()=>{mostra+=PAGINA;render()};$('#csv').onclick=csv}
const filtrate=()=>{const t=q.trim().toLowerCase();
  return voci.filter(v=>(!fu||v.u===fu)&&(!fa||v.a===fa)&&(!fs||v.s===fs)&&(!da||isoDay(v.t)>=da)&&(!a_||isoDay(v.t)<=a_)
    &&(!t||[v.n,v.T,v.c,nomeSez(v.s),(AZ[v.a]||[v.a])[0]].filter(Boolean).join(' ').toLowerCase().includes(t)))};
function opz(id,vals,label,sel){$('#'+id).innerHTML=`<option value="">${label}</option>`+vals.map(([v,l])=>`<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`).join('')}
function render(){
  if(!$('#ls'))return;
  const utenti=new Map();voci.forEach(v=>{if(v.u)utenti.set(v.u,v.n||v.u)});
  opz('fu',[...utenti].sort((a,b)=>a[1].localeCompare(b[1],'it')),'Tutti gli utenti',fu);
  opz('fa',Object.keys(AZ).filter(k=>voci.some(v=>v.a===k)).map(k=>[k,AZ[k][0]]),'Tutte le azioni',fa);
  opz('fs',[...new Set(voci.map(v=>v.s).filter(Boolean))].sort((a,b)=>nomeSez(a).localeCompare(nomeSez(b),'it')).map(k=>[k,nomeSez(k)]),'Tutte le sezioni',fs);
  const l=filtrate(),vis=l.slice(0,mostra);
  $('#n').textContent=voci.length?l.length+(l.length===1?' movimento':' movimenti')+(l.length!==voci.length?' su '+voci.length:''):'';
  $('#ls').innerHTML=vis.length?vis.map(v=>{const [lab,cl]=AZ[v.a]||[v.a,''];
    return `<div class="rw"><div class="dt">${esc(fmt(v.t))}</div><div class="inf"><b>${esc(v.n||'Utente sconosciuto')}</b> <span class="chip ${cl}">${esc(lab)}</span>${v.s?`<span class="chip">${esc(nomeSez(v.s))}</span>`:''}
      ${v.T?`<div>${esc(v.T)}</div>`:''}${v.c?`<div class="mu">${esc(v.c)}</div>`:''}</div></div>`}).join('')
    :`<div class="emp">${voci.length?'Nessun movimento con questi filtri.':'Ancora nessun movimento registrato. Le voci compaiono man mano che gli account lavorano; se non ne arrivano, apri la Home da admin per attivare lo storico.'}</div>`;
  $('#piu').hidden=l.length<=mostra}
function csv(){
  const l=filtrate().slice().sort((a,b)=>a.t-b.t);if(!l.length){alert('Non ci sono movimenti da scaricare con questi filtri.');return}
  const c=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  const rows=[['Data e ora','Utente','Azione','Sezione','Elemento','Dettaglio'].map(c).join(';')];
  l.forEach(v=>rows.push([fmt(v.t),v.n,(AZ[v.a]||[v.a])[0],nomeSez(v.s),v.T,v.c].map(c).join(';')));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}));a.download='storico.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,async u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    try{const sn=await getDoc(doc(db,'users',u.uid));me=sn.exists()?{id:u.uid,...sn.data()}:null}catch(e){app.innerHTML=box('Errore','Impossibile leggere l’account.');return}
    if(!me||!me.admin){app.innerHTML=box('Solo admin','Lo storico è riservato all’amministratore.');return}
    assicuraCoppia('storico').catch(e=>console.warn('Chiavi storico:',e&&e.message));
    if(!shell)costruisci();
    unsubs.push(onSnapshot(collection(db,'sections','storico','items'),s=>{
      voci=s.docs.map(d=>d.data()).filter(v=>v&&typeof v.t==='number').sort((a,b)=>b.t-a.t);render()},()=>{}));
    render()})}
