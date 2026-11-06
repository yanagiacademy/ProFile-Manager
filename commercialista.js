/* Scheda Commercialista: Bilancio (entrate/uscite, conti, ricevute allegate, ripetizioni), Riepilogo (grafico, IVA, rendiconto stampabile), Calcolatrice, Calendario con note, alert e scadenze ricorrenti.
   Dati in sections/commercialista/items (come le altre sezioni: Telegram + copia facoltativa su Firebase):
   - kind:'voce'  = movimento di bilancio (tipo entrata|uscita, data, cent, iva, ...)
   - kind:'nota'  = nota del calendario (data, ora, testo, alertMin, fatto)
   - kind:'file'  = ricevuta o fattura allegata a un movimento (id nel campo allegati del movimento)
   Le eliminazioni vanno nel Cestino (30 giorni). */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {archivio} from "./archivio.js";
import {showPreview} from "./file-tools.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='commercialista';
const CATE=['Quote associative','Iscrizioni e corsi','Eventi e gare','Sponsor e contributi','Affitto','Utenze','Attrezzature','Assicurazioni','Compensi e collaboratori','Imposte e tasse','Banca e commissioni','Altro'];
const PAGA=['Bonifico','Contanti','Carta','Assegno','Altro'];
const CONTI=['Cassa','Banca','Carta','PayPal','Altro'];
const ALERTS=[['','Nessun alert'],['0','All’ora dell’evento'],['15','15 minuti prima'],['60','1 ora prima'],['1440','1 giorno prima'],['2880','2 giorni prima'],['10080','1 settimana prima']];
const MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

let auth,db,col,uid=null,me=null,items=[],unsubs=[],shellFor='',memo=null;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const canW=()=>perm()==='w';
const tabGet=()=>{try{return localStorage.getItem('comm_tab')||'b'}catch(e){return 'b'}};
let tab=tabGet();
let editV=null,editN=null;
let bq='',bTipo='all',bAnno='all',bMese='all',bRic='',rAnno='',rimossi=new Set(),arch=null;
const now0=new Date();
let cy=now0.getFullYear(),cm=now0.getMonth(),sel='';

/* ---------- utilità ---------- */
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayIso=()=>iso(new Date());
const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
const fmtD=d=>isD(d)?d.split('-').reverse().join('/'):'';
const euro=c=>(c/100).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
function parseEuro(s){
  let t=String(s||'').replace(/[€\s]/g,'');
  if(!t)return NaN;
  if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');
  else if((t.match(/\./g)||[]).length>1)t=t.replace(/\./g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(t))return NaN;
  return Math.round(parseFloat(t)*100)}
const ivaDi=(c,r)=>r>0?c-Math.round(c/(1+r/100)):0;
const sgn=v=>v.tipo==='uscita'?-1:1;
const store=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const dl=(name,text,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};

const voci=()=>items.filter(i=>i.kind==='voce');
const note=()=>items.filter(i=>i.kind==='nota');

/* ---------- struttura della pagina (una volta sola) ---------- */
function shell(){
  const w=canW();shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap">
  <div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Commercialista</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  <div id="al"></div>
  <div class="tabs"><span class="seg" role="group" aria-label="Strumenti"><button data-t="b">Bilancio</button><button data-t="r">Riepilogo</button><button data-t="c">Calcolatrice</button><button data-t="k">Calendario</button></span></div>

  <section id="pb" hidden>
    ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="bft" style="margin:0">Nuovo movimento</h3><button class="btn sm" id="bftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="bfb" aria-label="Apri il modulo del movimento">+</button></div>
      <div id="bfb" hidden>
        <fieldset><legend>Movimento</legend>
          <div class="three"><div><label for="vt">Tipo</label><select id="vt"><option value="entrata">Entrata</option><option value="uscita">Uscita</option></select></div>
          <div><label for="vd">Data</label><input id="vd" type="date"></div>
          <div><label for="vi">Importo totale (€)</label><input id="vi" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div></div>
          <label for="vs">Descrizione</label><input id="vs" type="text" autocomplete="off">
        </fieldset>
        <fieldset><legend>Dettagli</legend>
          <div class="two"><div><label for="vc">Categoria</label><input id="vc" type="text" list="vcl" autocomplete="off"><datalist id="vcl"></datalist></div>
          <div><label for="vp">Cliente / fornitore</label><input id="vp" type="text" list="vpl" autocomplete="off"><datalist id="vpl"></datalist></div></div>
          <div class="three"><div><label for="vn">N. documento</label><input id="vn" type="text" autocomplete="off" placeholder="fattura, ricevuta…"></div>
          <div><label for="vv">IVA inclusa</label><select id="vv"><option value="0">Nessuna / esente</option><option value="4">4%</option><option value="5">5%</option><option value="10">10%</option><option value="22">22%</option></select></div>
          <div><label for="vm">Pagamento</label><select id="vm">${PAGA.map(p=>`<option>${p}</option>`).join('')}</select></div></div>
          <div class="three"><div><label for="vk">Conto</label><select id="vk">${CONTI.map(c=>`<option>${c}</option>`).join('')}</select></div>
          <div id="vrw"><label for="vr">Ripeti</label><select id="vr"><option value="0">Non ripetere</option><option value="1">Ogni mese</option><option value="3">Ogni 3 mesi</option><option value="12">Ogni anno</option></select></div>
          <div id="vqw" hidden><label for="vq">Quante volte in tutto</label><input id="vq" type="text" inputmode="numeric" value="12"></div></div>
          <label for="vo">Note</label><textarea id="vo"></textarea>
          <div id="vaw"><label for="vf">Ricevuta o fattura (facoltativa)</label><input id="vf" type="file" multiple><div id="val" style="margin-top:6px"></div></div>
          <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="vfb" style="width:auto;min-height:0"> Salva anche su Firebase</label>
        </fieldset>
        <p class="err" id="ver" role="alert"></p>
        <div class="acts"><button class="btn" id="vsv">Salva movimento</button><button class="btn ghost" id="vcx" hidden>Annulla modifica</button></div>
      </div></div>`:''}
    <div class="sums" id="sums"></div>
    <div class="card" style="padding:12px 14px">
      <div class="flt"><input id="bq" type="search" placeholder="Cerca nei movimenti" aria-label="Cerca nei movimenti">
        <select id="bt" aria-label="Tipo"><option value="all">Entrate e uscite</option><option value="entrata">Solo entrate</option><option value="uscita">Solo uscite</option></select>
        <select id="ba" aria-label="Anno"></select>
        <select id="br" aria-label="Ricevute"><option value="">Con o senza ricevuta</option><option value="senza">Senza ricevuta</option></select>
        <select id="bm" aria-label="Mese"><option value="all">Tutti i mesi</option>${MESI.map((m,i)=>`<option value="${i+1}">${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}</select>
        <button class="btn ghost sm" id="bcsv">Scarica CSV</button></div>
      <div id="bls"></div>
      <details class="cat"><summary>Riepilogo per categoria</summary><div class="scroll" id="bcat"></div></details>
    </div>
  </section>

  <section id="pr" hidden>
    <div class="card">
      <div class="flt"><select id="ra" aria-label="Anno del riepilogo"></select><span style="flex:1"></span><button class="btn ghost sm" id="rpr">Stampa / PDF rendiconto</button></div>
      <div class="sums" id="rsum"></div>
      <h3 class="rh">Entrate e uscite per mese</h3><div id="rbar"></div>
      <details class="cat"><summary>Dati mese per mese</summary><div class="scroll" id="rmes"></div></details>
      <h3 class="rh">IVA per trimestre</h3><div class="scroll" id="riva"></div>
      <p class="mu" style="margin:6px 0 0">Differenza positiva = IVA da versare, negativa = a credito. È calcolata sulle aliquote indicate nei movimenti: serve da riferimento, la liquidazione la fa il commercialista.</p>
      <h3 class="rh">Per conto</h3><div class="scroll" id="rcon"></div>
      <h3 class="rh">Per categoria</h3><div class="scroll" id="rcat"></div>
    </div>
  </section>

  <section id="pc" hidden>
    <div class="card calc">
      <input class="disp" id="ce" type="text" inputmode="none" autocomplete="off" aria-label="Calcolo" placeholder="0">
      <div class="prev" id="cp" aria-live="polite"></div>
      <div class="keys" id="ck">
        <button class="cl" data-k="C">C</button><button class="op" data-k="(">(</button><button class="op" data-k=")">)</button><button class="op" data-k="BK" aria-label="Cancella">⌫</button>
        <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button><button class="op" data-k="÷">÷</button>
        <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button><button class="op" data-k="×">×</button>
        <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button><button class="op" data-k="−">−</button>
        <button data-k="0">0</button><button data-k=",">,</button><button class="op" data-k="%">%</button><button class="op" data-k="+">+</button>
        <button class="eq" data-k="=" style="grid-column:1/-1">=</button>
      </div>
      <div class="ivar"><span class="mu">IVA</span><select id="cr" aria-label="Aliquota IVA"><option>22</option><option>10</option><option>5</option><option>4</option></select>
        <button class="btn ghost sm" id="civp">+ IVA</button><button class="btn ghost sm" id="civm">Scorpora IVA</button><button class="btn ghost sm" id="civ0">Solo IVA</button></div>
      <div class="ivar"><span class="mu">%</span><input id="cpv" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 20" aria-label="Percentuale" style="width:5.5em;min-height:40px">
        <button class="btn ghost sm" id="cpp">+ %</button><button class="btn ghost sm" id="cpm">− %</button><button class="btn ghost sm" id="cpo">% di</button></div>
      <div class="acts" style="margin-top:10px"><button class="btn ghost sm" id="ccp">Copia risultato</button>${w?'<button class="btn ghost sm" id="cbl">Usa nel bilancio</button>':''}</div>
      <div class="hist" id="ch"></div>
    </div>
  </section>

  <section id="pk" hidden>
    <div class="card" style="margin-bottom:12px">
      <div class="cnav"><button class="btn ghost sm" id="cpv" aria-label="Mese precedente">‹</button><b id="cl"></b><button class="btn ghost sm" id="cnx" aria-label="Mese successivo">›</button><button class="btn ghost sm" id="cto">Oggi</button></div>
      <div class="cgrid" id="cg"></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="fh"><h3 id="kd" style="margin:0"></h3>${w?'<button class="btn sm" id="knew">+ Nota</button>':''}</div>
      ${w?`<div id="kf" hidden>
        <label for="kt">Titolo</label><input id="kt" type="text" autocomplete="off">
        <div class="three"><div><label for="kdt">Data</label><input id="kdt" type="date"></div><div><label for="kh">Ora (facoltativa)</label><input id="kh" type="time"></div><div><label for="ka">Alert</label><select id="ka">${ALERTS.map(a=>`<option value="${a[0]}">${a[1]}</option>`).join('')}</select></div></div>
        <div class="two" id="krw"><div><label for="krp">Ripeti</label><select id="krp"><option value="0">Non ripetere</option><option value="1">Ogni mese</option><option value="3">Ogni 3 mesi</option><option value="12">Ogni anno</option></select></div>
        <div id="kqw" hidden><label for="kqt">Quante volte in tutto</label><input id="kqt" type="text" inputmode="numeric" value="12"></div></div>
        <label for="kx">Nota</label><textarea id="kx"></textarea>
        <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="kfb" style="width:auto;min-height:0"> Salva anche su Firebase</label>
        <p class="err" id="ker" role="alert"></p>
        <div class="acts"><button class="btn" id="ksv">Salva nota</button><button class="btn ghost" id="kcx">Annulla</button></div></div>`:''}
      <div id="kl"></div>
    </div>
    <div class="card"><div class="fh"><h3 style="margin:0">Prossimi appuntamenti</h3><button class="btn ghost sm" id="knt" hidden>Attiva notifiche</button></div><div id="kn" style="margin-top:6px"></div>
      <p class="mu" style="margin:10px 0 0">Gli alert compaiono in alto quando la pagina è aperta (e come notifica del browser, se attivata). Non arrivano a pagina chiusa.</p></div>
  </section>
  </div>`;

  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>setTab(b.dataset.t));
  bindBil();bindRiep();bindCalc();bindCal();setTab(tab);
}
function setTab(t){
  tab=t;store('comm_tab',t);
  ['b','r','c','k'].forEach(k=>{const p=$('#p'+k);if(p)p.hidden=k!==t});
  document.querySelectorAll('[data-t]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===t)))}

/* =====================================================
   BILANCIO
   ===================================================== */
function getArch(){return arch||(arch=archivio(db,SEC,uid))}
function bindBil(){
  const w=canW();
  $('#bq').oninput=e=>{bq=e.target.value;renderBil()};
  $('#bt').onchange=e=>{bTipo=e.target.value;renderBil()};
  $('#ba').onchange=e=>{bAnno=e.target.value;renderBil()};
  $('#bm').onchange=e=>{bMese=e.target.value;renderBil()};
  $('#br').onchange=e=>{bRic=e.target.value;renderBil()};
  $('#bcsv').onclick=csvBil;
  $('#bls').onclick=async e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const it=items.find(x=>x.id===b.dataset.id);if(!it)return;
    if(b.dataset.a==='att')return apriAllegato(it);   /* it = allegato (file) */
    if(b.dataset.a==='edit')editVoce(it);
    else if(b.dataset.a==='del'){
      const att=(it.allegati||[]).map(id=>items.find(x=>x.id===id)).filter(Boolean);
      if(!confirm('Eliminare il movimento «'+(it.descr||'senza descrizione')+'»'+(att.length?' e le sue '+att.length+(att.length===1?' ricevuta':' ricevute'):'')+'? Va nel Cestino e resta recuperabile per 30 giorni.'))return;
      try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));for(const a of att)await getArch().remove(a);if(editV===it.id)resetVoce()}
      catch(x){console.error(x);alert(x&&x.message==='NOPUB'?'Il Cestino non è ancora attivo: l’admin deve aprire la Home una volta.':'Eliminazione non riuscita.')}}};
  if(w){
    $('#bftg').onclick=()=>setBForm($('#bfb').hidden);
    $('#vsv').onclick=saveVoce;$('#vcx').onclick=resetVoce;
    $('#vr').onchange=()=>{const r=$('#vr').value!=='0';$('#vqw').hidden=!r;$('#vaw').hidden=r};
    $('#val').onclick=e=>{const b=e.target.closest('[data-rm]');if(!b)return;rimossi.add(b.dataset.rm);const it=items.find(x=>x.id===editV);paintAll(it)};
    $('#vd').value=todayIso()}
}
function apriAllegato(a){
  showPreview({title:a.title,mime:a.mime,load:()=>getArch().getBlob(a),errText:e=>getArch().errText(e),fileName:a.title})}
function paintAll(it){
  const box=$('#val');if(!box)return;
  const l=((it&&it.allegati)||[]).filter(id=>!rimossi.has(id)).map(id=>items.find(x=>x.id===id)).filter(Boolean);
  box.innerHTML=l.map(a=>`<span class="chip">📎 ${esc(a.title)} <button class="chip" data-rm="${esc(a.id)}" aria-label="Togli l’allegato ${esc(a.title)}" style="min-height:0;padding:0 6px;margin:0">✕</button></span>`).join(' ')}
function setBForm(o){
  const b=$('#bfb'),t=$('#bftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?'Chiudi il modulo del movimento':'Apri il modulo del movimento')}
const VF=[['vt','tipo'],['vd','data'],['vs','descr'],['vc','categoria'],['vp','controparte'],['vn','doc'],['vv','iva'],['vm','pagamento'],['vk','conto'],['vo','annotazioni']];
function resetVoce(){
  setBForm(false);editV=null;rimossi=new Set();
  VF.forEach(([e])=>{const el=$('#'+e);el.value=el.tagName==='SELECT'?el.options[0].value:''});
  $('#vd').value=todayIso();$('#vi').value='';$('#vfb').checked=false;
  $('#vr').value='0';$('#vq').value='12';$('#vqw').hidden=true;$('#vrw').hidden=false;$('#vaw').hidden=false;$('#vf').value='';$('#val').innerHTML='';
  $('#bft').textContent='Nuovo movimento';$('#vsv').textContent='Salva movimento';$('#vcx').hidden=true;$('#ver').textContent=''}
function editVoce(it){
  setBForm(true);editV=it.id;rimossi=new Set();
  VF.forEach(([e,k])=>{$('#'+e).value=it[k]!=null?String(it[k]):(e==='vk'?'Cassa':'')});
  $('#vi').value=(it.cent/100).toFixed(2).replace('.',',');$('#vfb').checked=!!it.fb;
  $('#vr').value='0';$('#vqw').hidden=true;$('#vrw').hidden=true;$('#vaw').hidden=false;$('#vf').value='';paintAll(it);   /* la ripetizione si imposta solo su un movimento nuovo */
  $('#bft').textContent='Modifica movimento';$('#vsv').textContent='Salva modifiche';$('#vcx').hidden=false;$('#ver').textContent='';
  setTab('b');$('#bft').scrollIntoView({behavior:'smooth',block:'start'})}
/* data + n mesi, mantenendo il giorno (o l'ultimo del mese se non esiste: 31 gennaio + 1 mese = 28/29 febbraio) */
function addMesiIso(d,n){
  const [y,m,g]=d.split('-').map(Number),t=m-1+n,yy=y+Math.floor(t/12),mm=((t%12)+12)%12,ult=new Date(yy,mm+1,0).getDate();
  return yy+'-'+pad(mm+1)+'-'+pad(Math.min(g,ult))}
const newSerie=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');
async function saveVoce(){
  const er=$('#ver'),v={};
  VF.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  const cent=parseEuro($('#vi').value);
  if(!isD(v.data)){er.textContent='Inserisci la data.';return}
  if(!v.descr){er.textContent='Inserisci una descrizione.';return}
  if(!(cent>0)){er.textContent='Inserisci un importo valido, maggiore di zero (es. 120,50).';return}
  v.iva=Number(v.iva)||0;
  const rp=editV?0:Number($('#vr').value)||0,tot=rp?parseInt($('#vq').value,10)||0:1;
  if(rp&&(tot<2||tot>60)){er.textContent='Indica quante volte ripetere il movimento in tutto (da 2 a 60).';return}
  const files=rp?[]:[...($('#vf').files||[])],fb=$('#vfb').checked,eur=euro(cent);
  const mk=d=>({...v,data:d,kind:'voce',cent,fb,title:v.descr,
    note:[v.tipo,eur,fmtD(d),v.categoria,v.controparte,v.doc,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)});
  const carica=async(voceId)=>{const ids=[];
    for(const f of files)ids.push(await getArch().save(f,{voce:voceId,...(fb?{fb:true}:{})},p=>{er.textContent='Caricamento di '+f.name+': '+p+'%'}));return ids};
  $('#vsv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editV){
      const prev=items.find(x=>x.id===editV)||{};
      const nuovi=await carica(editV),all=[...(prev.allegati||[]).filter(id=>!rimossi.has(id)),...nuovi];
      await updateDoc(doc(db,'sections',SEC,'items',editV),{...mk(v.data),allegati:all});
      for(const id of rimossi){const a=items.find(x=>x.id===id);if(a)await getArch().remove(a)}     /* le ricevute tolte vanno nel Cestino */
    }else{
      const serie=rp?newSerie():'';
      for(let i=0;i<tot;i++){
        if(rp)er.textContent='Salvataggio '+(i+1)+' di '+tot+'…';
        const ref=doc(col),d=rp?addMesiIso(v.data,rp*i):v.data,ids=await carica(ref.id);
        await setDoc(ref,{...mk(d),...(ids.length?{allegati:ids}:{}),...(rp?{serie,nrip:i+1,totrip:tot}:{}),by:uid,at:serverTimestamp()})}}
    resetVoce();
  }catch(e){console.error(e);er.textContent=(e&&e.message)?('Salvataggio non riuscito: '+getArch().errText(e)+'.'):'Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#vsv').disabled=false}

const senzaRic=v=>!(v.allegati||[]).some(id=>items.some(x=>x.id===id));
function bilFiltrate(){
  const t=bq.trim().toLowerCase();
  return voci().filter(v=>{
    if(bTipo!=='all'&&v.tipo!==bTipo)return false;
    if(bAnno!=='all'&&String(v.data||'').slice(0,4)!==bAnno)return false;
    if(bMese!=='all'&&Number(String(v.data||'').slice(5,7))!==Number(bMese))return false;
    if(bRic==='senza'&&!senzaRic(v))return false;
    if(t&&![v.descr,v.categoria,v.controparte,v.doc,v.annotazioni,v.pagamento,v.conto,fmtD(v.data),(v.cent/100).toFixed(2).replace('.',',')].filter(Boolean).join(' ').toLowerCase().includes(t))return false;
    return true}).sort((a,b)=>String(b.data).localeCompare(String(a.data)));
}
function renderBil(){
  if(!$('#bls'))return;
  const all=voci();
  /* anni disponibili */
  const anni=[...new Set(all.map(v=>String(v.data||'').slice(0,4)).filter(a=>/^\d{4}$/.test(a)))].sort().reverse();
  if(bAnno!=='all'&&!anni.includes(bAnno))anni.unshift(bAnno);
  $('#ba').innerHTML=`<option value="all">Tutti gli anni</option>`+anni.map(a=>`<option ${a===bAnno?'selected':''}>${a}</option>`).join('');
  $('#bt').value=bTipo;$('#bm').value=bMese;
  const list=bilFiltrate();
  let en=0,us=0,ivaE=0,ivaU=0;
  list.forEach(v=>{if(v.tipo==='uscita'){us+=v.cent;ivaU+=ivaDi(v.cent,v.iva)}else{en+=v.cent;ivaE+=ivaDi(v.cent,v.iva)}});
  const sal=en-us;
  $('#sums').innerHTML=`<div class="sum"><div class="l">Entrate</div><div class="v">${euro(en)}</div><div class="s">di cui IVA ${euro(ivaE)}</div></div>
    <div class="sum"><div class="l">Uscite</div><div class="v neg">${euro(us)}</div><div class="s">di cui IVA ${euro(ivaU)}</div></div>
    <div class="sum"><div class="l">Saldo (${list.length} moviment${list.length===1?'o':'i'})</div><div class="v ${sal<0?'neg':''}">${euro(sal)}</div><div class="s">IVA netta ${euro(ivaE-ivaU)} (a debito se positiva)</div></div>`;
  const w=canW();
  $('#bls').innerHTML=list.length?list.map(v=>{
    const iv=ivaDi(v.cent,v.iva);
    const sub=[v.categoria,v.controparte,v.doc&&'doc. '+v.doc,v.pagamento,v.conto,v.totrip&&('rata '+v.nrip+'/'+v.totrip)].filter(Boolean).map(esc).join(' · ');
    const atts=(v.allegati||[]).map(id=>items.find(x=>x.id===id)).filter(Boolean).map(a=>`<button class="chip" data-a="att" data-id="${esc(a.id)}" aria-label="Apri la ricevuta ${esc(a.title)}">📎 ${esc(a.title)}</button>`).join('');
    return `<div class="mv"><div class="dt">${esc(fmtD(v.data))}</div><div class="inf"><div><b>${esc(v.descr||'—')}</b>${v.fb?' <span class="mu" title="Copia su Firebase">☁</span>':''}</div>${sub?`<div class="mu">${sub}</div>`:''}${v.annotazioni?`<div class="mu">${esc(v.annotazioni)}</div>`:''}${atts?`<div>${atts}</div>`:''}</div>
      <div class="am ${v.tipo==='uscita'?'neg':''}">${v.tipo==='uscita'?'−':'+'}${euro(v.cent)}${v.iva?`<small>IVA ${v.iva}%: ${euro(iv)}</small>`:''}</div>
      ${w?`<div class="ac"><button class="btn ghost sm" data-a="edit" data-id="${esc(v.id)}">Modifica</button><button class="btn ghost sm" data-a="del" data-id="${esc(v.id)}">Elimina</button></div>`:''}</div>`}).join('')
    :`<div class="mu" style="padding:8px 0">${all.length?'Nessun movimento con questi filtri.':'Nessun movimento registrato.'+(w?' Apri il modulo qui sopra con «+».':'')}</div>`;
  /* riepilogo per categoria */
  const cat={};list.forEach(v=>{const k=v.categoria||'Senza categoria';cat[k]=cat[k]||{e:0,u:0};if(v.tipo==='uscita')cat[k].u+=v.cent;else cat[k].e+=v.cent});
  const ks=Object.keys(cat).sort((a,b)=>a.localeCompare(b,'it'));
  $('#bcat').innerHTML=ks.length?`<table><thead><tr><th>Categoria</th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Saldo</th></tr></thead><tbody>${ks.map(k=>`<tr><td>${esc(k)}</td><td class="n">${euro(cat[k].e)}</td><td class="n">${euro(cat[k].u)}</td><td class="n ${cat[k].e-cat[k].u<0?'neg':''}">${euro(cat[k].e-cat[k].u)}</td></tr>`).join('')}</tbody></table>`:'<div class="mu" style="padding:8px 0">Nessun dato.</div>';
  /* suggerimenti nei campi del modulo */
  if(w){
    const cs=[...new Set([...CATE,...all.map(v=>v.categoria).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'it'));
    const ps=[...new Set(all.map(v=>v.controparte).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
    const a=$('#vcl'),b=$('#vpl');
    if(a)a.innerHTML=cs.map(x=>`<option value="${esc(x)}">`).join('');
    if(b)b.innerHTML=ps.map(x=>`<option value="${esc(x)}">`).join('')}
}
function csvBil(){
  const list=bilFiltrate().slice().sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  if(!list.length){alert('Non ci sono movimenti da scaricare con questi filtri.');return}
  const c=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  const n=x=>(x/100).toFixed(2).replace('.',',');
  const rows=[['Data','Tipo','Descrizione','Categoria','Cliente/fornitore','N. documento','Pagamento','Conto','Ricevuta','Importo (€)','Aliquota IVA %','IVA inclusa (€)','Note'].map(c).join(';')];
  list.forEach(v=>rows.push([fmtD(v.data),v.tipo,v.descr,v.categoria,v.controparte,v.doc,v.pagamento,v.conto,senzaRic(v)?'no':'sì',n(v.cent*sgn(v)),v.iva||0,n(ivaDi(v.cent,v.iva)*sgn(v)),v.annotazioni].map(c).join(';')));
  const tot=list.reduce((s,v)=>s+v.cent*sgn(v),0);
  rows.push(['','','TOTALE (entrate − uscite)','','','','','','',n(tot),'','',''].map(c).join(';'));
  dl('bilancio.csv','\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8')}

/* =====================================================
   RIEPILOGO
   ===================================================== */
const anniDisp=()=>[...new Set(voci().map(v=>String(v.data||'').slice(0,4)).filter(a=>/^\d{4}$/.test(a)))].sort().reverse();
const annoVoci=()=>voci().filter(v=>String(v.data||'').slice(0,4)===rAnno);
function bindRiep(){
  $('#ra').onchange=e=>{rAnno=e.target.value;renderRiep()};
  $('#rpr').onclick=stampaRendiconto}
function totali(L){
  const t={e:0,u:0,ivaE:0,ivaU:0,mese:Array.from({length:12},()=>({e:0,u:0})),tri:Array.from({length:4},()=>({ivaE:0,ivaU:0})),conto:{},cat:{}};
  for(const v of L){
    const u=v.tipo==='uscita',m=Math.min(11,Math.max(0,Number(String(v.data).slice(5,7))-1)),iv=ivaDi(v.cent,v.iva);
    if(u){t.e+=0;t.u+=v.cent;t.ivaU+=iv;t.mese[m].u+=v.cent;t.tri[Math.floor(m/3)].ivaU+=iv}
    else{t.e+=v.cent;t.ivaE+=iv;t.mese[m].e+=v.cent;t.tri[Math.floor(m/3)].ivaE+=iv}
    const co=v.conto||'Non indicato',ca=v.categoria||'Senza categoria';
    for(const [o,k] of [[t.conto,co],[t.cat,ca]]){o[k]=o[k]||{e:0,u:0};if(u)o[k].u+=v.cent;else o[k].e+=v.cent}}
  return t}
const tabEUS=(o,vuoto)=>{const ks=Object.keys(o).sort((a,b)=>a.localeCompare(b,'it'));
  return ks.length?`<table><thead><tr><th></th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Saldo</th></tr></thead><tbody>${ks.map(k=>`<tr><td>${esc(k)}</td><td class="n">${euro(o[k].e)}</td><td class="n">${euro(o[k].u)}</td><td class="n ${o[k].e-o[k].u<0?'neg':''}">${euro(o[k].e-o[k].u)}</td></tr>`).join('')}</tbody></table>`:`<div class="mu">${vuoto}</div>`};
function barre(m){
  const max=Math.max(1,...m.map(x=>x.e),...m.map(x=>x.u)),W=600,H=230,pl=6,pb=32,pt=8,gw=(W-pl*2)/12,bw=Math.min(18,gw/2-3),h=H-pb-pt;
  let g='';
  m.forEach((x,i)=>{const cx=pl+i*gw+gw/2,he=h*x.e/max,hu=h*x.u/max;
    g+=`<rect x="${(cx-bw-1).toFixed(1)}" y="${(H-pb-he).toFixed(1)}" width="${bw}" height="${he.toFixed(1)}" rx="2" style="fill:var(--ac)"><title>${MESI[i]}: entrate ${euro(x.e)}</title></rect>`
      +`<rect x="${(cx+1).toFixed(1)}" y="${(H-pb-hu).toFixed(1)}" width="${bw}" height="${hu.toFixed(1)}" rx="2" style="fill:var(--er)"><title>${MESI[i]}: uscite ${euro(x.u)}</title></rect>`
      +`<text x="${cx.toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="18" style="fill:var(--mu)">${MESI[i].slice(0,3)}</text>`});
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entrate e uscite mese per mese. Il dettaglio è nella tabella qui sotto." style="width:100%;height:auto;display:block">${g}<line x1="${pl}" x2="${W-pl}" y1="${H-pb}" y2="${H-pb}" style="stroke:var(--ln)"/></svg>
    <div class="mu" style="display:flex;gap:14px;justify-content:center"><span><span style="color:var(--ac)">■</span> Entrate</span><span><span style="color:var(--er)">■</span> Uscite</span></div>`}
function renderRiep(){
  if(!$('#rsum'))return;
  const anni=anniDisp(),oggiA=String(new Date().getFullYear());
  if(!rAnno||!anni.includes(rAnno))rAnno=anni.includes(oggiA)?oggiA:(anni[0]||'');
  $('#ra').innerHTML=anni.length?anni.map(a=>`<option ${a===rAnno?'selected':''}>${a}</option>`).join(''):'<option>—</option>';
  $('#rpr').disabled=!anni.length;
  if(!anni.length){['rsum','rbar','rmes','riva','rcon','rcat'].forEach(i=>$('#'+i).innerHTML='');$('#rsum').innerHTML='<div class="mu">Nessun movimento: il riepilogo compare appena ne registri qualcuno.</div>';return}
  const t=totali(annoVoci()),sal=t.e-t.u;
  $('#rsum').innerHTML=`<div class="sum"><div class="l">Entrate ${rAnno}</div><div class="v">${euro(t.e)}</div><div class="s">di cui IVA ${euro(t.ivaE)}</div></div>
    <div class="sum"><div class="l">Uscite ${rAnno}</div><div class="v neg">${euro(t.u)}</div><div class="s">di cui IVA ${euro(t.ivaU)}</div></div>
    <div class="sum"><div class="l">Saldo ${rAnno}</div><div class="v ${sal<0?'neg':''}">${euro(sal)}</div><div class="s">IVA netta ${euro(t.ivaE-t.ivaU)}</div></div>`;
  $('#rbar').innerHTML=barre(t.mese);
  $('#rmes').innerHTML=`<table><thead><tr><th>Mese</th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Saldo</th></tr></thead><tbody>${t.mese.map((x,i)=>`<tr><td>${MESI[i][0].toUpperCase()+MESI[i].slice(1)}</td><td class="n">${euro(x.e)}</td><td class="n">${euro(x.u)}</td><td class="n ${x.e-x.u<0?'neg':''}">${euro(x.e-x.u)}</td></tr>`).join('')}</tbody></table>`;
  $('#riva').innerHTML=`<table><thead><tr><th>Trimestre</th><th class="n">IVA sulle entrate</th><th class="n">IVA sulle uscite</th><th class="n">Differenza</th></tr></thead><tbody>${t.tri.map((x,i)=>`<tr><td>${i+1}° (${MESI[i*3].slice(0,3)}–${MESI[i*3+2].slice(0,3)})</td><td class="n">${euro(x.ivaE)}</td><td class="n">${euro(x.ivaU)}</td><td class="n ${x.ivaE-x.ivaU<0?'neg':''}">${euro(x.ivaE-x.ivaU)}</td></tr>`).join('')}<tr><td><b>Anno</b></td><td class="n"><b>${euro(t.ivaE)}</b></td><td class="n"><b>${euro(t.ivaU)}</b></td><td class="n"><b>${euro(t.ivaE-t.ivaU)}</b></td></tr></tbody></table>`;
  $('#rcon').innerHTML=tabEUS(t.conto,'Nessun dato.');$('#rcat').innerHTML=tabEUS(t.cat,'Nessun dato.')}
function stampaRendiconto(){
  const L=annoVoci();if(!L.length){alert('Non ci sono movimenti per questo anno.');return}
  const t=totali(L),e=x=>esc(x);
  const righe=(o,k)=>Object.keys(o).filter(c=>o[c][k]>0).sort((a,b)=>a.localeCompare(b,'it')).map(c=>`<tr><td>${e(c)}</td><td class="n">${euro(o[c][k])}</td></tr>`).join('')||'<tr><td colspan="2">—</td></tr>';
  const html=`<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Rendiconto ${e(rAnno)}</title><style>
    body{font:14px/1.4 system-ui,Arial,sans-serif;color:#14213D;margin:28px auto;max-width:760px;padding:0 16px}h1{font-size:22px;margin:0 0 2px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
    table{width:100%;border-collapse:collapse}td,th{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:700;border-top:2px solid #14213D}
    .p{color:#555;font-size:12px}.sal{font-size:18px;font-weight:700;margin-top:14px}@media print{body{margin:0}}</style></head><body>
    <h1>Rendiconto economico – anno ${e(rAnno)}</h1><div class="p">Yanagi Academy · generato il ${new Date().toLocaleDateString('it-IT')} dai movimenti registrati</div>
    <h2>Entrate per categoria</h2><table><tbody>${righe(t.cat,'e')}</tbody><tfoot><tr><td>Totale entrate</td><td class="n">${euro(t.e)}</td></tr></tfoot></table>
    <h2>Uscite per categoria</h2><table><tbody>${righe(t.cat,'u')}</tbody><tfoot><tr><td>Totale uscite</td><td class="n">${euro(t.u)}</td></tr></tfoot></table>
    <div class="sal">Saldo dell’anno: ${euro(t.e-t.u)}</div>
    <h2>Per conto</h2><table><thead><tr><th></th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Saldo</th></tr></thead><tbody>${Object.keys(t.conto).sort().map(c=>`<tr><td>${e(c)}</td><td class="n">${euro(t.conto[c].e)}</td><td class="n">${euro(t.conto[c].u)}</td><td class="n">${euro(t.conto[c].e-t.conto[c].u)}</td></tr>`).join('')}</tbody></table>
    <h2>IVA</h2><table><thead><tr><th>Trimestre</th><th class="n">Sulle entrate</th><th class="n">Sulle uscite</th><th class="n">Differenza</th></tr></thead><tbody>${t.tri.map((x,i)=>`<tr><td>${i+1}°</td><td class="n">${euro(x.ivaE)}</td><td class="n">${euro(x.ivaU)}</td><td class="n">${euro(x.ivaE-x.ivaU)}</td></tr>`).join('')}</tbody></table>
    <p class="p">Prospetto di riferimento ricavato dai movimenti inseriti: l’IVA è calcolata sulle aliquote indicate; da verificare con il commercialista.</p></body></html>`;
  const w=window.open('','_blank');
  if(!w){alert('Il browser ha bloccato la finestra: consenti i popup per questo sito e riprova.');return}
  w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),300)}

/* =====================================================
   CALCOLATRICE (parser sicuro, niente eval)
   ===================================================== */
function calcola(src){
  const s=String(src||'').replace(/×|x|\*/gi,'*').replace(/÷|:/g,'/').replace(/−|–/g,'-').replace(/,/g,'.').replace(/\s+/g,'');
  if(!s)return null;
  if(!/^[0-9+\-*/().%]+$/.test(s))throw new Error('Carattere non valido');
  let p=0;
  const peek=()=>s[p];
  function expr(){
    let l=term();
    while(peek()==='+'||peek()==='-'){
      const o=s[p++],r=term();
      const rv=r.pct?l.v*r.v:r.v;          /* 200 + 10% = 220 */
      l={v:o==='+'?l.v+rv:l.v-rv}}
    return l}
  function term(){
    let l=unary();
    while(peek()==='*'||peek()==='/'){
      const o=s[p++],r=unary();
      if(o==='/'&&r.v===0)throw new Error('Divisione per zero');
      l={v:o==='*'?l.v*r.v:l.v/r.v}}
    return l}
  function unary(){
    if(peek()==='-'){p++;return {v:-unary().v}}
    if(peek()==='+'){p++;return unary()}
    return post()}
  function post(){
    let x=prim();
    while(peek()==='%'){p++;x={v:x.v/100,pct:true}}
    return x}
  function prim(){
    if(peek()==='('){p++;const e=expr();if(peek()!==')')throw new Error('Parentesi non chiusa');p++;return {v:e.v}}
    const m=/^\d*\.?\d+|^\d+\.?/.exec(s.slice(p));
    if(!m)throw new Error('Espressione incompleta');
    p+=m[0].length;return {v:parseFloat(m[0])}}
  const r=expr();
  if(p<s.length)throw new Error('Espressione non valida');
  if(!isFinite(r.v))throw new Error('Risultato non valido');
  return r.v}
const fmtNum=v=>String(Number(v.toFixed(10))).replace('.',',');
let hist=[],lastRes=null;
function bindCalc(){
  const ce=$('#ce');
  const prev=()=>{
    try{const v=calcola(ce.value);lastRes=v;$('#cp').textContent=v===null?'':(/[+\-−×÷*/x:%]/.test(ce.value.replace(/^[-−]/,''))?'= '+fmtNum(v):'')}
    catch(e){lastRes=null;$('#cp').textContent=''}};
  const ins=t=>{ce.value+=t;prev();ce.focus()};
  const eq=()=>{
    try{const v=calcola(ce.value);if(v===null)return;
      hist.unshift({e:ce.value,r:fmtNum(v)});hist=hist.slice(0,8);
      ce.value=fmtNum(v);lastRes=v;$('#cp').textContent='';drawHist()}
    catch(e){$('#cp').textContent=e.message}};
  const drawHist=()=>{$('#ch').innerHTML=hist.map((h,i)=>`<button data-h="${i}"><span class="e">${esc(h.e)}</span>${esc(h.r)}</button>`).join('')};
  $('#ck').onclick=e=>{
    const b=e.target.closest('[data-k]');if(!b)return;const k=b.dataset.k;
    if(k==='C'){ce.value='';$('#cp').textContent='';lastRes=null}
    else if(k==='BK'){ce.value=ce.value.slice(0,-1);prev()}
    else if(k==='=')eq();
    else ins(k)};
  ce.oninput=prev;
  ce.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();eq()}};
  $('#ch').onclick=e=>{const b=e.target.closest('[data-h]');if(b){ce.value=hist[b.dataset.h].r;prev()}};
  const base=()=>{try{const v=calcola(ce.value);if(v===null)throw 0;return v}catch(x){$('#cp').textContent='Inserisci prima un importo.';return null}};
  const setV=(v,lab)=>{hist.unshift({e:lab,r:fmtNum(v)});hist=hist.slice(0,8);ce.value=fmtNum(v);$('#cp').textContent='';drawHist()};
  const aliq=()=>Number($('#cr').value)/100;
  const perc=()=>{const x=parseFloat(String($('#cpv').value||'').replace(',','.'));return isFinite(x)&&x>=0?x:null};
  const pc=(f,lab)=>()=>{const v=base();if(v===null)return;const x=perc();if(x===null){$('#cp').textContent='Inserisci la percentuale (es. 20).';return}setV(f(v,x),lab(x,fmtNum(v)))};
  $('#cpp').onclick=pc((v,x)=>v*(1+x/100),(x,vs)=>vs+' + '+x+'%');
  $('#cpm').onclick=pc((v,x)=>v*(1-x/100),(x,vs)=>vs+' − '+x+'%');
  $('#cpo').onclick=pc((v,x)=>v*x/100,(x,vs)=>x+'% di '+vs);
  $('#civp').onclick=()=>{const v=base();if(v!==null)setV(v*(1+aliq()),fmtNum(v)+' + IVA '+$('#cr').value+'%')};
  $('#civm').onclick=()=>{const v=base();if(v!==null)setV(v/(1+aliq()),fmtNum(v)+' scorporo IVA '+$('#cr').value+'%')};
  $('#civ0').onclick=()=>{const v=base();if(v!==null)setV(v-v/(1+aliq()),'IVA '+$('#cr').value+'% contenuta in '+fmtNum(v))};
  $('#ccp').onclick=async()=>{const v=base();if(v===null)return;
    try{await navigator.clipboard.writeText(fmtNum(v));$('#cp').textContent='Copiato: '+fmtNum(v)}catch(x){$('#cp').textContent='Copia non riuscita'}};
  const bl=$('#cbl');
  if(bl)bl.onclick=()=>{const v=base();if(v===null)return;
    if(!(v>0)){$('#cp').textContent='L’importo deve essere maggiore di zero.';return}
    setTab('b');setBForm(true);if(editV)resetVoce();setBForm(true);
    $('#vi').value=v.toFixed(2).replace('.',',');$('#vs').focus();$('#bft').scrollIntoView({behavior:'smooth',block:'start'})};
}

/* =====================================================
   CALENDARIO, NOTE E ALERT
   ===================================================== */
const dueAt=n=>new Date(n.data+'T'+(n.ora||'09:00')+':00');
const alertAt=n=>(n.alertMin===null||n.alertMin===undefined||n.alertMin==='')?null:new Date(dueAt(n).getTime()-Number(n.alertMin)*60000);
const dismissed=()=>{try{return JSON.parse(localStorage.getItem('comm_ok')||'{}')}catch(e){return {}}};
const dismissKey=n=>n.id+'|'+n.data+'|'+(n.ora||'')+'|'+(n.alertMin??'');
const notified=new Set();
function bindCal(){
  const w=canW();
  $('#cpv').onclick=()=>{cm--;if(cm<0){cm=11;cy--}renderCal()};
  $('#cnx').onclick=()=>{cm++;if(cm>11){cm=0;cy++}renderCal()};
  $('#cto').onclick=()=>{const d=new Date();cy=d.getFullYear();cm=d.getMonth();sel=iso(d);renderCal()};
  $('#cg').onclick=e=>{const b=e.target.closest('[data-d]');if(!b)return;sel=b.dataset.d;
    const d=new Date(sel+'T12:00:00');cy=d.getFullYear();cm=d.getMonth();renderCal()};
  const lst=e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const it=items.find(x=>x.id===b.dataset.id);if(!it)return;
    if(b.dataset.a==='edit')editNota(it);
    else if(b.dataset.a==='del'){
      if(!confirm('Eliminare la nota «'+it.titolo+'»? Va nel Cestino e resta recuperabile per 30 giorni.'))return;
      deleteDoc(doc(db,'sections',SEC,'items',it.id)).then(()=>{if(editN===it.id)closeNota()}).catch(x=>{console.error(x);alert('Eliminazione non riuscita.')})}};
  const chk=e=>{const c=e.target.closest('[data-f]');if(!c)return;
    updateDoc(doc(db,'sections',SEC,'items',c.dataset.f),{fatto:c.checked}).catch(x=>{console.error(x);c.checked=!c.checked;alert('Salvataggio non riuscito.')})};
  $('#kl').onclick=lst;$('#kl').onchange=chk;$('#kn').onclick=lst;$('#kn').onchange=chk;
  if(w){
    $('#krp').onchange=()=>{$('#kqw').hidden=$('#krp').value==='0'};
    $('#knew').onclick=()=>{closeNota();$('#kf').hidden=false;$('#kdt').value=sel||todayIso();$('#kt').focus()};
    $('#ksv').onclick=saveNota;$('#kcx').onclick=closeNota}
  if('Notification' in window&&Notification.permission==='default'){
    const b=$('#knt');b.hidden=false;
    b.onclick=()=>Notification.requestPermission().then(()=>{b.hidden=true;checkAlerts()})}
  if(!sel)sel=todayIso();
}
function closeNota(){
  editN=null;if(!canW())return;
  $('#krp').value='0';$('#kqt').value='12';$('#kqw').hidden=true;$('#krw').hidden=false;
  $('#kf').hidden=true;['kt','kdt','kh','kx'].forEach(i=>$('#'+i).value='');$('#ka').value='';$('#kfb').checked=false;$('#ker').textContent=''}
function editNota(it){
  setTab('k');editN=it.id;$('#kf').hidden=false;$('#krp').value='0';$('#kqw').hidden=true;$('#krw').hidden=true;   /* la ripetizione si imposta solo su una nota nuova */
  $('#kt').value=it.titolo||'';$('#kdt').value=it.data||'';$('#kh').value=it.ora||'';$('#kx').value=it.testo||'';
  $('#ka').value=(it.alertMin===null||it.alertMin===undefined||it.alertMin==='')?'':String(it.alertMin);$('#kfb').checked=!!it.fb;$('#ker').textContent='';
  $('#kf').scrollIntoView({behavior:'smooth',block:'center'})}
async function saveNota(){
  const er=$('#ker'),titolo=$('#kt').value.trim(),data=$('#kdt').value,ora=$('#kh').value,testo=$('#kx').value.trim(),al=$('#ka').value;
  if(!titolo){er.textContent='Inserisci un titolo.';return}
  if(!isD(data)){er.textContent='Inserisci la data.';return}
  const alertMin=al===''?null:Number(al);
  const rp=editN?0:Number($('#krp').value)||0,tot=rp?parseInt($('#kqt').value,10)||0:1;
  if(rp&&(tot<2||tot>60)){er.textContent='Indica quante volte ripetere la scadenza in tutto (da 2 a 60).';return}
  const prev=editN?items.find(x=>x.id===editN):null;
  const mk=d=>({kind:'nota',titolo,data:d,ora:ora||'',testo,alertMin,fatto:prev?!!prev.fatto:false,fb:$('#kfb').checked,title:titolo,
    note:[fmtD(d),ora,testo].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)});
  $('#ksv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editN)await updateDoc(doc(db,'sections',SEC,'items',editN),mk(data));
    else{const serie=rp?newSerie():'';
      for(let i=0;i<tot;i++){if(rp)er.textContent='Salvataggio '+(i+1)+' di '+tot+'…';
        await addDoc(col,{...mk(rp?addMesiIso(data,rp*i):data),...(rp?{serie,nrip:i+1,totrip:tot}:{}),by:uid,at:serverTimestamp()})}}
    sel=data;const dd=new Date(data+'T12:00:00');cy=dd.getFullYear();cm=dd.getMonth();
    closeNota();renderCal();checkAlerts();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#ksv').disabled=false}

function noteRow(n,showDate){
  const w=canW(),due=dueAt(n),late=!n.fatto&&due<new Date()&&(n.ora||n.data<todayIso());
  const al=alertAt(n);
  const alTxt=al?ALERTS.find(a=>a[0]===String(n.alertMin))?.[1]||'':'';
  return `<div class="nt"><input type="checkbox" data-f="${esc(n.id)}" ${n.fatto?'checked':''} ${w?'':'disabled'} aria-label="Fatto: ${esc(n.titolo)}">
    <div class="inf"><div class="tt ${n.fatto?'done':''}"><b>${esc(n.titolo)}</b>${late?' <span class="chip bad">scaduta</span>':''}${n.fb?' <span class="mu">☁</span>':''}</div>
    <div class="mu">${showDate?esc(fmtD(n.data))+' ':''}${n.ora?'ore '+esc(n.ora):'tutto il giorno'}${alTxt?' · ⏰ '+esc(alTxt.toLowerCase()):''}</div>
    ${n.testo?`<div class="tx">${esc(n.testo)}</div>`:''}</div>
    ${w?`<div class="ac"><button class="btn ghost sm" data-a="edit" data-id="${esc(n.id)}">Modifica</button><button class="btn ghost sm" data-a="del" data-id="${esc(n.id)}">Elimina</button></div>`:''}</div>`}
function renderCal(){
  if(!$('#cg'))return;
  $('#cl').textContent=MESI[cm]+' '+cy;
  const nn=note(),byD={};nn.forEach(n=>{(byD[n.data]=byD[n.data]||[]).push(n)});
  const first=new Date(cy,cm,1),off=(first.getDay()+6)%7,tod=todayIso();
  let h=['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map(d=>`<div class="wd">${d}</div>`).join('');
  const righe=Math.ceil((off+new Date(cy,cm+1,0).getDate())/7);
  for(let i=0;i<righe*7;i++){
    const d=new Date(cy,cm,1-off+i),k=iso(d),ls=byD[k]||[];
    const dots=ls.slice(0,4).map(n=>`<span class="dot ${!n.fatto&&alertAt(n)?'al':''}"></span>`).join('');
    h+=`<button class="cd ${d.getMonth()!==cm?'out':''} ${k===tod?'today':''} ${k===sel?'sel':''}" data-d="${k}" aria-label="${d.getDate()} ${MESI[d.getMonth()]}${ls.length?', '+ls.length+' note':''}"><span>${d.getDate()}</span><span class="dots">${dots}</span></button>`}
  $('#cg').innerHTML=h;
  const sd=new Date(sel+'T12:00:00');
  $('#kd').textContent=sd.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const ls=(byD[sel]||[]).sort((a,b)=>(a.ora||'99').localeCompare(b.ora||'99'));
  $('#kl').innerHTML=ls.length?ls.map(n=>noteRow(n,false)).join(''):'<div class="mu" style="padding:8px 0">Nessuna nota in questo giorno.</div>';
  const next=nn.filter(n=>!n.fatto&&n.data>=tod).sort((a,b)=>dueAt(a)-dueAt(b)).slice(0,8);
  const late=nn.filter(n=>!n.fatto&&n.data<tod).sort((a,b)=>dueAt(a)-dueAt(b));
  $('#kn').innerHTML=(late.length+next.length)?[...late,...next].map(n=>noteRow(n,true)).join(''):'<div class="mu" style="padding:8px 0">Nessun appuntamento in programma.</div>'}

/* Alert: banner in alto, sempre visibile, + notifica del browser se consentita */
let alSig='';
function checkAlerts(){
  const host=$('#al');if(!host)return;
  const dis=dismissed(),nw=new Date();
  const act=note().filter(n=>{const a=alertAt(n);return !n.fatto&&a&&a<=nw&&!dis[dismissKey(n)]}).sort((a,b)=>dueAt(a)-dueAt(b));
  act.forEach(n=>{const k=dismissKey(n);if(!notified.has(k)){notified.add(k);
    try{if('Notification' in window&&Notification.permission==='granted')new Notification('Commercialista: '+n.titolo,{body:fmtD(n.data)+(n.ora?' ore '+n.ora:'')+(n.testo?' – '+n.testo:'')})}catch(e){}}});
  const sig=act.map(dismissKey).join('#')+'|'+canW();
  if(sig===alSig)return;alSig=sig;
  if(!act.length){host.innerHTML='';return}
  host.innerHTML=`<div class="card" role="alert"><h3>⏰ Promemoria (${act.length})</h3>${act.map(n=>{const late=dueAt(n)<nw;return `<div class="ar"><div class="inf"><b>${esc(n.titolo)}</b> ${late?'<span class="chip bad">scaduta</span>':'<span class="chip warn">in arrivo</span>'}<div class="mu">${esc(fmtD(n.data))}${n.ora?' ore '+esc(n.ora):''}</div></div>${canW()?`<button class="btn sm" data-fa="${esc(n.id)}">Fatto</button>`:''}<button class="btn ghost sm" data-ok="${esc(n.id)}">OK</button></div>`}).join('')}</div>`;
  host.onclick=e=>{
    const f=e.target.closest('[data-fa]'),o=e.target.closest('[data-ok]');
    if(f)updateDoc(doc(db,'sections',SEC,'items',f.dataset.fa),{fatto:true}).catch(x=>{console.error(x);alert('Salvataggio non riuscito.')});
    if(o){const n=items.find(x=>x.id===o.dataset.ok);if(n){const d=dismissed();d[dismissKey(n)]=1;store('comm_ok',JSON.stringify(d));alSig='';checkAlerts()}}}}
setInterval(()=>{if(me&&perm()!=='n')checkAlerts()},20000);

/* ---------- avvio ---------- */
if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me||perm()==='n'){app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');shellFor='';if(memo)memo.setAccess('n',false);return}
      if(!memo)memo=memoBar({db,sec:SEC,uid});memo.setAccess(perm(),!!me.admin);
      if(shellFor!==perm()){alSig='';shell()}
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderBil();renderRiep();renderCal();checkAlerts()},()=>{}));
      renderBil();renderRiep();renderCal();checkAlerts();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
