/* Scheda Commercialista: Bilancio (entrate/uscite), Calcolatrice, Calendario con note e alert.
   Dati in sections/commercialista/items (come le altre sezioni: Telegram + copia facoltativa su Firebase):
   - kind:'voce'  = movimento di bilancio (tipo entrata|uscita, data, cent, iva, ...)
   - kind:'nota'  = nota del calendario (data, ora, testo, alertMin, fatto) */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
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
const ALERTS=[['','Nessun alert'],['0','All’ora dell’evento'],['15','15 minuti prima'],['60','1 ora prima'],['1440','1 giorno prima'],['2880','2 giorni prima'],['10080','1 settimana prima']];
const MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

let auth,db,col,uid=null,me=null,items=[],unsubs=[],shellFor='',memo=null;
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const canW=()=>perm()==='w';
const tabGet=()=>{try{return localStorage.getItem('comm_tab')||'b'}catch(e){return 'b'}};
let tab=tabGet();
let editV=null,editN=null;
let bq='',bTipo='all',bAnno='all',bMese='all';
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
  <div class="tabs"><span class="seg" role="group" aria-label="Strumenti"><button data-t="b">Bilancio</button><button data-t="c">Calcolatrice</button><button data-t="k">Calendario</button></span></div>

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
          <label for="vo">Note</label><textarea id="vo"></textarea>
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
        <select id="bm" aria-label="Mese"><option value="all">Tutti i mesi</option>${MESI.map((m,i)=>`<option value="${i+1}">${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}</select>
        <button class="btn ghost sm" id="bcsv">Scarica CSV</button></div>
      <div id="bls"></div>
      <details class="cat"><summary>Riepilogo per categoria</summary><div class="scroll" id="bcat"></div></details>
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
        <button class="btn ghost sm" id="civ+">+ IVA</button><button class="btn ghost sm" id="civ-">Scorpora IVA</button><button class="btn ghost sm" id="civ0">Solo IVA</button></div>
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
  bindBil();bindCalc();bindCal();setTab(tab);
}
function setTab(t){
  tab=t;store('comm_tab',t);
  ['b','c','k'].forEach(k=>{const p=$('#p'+k);if(p)p.hidden=k!==t});
  document.querySelectorAll('[data-t]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===t)))}

/* =====================================================
   BILANCIO
   ===================================================== */
function bindBil(){
  const w=canW();
  $('#bq').oninput=e=>{bq=e.target.value;renderBil()};
  $('#bt').onchange=e=>{bTipo=e.target.value;renderBil()};
  $('#ba').onchange=e=>{bAnno=e.target.value;renderBil()};
  $('#bm').onchange=e=>{bMese=e.target.value;renderBil()};
  $('#bcsv').onclick=csvBil;
  $('#bls').onclick=e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const it=items.find(x=>x.id===b.dataset.id);if(!it)return;
    if(b.dataset.a==='edit')editVoce(it);
    else if(b.dataset.a==='del'){
      if(!confirm('Eliminare il movimento «'+(it.descr||'senza descrizione')+'»? L’operazione non si può annullare.'))return;
      deleteDoc(doc(db,'sections',SEC,'items',it.id)).then(()=>{if(editV===it.id)resetVoce()}).catch(x=>{console.error(x);alert('Eliminazione non riuscita.')})}};
  if(w){
    $('#bftg').onclick=()=>setBForm($('#bfb').hidden);
    $('#vsv').onclick=saveVoce;$('#vcx').onclick=resetVoce;
    $('#vd').value=todayIso()}
}
function setBForm(o){
  const b=$('#bfb'),t=$('#bftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?'Chiudi il modulo del movimento':'Apri il modulo del movimento')}
const VF=[['vt','tipo'],['vd','data'],['vs','descr'],['vc','categoria'],['vp','controparte'],['vn','doc'],['vv','iva'],['vm','pagamento'],['vo','annotazioni']];
function resetVoce(){
  setBForm(false);editV=null;
  VF.forEach(([e])=>{const el=$('#'+e);el.value=el.tagName==='SELECT'?el.options[0].value:''});
  $('#vd').value=todayIso();$('#vi').value='';$('#vfb').checked=false;
  $('#bft').textContent='Nuovo movimento';$('#vsv').textContent='Salva movimento';$('#vcx').hidden=true;$('#ver').textContent=''}
function editVoce(it){
  setBForm(true);editV=it.id;
  VF.forEach(([e,k])=>{$('#'+e).value=it[k]!=null?String(it[k]):''});
  $('#vi').value=(it.cent/100).toFixed(2).replace('.',',');$('#vfb').checked=!!it.fb;
  $('#bft').textContent='Modifica movimento';$('#vsv').textContent='Salva modifiche';$('#vcx').hidden=false;$('#ver').textContent='';
  setTab('b');$('#bft').scrollIntoView({behavior:'smooth',block:'start'})}
async function saveVoce(){
  const er=$('#ver'),v={};
  VF.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  const cent=parseEuro($('#vi').value);
  if(!isD(v.data)){er.textContent='Inserisci la data.';return}
  if(!v.descr){er.textContent='Inserisci una descrizione.';return}
  if(!(cent>0)){er.textContent='Inserisci un importo valido, maggiore di zero (es. 120,50).';return}
  v.iva=Number(v.iva)||0;
  const eur=euro(cent);
  const data={...v,kind:'voce',cent,fb:$('#vfb').checked,title:v.descr,
    note:[v.tipo,eur,fmtD(v.data),v.categoria,v.controparte,v.doc,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#vsv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editV)await updateDoc(doc(db,'sections',SEC,'items',editV),data);
    else await addDoc(col,{...data,by:uid,at:serverTimestamp()});
    resetVoce();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#vsv').disabled=false}

function bilFiltrate(){
  const t=bq.trim().toLowerCase();
  return voci().filter(v=>{
    if(bTipo!=='all'&&v.tipo!==bTipo)return false;
    if(bAnno!=='all'&&String(v.data||'').slice(0,4)!==bAnno)return false;
    if(bMese!=='all'&&Number(String(v.data||'').slice(5,7))!==Number(bMese))return false;
    if(t&&![v.descr,v.categoria,v.controparte,v.doc,v.annotazioni,v.pagamento,fmtD(v.data),(v.cent/100).toFixed(2).replace('.',',')].filter(Boolean).join(' ').toLowerCase().includes(t))return false;
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
    const sub=[v.categoria,v.controparte,v.doc&&'doc. '+v.doc,v.pagamento].filter(Boolean).map(esc).join(' · ');
    return `<div class="mv"><div class="dt">${esc(fmtD(v.data))}</div><div class="inf"><div><b>${esc(v.descr||'—')}</b>${v.fb?' <span class="mu" title="Copia su Firebase">☁</span>':''}</div>${sub?`<div class="mu">${sub}</div>`:''}${v.annotazioni?`<div class="mu">${esc(v.annotazioni)}</div>`:''}</div>
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
  const rows=[['Data','Tipo','Descrizione','Categoria','Cliente/fornitore','N. documento','Pagamento','Importo (€)','Aliquota IVA %','IVA inclusa (€)','Note'].map(c).join(';')];
  list.forEach(v=>rows.push([fmtD(v.data),v.tipo,v.descr,v.categoria,v.controparte,v.doc,v.pagamento,n(v.cent*sgn(v)),v.iva||0,n(ivaDi(v.cent,v.iva)*sgn(v)),v.annotazioni].map(c).join(';')));
  const tot=list.reduce((s,v)=>s+v.cent*sgn(v),0);
  rows.push(['','','TOTALE (entrate − uscite)','','','','',n(tot),'','',''].map(c).join(';'));
  dl('bilancio.csv','\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8')}

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
  $('#civ+').onclick=()=>{const v=base();if(v!==null)setV(v*(1+aliq()),fmtNum(v)+' + IVA '+$('#cr').value+'%')};
  $('#civ-').onclick=()=>{const v=base();if(v!==null)setV(v/(1+aliq()),fmtNum(v)+' scorporo IVA '+$('#cr').value+'%')};
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
      if(!confirm('Eliminare la nota «'+it.titolo+'»?'))return;
      deleteDoc(doc(db,'sections',SEC,'items',it.id)).then(()=>{if(editN===it.id)closeNota()}).catch(x=>{console.error(x);alert('Eliminazione non riuscita.')})}};
  const chk=e=>{const c=e.target.closest('[data-f]');if(!c)return;
    updateDoc(doc(db,'sections',SEC,'items',c.dataset.f),{fatto:c.checked}).catch(x=>{console.error(x);c.checked=!c.checked;alert('Salvataggio non riuscito.')})};
  $('#kl').onclick=lst;$('#kl').onchange=chk;$('#kn').onclick=lst;$('#kn').onchange=chk;
  if(w){
    $('#knew').onclick=()=>{closeNota();$('#kf').hidden=false;$('#kdt').value=sel||todayIso();$('#kt').focus()};
    $('#ksv').onclick=saveNota;$('#kcx').onclick=closeNota}
  if('Notification' in window&&Notification.permission==='default'){
    const b=$('#knt');b.hidden=false;
    b.onclick=()=>Notification.requestPermission().then(()=>{b.hidden=true;checkAlerts()})}
  if(!sel)sel=todayIso();
}
function closeNota(){
  editN=null;if(!canW())return;
  $('#kf').hidden=true;['kt','kdt','kh','kx'].forEach(i=>$('#'+i).value='');$('#ka').value='';$('#kfb').checked=false;$('#ker').textContent=''}
function editNota(it){
  setTab('k');editN=it.id;$('#kf').hidden=false;
  $('#kt').value=it.titolo||'';$('#kdt').value=it.data||'';$('#kh').value=it.ora||'';$('#kx').value=it.testo||'';
  $('#ka').value=(it.alertMin===null||it.alertMin===undefined||it.alertMin==='')?'':String(it.alertMin);$('#kfb').checked=!!it.fb;$('#ker').textContent='';
  $('#kf').scrollIntoView({behavior:'smooth',block:'center'})}
async function saveNota(){
  const er=$('#ker'),titolo=$('#kt').value.trim(),data=$('#kdt').value,ora=$('#kh').value,testo=$('#kx').value.trim(),al=$('#ka').value;
  if(!titolo){er.textContent='Inserisci un titolo.';return}
  if(!isD(data)){er.textContent='Inserisci la data.';return}
  const alertMin=al===''?null:Number(al);
  const prev=editN?items.find(x=>x.id===editN):null;
  const d={kind:'nota',titolo,data,ora:ora||'',testo,alertMin,fatto:prev?!!prev.fatto:false,fb:$('#kfb').checked,title:titolo,
    note:[fmtD(data),ora,testo].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#ksv').disabled=true;er.textContent='Salvataggio…';
  try{
    if(editN)await updateDoc(doc(db,'sections',SEC,'items',editN),d);
    else await addDoc(col,{...d,by:uid,at:serverTimestamp()});
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
      if(unsubs.length<2)unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderBil();renderCal();checkAlerts()},()=>{}));
      renderBil();renderCal();checkAlerts();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
