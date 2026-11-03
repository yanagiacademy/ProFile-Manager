import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,setDoc,serverTimestamp} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";
import {memoBar} from "./promemoria.js";
import {isD,fmtD,giorni,addCad,ultimoTest,prossimoTest,testStato,testDaFare,testTesto} from "./atleti-scadenze.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

const SEC='atleti';
let auth,db,col,uid=null,me=null,items=[],tess=[],mails={},q='',flt='all',unsubs=[],shellFor='',editing=null,memo=null,detail=null;
/* Email dell'atleta: solo admin. Sta in una raccolta Firestore a parte (atletiMail/<idAtleta>), NON nella scheda su Telegram/Firebase, e le regole la fanno leggere solo all'admin */
const isAdm=()=>!!(me&&me.admin);
const mailOf=id=>(mails[id]&&mails[id].email)||'';
const MAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function saveMail(id,email){
  if(!isAdm())return;
  const r=doc(db,'atletiMail',id);
  if(email)await setDoc(r,{email,by:uid,at:serverTimestamp()});
  else if(mails[id])await deleteDoc(r)}
const perm=()=>me?(me.admin?'w':((me.perms||{})[SEC]||'n')):'n';
const nameOf=i=>((i.cognome||'')+' '+(i.nome||'')).trim()||i.title||'';
const lines=s=>String(s||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
const uidn=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const p2=n=>String(n).padStart(2,'0');
const todayStr=()=>{const n=new Date();return n.getFullYear()+'-'+p2(n.getMonth()+1)+'-'+p2(n.getDate())};
const TIPO={agonista:'Agonista',dilettante:'Dilettante'};
const POSTO={'1':'🥇 1° posto','2':'🥈 2° posto','3':'🥉 3° posto','5':'5° posto','P':'Partecipazione'};
/* Tipi di test predefiniti (modificabili per ogni atleta quando si registra una rilevazione) */
const DEF_TEST=['CMJ','1RM p.piana+squat','Sprint 30m','Illinois Agility test','Test di Cooper','SJFT'];
const cadTxt=i=>+i.cadN>0?'ogni '+(+i.cadN)+(i.cadU==='s'?(+i.cadN===1?' settimana':' settimane'):(+i.cadN===1?' mese':' mesi')):'';

/* Tessera e certificato medico: li gestisce la sezione Tessere (qui si leggono soltanto, senza alert) */
const tessOf=id=>tess.find(t=>t.atleta===id)||null;
/* ID atleta = numero della tessera (sezione Tessere), aggiornato in automatico; per gli atleti senza tessera resta l'eventuale vecchio valore */
const idAtleta=i=>(tessOf(i.id)&&tessOf(i.id).numero)||i.idAtl||'';

/* Chip di stato del test: rosso quando l'alert è attivo */
function testChip(i){
  const s=testStato(i);
  if(!s)return '<span class="chip">Test: —</span>';
  if(s.due)return `<span class="chip bad">Test: ${s.late?'in ritardo':'da fare'}</span>`;
  if(s.g<=14)return `<span class="chip warn">Test ${testTesto(s.g)}</span>`;
  return `<span class="chip">Test: ${fmtD(s.data)}</span>`}

function allTestNames(){
  const s=new Set([...DEF_TEST,'Beep test','Peso']);
  items.forEach(i=>{(i.testTipi||[]).forEach(n=>s.add(n));(i.test||[]).forEach(t=>(t.r||[]).forEach(r=>s.add(r.n)))});
  return [...s].filter(Boolean).sort((a,b)=>a.localeCompare(b,'it'))}

/* ---------- struttura della pagina (creata una volta sola) ---------- */
function shell(){
  const w=perm()==='w';shellFor=perm();
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><input id="q" type="search" placeholder="Cerca negli atleti" aria-label="Cerca negli atleti" value="${esc(q)}"><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">Atleti</h2><span class="badge">${w?'Lettura e scrittura':'Solo lettura'}</span></div></div>
  ${w?`<div class="card" style="margin-bottom:12px"><div class="fh"><h3 id="ft" style="margin:0">Nuovo atleta</h3><button class="btn sm" id="ftg" style="min-width:44px;font-size:1.2rem" aria-expanded="false" aria-controls="fb" aria-label="Apri il modulo dell'atleta">+</button></div>
    <div id="fb" hidden>
    <fieldset><legend>Dati anagrafici</legend>
      <div class="two"><div><label for="nm">Nome</label><input id="nm" type="text" autocomplete="off"></div><div><label for="cg">Cognome</label><input id="cg" type="text" autocomplete="off"></div></div>
      <div class="two"><div><label for="sx">Sesso</label><select id="sx"><option value=""></option><option value="M">M</option><option value="F">F</option></select></div><div><label for="an">Anno di nascita</label><input id="an" type="number" inputmode="numeric" min="1900" max="2100" autocomplete="off"></div></div>
      <div class="two"><div><label for="gr">Grado</label><input id="gr" type="text" list="lg" autocomplete="off"><datalist id="lg"></datalist></div><div><label for="ct">Categoria</label><input id="ct" type="text" list="lc" autocomplete="off"><datalist id="lc"></datalist></div></div>
      <div class="two"><div><label for="pe">Peso (kg)</label><input id="pe" type="text" inputmode="decimal" autocomplete="off"></div><div><label for="al">Altezza (cm)</label><input id="al" type="text" inputmode="numeric" autocomplete="off"></div></div>
      <div class="two"><div><label for="at">Allenatore</label><input id="at" type="text" list="la" autocomplete="off"><datalist id="la"></datalist></div>${isAdm()?'<div><label for="em">Email dell\'atleta (visibile solo all\'admin)</label><input id="em" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"></div>':''}</div>
      <label for="tp">Agonista o Dilettante</label><select id="tp"><option value=""></option><option value="agonista">Agonista</option><option value="dilettante">Dilettante</option></select>
    </fieldset>
    <fieldset><legend>Scheda tecnica</legend>
      <label for="ku">Kumi kata</label><input id="ku" type="text" autocomplete="off">
      <div class="two"><div><label for="tw">Tachi waza (una per riga)</label><textarea id="tw" style="min-height:110px"></textarea></div><div><label for="nw">Ne waza (una per riga)</label><textarea id="nw" style="min-height:110px"></textarea></div></div>
      <label for="rq">Richieste</label><textarea id="rq"></textarea>
      <p class="mu" style="margin:8px 0 0">Il medagliere si compila dalla scheda dell'atleta, dopo averlo salvato.</p>
    </fieldset>
    <fieldset><legend>Scheda fisica · cadenza dei test</legend>
      <div class="two"><div><label for="cn">Test ogni</label><input id="cn" type="number" inputmode="numeric" min="1" max="60" autocomplete="off"></div><div><label for="cu">Unità</label><select id="cu"><option value="s">Settimane</option><option value="m" selected>Mesi</option></select></div></div>
      <div class="two"><div><label for="px">Prossimo test (data alert)</label><input id="px" type="date"></div><div><label for="pv">Avvisa con anticipo di (giorni)</label><input id="pv" type="number" inputmode="numeric" min="0" max="90" autocomplete="off" placeholder="0"></div></div>
      <p class="mu" style="margin:8px 0 0">Se lasci vuota la data, si calcola da sola: ultimo test + cadenza. Dalla data alert la scheda Atleti diventa rossa nella Home. Le rilevazioni dei test (compreso l'SJFT) si registrano dalla scheda dell'atleta.</p>
      <label for="cc">Conclusioni</label><textarea id="cc"></textarea>
    </fieldset>
    <fieldset><legend>Obiettivi, monitoraggio e note</legend>
      <label for="ob">Obiettivi</label><textarea id="ob"></textarea>
      <label for="inf">Infortuni</label><textarea id="inf" style="min-height:70px"></textarea>
      <label for="nt">Note</label><textarea id="nt"></textarea>
      <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="fbk" style="width:auto;min-height:0"> Salva anche su Firebase</label>
    </fieldset>
    <p class="err" id="er" role="alert"></p>
    <div class="acts"><button class="btn" id="sv">Salva atleta</button><button class="btn ghost" id="cx" hidden>Annulla modifica</button></div></div></div>`:''}
  <div class="card" id="ls" style="padding:8px 14px"></div></div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  $('#q').oninput=e=>{q=e.target.value;renderList()};
  $('#ls').onclick=e=>{const b=e.target.closest('[data-id]');if(b)openDetail(b.dataset.id)};
  if(w){$('#ftg').onclick=()=>setForm($('#fb').hidden);$('#sv').onclick=save;$('#cx').onclick=resetForm}
}
function setForm(o){
  const b=$('#fb'),t=$('#ftg');if(!b)return;
  b.hidden=!o;t.textContent=o?'−':'+';t.setAttribute('aria-expanded',String(o));t.setAttribute('aria-label',o?"Chiudi il modulo dell'atleta":"Apri il modulo dell'atleta")}
const F=[['nm','nome'],['cg','cognome'],['sx','sesso'],['an','anno'],['gr','grado'],['ct','categoria'],['pe','peso'],['al','altezza'],['at','allenatore'],['tp','tipo'],
  ['ku','kumi'],['tw','tachi'],['nw','ne'],['rq','richieste'],['cn','cadN'],['cu','cadU'],['px','prossimo'],['pv','preavviso'],['cc','conclusioni'],['ob','obiettivi'],['inf','infortuni'],['nt','annotazioni']];
function resetForm(){
  setForm(false);editing=null;F.forEach(([e])=>$('#'+e).value='');if($('#em'))$('#em').value='';$('#cu').value='m';$('#fbk').checked=false;
  $('#ft').textContent='Nuovo atleta';$('#sv').textContent='Salva atleta';$('#cx').hidden=true;$('#er').textContent=''}
function edit(it){
  setForm(true);editing=it.id;F.forEach(([e,k])=>$('#'+e).value=it[k]??'');if($('#em'))$('#em').value=mailOf(it.id);if(!$('#cu').value)$('#cu').value='m';$('#fbk').checked=!!it.fb;
  $('#ft').textContent='Modifica atleta';$('#sv').textContent='Salva modifiche';$('#cx').hidden=false;$('#er').textContent='';
  $('#ft').scrollIntoView({behavior:'smooth',block:'start'})}

async function save(){
  const v={};F.forEach(([e,k])=>v[k]=$('#'+e).value.trim());
  v.peso=v.peso.replace(',','.');
  const er=$('#er');
  if(!v.nome||!v.cognome){er.textContent='Inserisci nome e cognome.';return}
  if(v.anno&&!(/^\d{4}$/.test(v.anno)&&+v.anno>=1900&&+v.anno<=new Date().getFullYear())){er.textContent='L’anno di nascita deve avere 4 cifre.';return}
  if(v.peso&&!/^\d{1,3}(\.\d{1,2})?$/.test(v.peso)){er.textContent='Il peso deve essere un numero (es. 66.5).';return}
  if(v.altezza&&!/^\d{2,3}$/.test(v.altezza)){er.textContent='L’altezza va indicata in centimetri (es. 172).';return}
  if(v.cadN&&!(+v.cadN>0)){er.textContent='La cadenza dei test deve essere un numero maggiore di zero.';return}
  if(v.cadN&&!v.cadU)v.cadU='m';
  const em=$('#em')?$('#em').value.trim().toLowerCase():null;
  if(em&&!MAIL_RE.test(em)){er.textContent='L’indirizzo email non è valido (es. nome@dominio.it).';return}
  const data={...v,fb:$('#fbk').checked,title:v.cognome+' '+v.nome,
    note:[v.grado,v.categoria,v.peso&&v.peso+' kg',TIPO[v.tipo],v.allenatore,v.obiettivi,v.annotazioni].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
  $('#sv').disabled=true;er.textContent='Salvataggio…';
  try{
    let id=editing;
    if(editing)await updateDoc(doc(db,'sections',SEC,'items',editing),data);
    else{const r=await addDoc(col,{...data,test:[],medaglie:[],by:uid,at:serverTimestamp()});id=r&&r.id}
    if(em!==null&&id)await saveMail(id,em);
    resetForm();
  }catch(e){console.error(e);er.textContent='Salvataggio non riuscito. Controlla i permessi e riprova.'}
  $('#sv').disabled=false}

/* ---------- salvataggio di una parte della scheda (test, SJFT, medagliere) ---------- */
async function patch(it,p){
  await updateDoc(doc(db,'sections',SEC,'items',it.id),p);
  Object.assign(it,p);paintDetail();renderList()}
/* dopo una rilevazione la data alert si ricalcola da sola (ultimo test + cadenza) */
function nextAfter(it,upd){
  const rec={...it,...upd},last=ultimoTest(rec),out={};
  if(!isD(last))return out;
  if(+it.cadN>0)out.prossimo=addCad(last,+it.cadN,it.cadU||'m');
  else if(isD(it.prossimo)&&it.prossimo<=last)out.prossimo='';
  return out}

/* ---------- finestra di dialogo generica ---------- */
function modal(title,body,{ok='Salva',onSave,onDel}={}){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact">${onDel?'<button class="btn ghost" data-del style="margin-right:auto">Elimina</button>':''}<button class="btn ghost" data-x>Annulla</button><button class="btn" data-ok>${ok}</button></div></div>`;
  const er=o.querySelector('[data-er]');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  const run=async fn=>{er.textContent='';try{if(await fn(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Salvataggio non riuscito. Riprova.'}};
  o.querySelector('[data-ok]').onclick=()=>run(onSave);
  if(onDel)o.querySelector('[data-del]').onclick=()=>{if(confirm('Eliminare questa voce? L’operazione non si può annullare.'))run(onDel)};
  document.body.append(o);return o}

/* Rilevazione test fisici: i tipi di test sono modificabili (nome, aggiunta, rimozione) */
function openTest(it,sess){
  const names=(it.testTipi&&it.testTipi.length?it.testTipi:DEF_TEST);
  let rows=sess?(sess.r||[]).map(r=>({n:r.n,v:r.v,sj:r.sj})):names.map(n=>({n,v:''}));
  const body=`<label for="td" style="margin-top:8px">Data del test</label><input id="td" type="date" value="${esc(sess?sess.data:todayStr())}">
    <label>Test e risultati</label><div id="tr"></div><button class="btn ghost sm" id="ta" type="button">+ Aggiungi test</button>
    <p class="mu" style="margin:8px 0 0">Puoi cambiare il nome di un test (es. Beep test al posto del test di Cooper) o toglierlo: la lista scelta resta per le prossime rilevazioni di questo atleta. Le righe senza risultato non vengono salvate.</p>
    <datalist id="lt">${allTestNames().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
  const o=modal(sess?'Modifica rilevazione':'Nuova rilevazione',body,{
    onDel:sess?async()=>{const list=(it.test||[]).filter(t=>t.id!==sess.id);await patch(it,{test:list,...nextAfter(it,{test:list})})}:null,
    onSave:async(o,er)=>{
      const data=o.querySelector('#td').value;
      if(!isD(data)){er.textContent='Indica la data del test.';return false}
      const r=rows.map(x=>({n:x.n.trim(),v:x.v.trim(),...(isSj(x.n)&&x.sj?{sj:x.sj}:{})})).filter(x=>x.n&&x.v);
      if(!r.length){er.textContent='Inserisci almeno un risultato.';return false}
      const tipi=[...new Set(rows.map(x=>x.n.trim()).filter(Boolean))];
      const list=sess?(it.test||[]).map(t=>t.id===sess.id?{...t,data,r}:t):[...(it.test||[]),{id:uidn(),data,r}];
      await patch(it,{test:list,testTipi:tipi,...nextAfter(it,{test:list})})}});
  const sjBlock=(x,i)=>`<div class="sj" style="margin:0 0 4px">${[['a','Lanci A (15 s)'],['b','Lanci B (30 s)'],['c','Lanci C (30 s)'],['f1','FC subito'],['f2','FC dopo 1 min']].map(([k,l])=>`<input type="number" inputmode="numeric" min="0" data-k="${i}" data-s="${k}" placeholder="${l}" aria-label="${l}" value="${esc((x.sj||{})[k]??'')}">`).join('')}</div><div class="mu" style="margin:0 0 8px;font-size:.8rem">SJFT: con lanci e frequenza cardiaca l’indice si scrive da solo nel risultato.</div>`;
  const draw=()=>{o.querySelector('#tr').innerHTML=rows.map((x,i)=>`<div class="rw"><input type="text" list="lt" data-n="${i}" placeholder="Test" value="${esc(x.n)}" aria-label="Nome del test"><input type="text" data-v="${i}" placeholder="Risultato" value="${esc(x.v)}" aria-label="Risultato"><button class="xb" type="button" data-r="${i}" aria-label="Togli questo test">✕</button></div>${isSj(x.n)?sjBlock(x,i):''}`).join('')};
  draw();
  o.querySelector('#tr').addEventListener('input',e=>{const n=e.target.dataset.n,v=e.target.dataset.v,k=e.target.dataset.k;
    if(k!==undefined){const r=rows[+k];r.sj={...(r.sj||{}),[e.target.dataset.s]:e.target.value};const ix=sjIdx(r.sj);
      if(ix){r.v='Indice '+ix+' (lanci '+sjTot(r.sj)+', FC '+r.sj.f1+'/'+r.sj.f2+')';o.querySelector('[data-v="'+k+'"]').value=r.v}}
    if(n!==undefined)rows[+n].n=e.target.value;if(v!==undefined)rows[+v].v=e.target.value});
  o.querySelector('#tr').addEventListener('change',e=>{if(e.target.dataset.n!==undefined)draw()});
  o.querySelector('#tr').addEventListener('click',e=>{const b=e.target.closest('[data-r]');if(b){rows.splice(+b.dataset.r,1);draw()}});
  o.querySelector('#ta').onclick=()=>{rows.push({n:'',v:''});draw();const l=o.querySelectorAll('[data-n]');l[l.length-1].focus()}}

/* SJFT (è un test come gli altri, nella lista dei test): lanci nelle 3 serie (15 s, 30 s, 30 s), FC subito dopo e dopo 1 minuto; indice = (FC subito + FC dopo 1') / lanci totali */
const isSj=n=>/sjft|special judo/i.test(n||'');
const sjTot=s=>(+s.a||0)+(+s.b||0)+(+s.c||0);
const sjIdx=s=>{const t=sjTot(s),h=(+s.f1||0)+(+s.f2||0);return t>0&&h>0?(h/t).toFixed(2):''};
function openMed(it){
  const body=`<label for="md" style="margin-top:8px">Data</label><input id="md" type="date" value="${todayStr()}">
    <label for="mg">Gara</label><input id="mg" type="text" autocomplete="off">
    <label for="mp">Risultato</label><select id="mp">${Object.entries(POSTO).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select>`;
  modal('Nuova medaglia o risultato',body,{onSave:async(o,er)=>{
    const data=o.querySelector('#md').value,gara=o.querySelector('#mg').value.trim(),posto=o.querySelector('#mp').value;
    if(!gara){er.textContent='Indica il nome della gara.';return false}
    await patch(it,{medaglie:[...(it.medaglie||[]),{id:uidn(),data:isD(data)?data:'',gara,posto}]})}})}

/* ---------- scheda di dettaglio ---------- */
function openDetail(id){
  if(!items.find(x=>x.id===id))return;
  const o=document.createElement('div');o.className='ov';
  o.innerHTML='<div class="card dlg big dl" role="dialog" aria-modal="true" aria-label="Scheda atleta"></div>';
  const close=()=>{o.remove();detail=null;document.removeEventListener('keydown',esc_)};
  const esc_=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',esc_);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.firstElementChild.addEventListener('click',async e=>{
    const b=e.target.closest('[data-a]');if(!b||!detail)return;
    const it=items.find(x=>x.id===detail.id);if(!it)return;
    const a=b.dataset.a,i=b.dataset.i;
    if(a==='x')close();
    else if(a==='edit'){close();edit(it)}
    else if(a==='del'){
      if(!confirm('Eliminare '+nameOf(it)+'? L’operazione non si può annullare.'))return;
      try{await deleteDoc(doc(db,'sections',SEC,'items',it.id));if(isAdm()&&mails[it.id])await deleteDoc(doc(db,'atletiMail',it.id)).catch(()=>{});if(editing===it.id)resetForm();close()}
      catch(x){console.error(x);alert('Eliminazione non riuscita.')}}
    else if(perm()!=='w')return;
    else if(a==='addT')openTest(it);
    else if(a==='editT')openTest(it,(it.test||[]).find(t=>t.id===i));
    else if(a==='addM')openMed(it);
    else if(a==='delM'){if(confirm('Togliere questa voce dal medagliere?'))try{await patch(it,{medaglie:(it.medaglie||[]).filter(m=>m.id!==i)})}catch(x){console.error(x);alert('Operazione non riuscita.')}}});
  detail={id,o};document.body.append(o);paintDetail();
  o.querySelector('[data-a="x"]').focus()}
function paintDetail(){
  if(!detail||!document.body.contains(detail.o))return;
  const it=items.find(x=>x.id===detail.id);
  if(!it){detail.o.remove();detail=null;return}
  const w=perm()==='w',c=detail.o.firstElementChild;
  const dd=(l,v)=>`<dt>${l}</dt><dd>${v!==''&&v!=null?esc(v):'<span class="mu">—</span>'}</dd>`;
  const bl=v=>v?`<div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem">${esc(v)}</div>`:'<div class="mu">—</div>';
  const ul=s=>{const l=lines(s);return l.length?`<ul class="ls">${l.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<div class="mu">—</div>'};
  const tt=tessOf(it.id),ts=testStato(it);
  /* test fisici: una colonna per rilevazione (le più recenti), una riga per test */
  const sess=[...(it.test||[])].sort((a,b)=>b.data.localeCompare(a.data)).slice(0,6);
  const tn=[...new Set([...(it.testTipi||DEF_TEST),...sess.flatMap(s=>(s.r||[]).map(r=>r.n))])];
  const tbl=sess.length?`<div class="tb"><table><thead><tr><th>Test</th>${sess.map(s=>`<th>${w?`<button data-a="editT" data-i="${esc(s.id)}" aria-label="Modifica la rilevazione del ${esc(fmtD(s.data))}">${esc(fmtD(s.data))}</button>`:esc(fmtD(s.data))}</th>`).join('')}</tr></thead><tbody>${tn.map(n=>`<tr><td>${esc(n)}</td>${sess.map(s=>{const r=(s.r||[]).find(x=>x.n===n);return `<td>${r?esc(r.v):'<span class="mu">—</span>'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="mu">Nessuna rilevazione registrata.</div>';
  const med=[...(it.medaglie||[])].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const cnt=k=>med.filter(m=>m.posto===k).length;
  const medH=med.length?`<div style="margin:2px 0 6px"><b>🥇 ${cnt('1')} · 🥈 ${cnt('2')} · 🥉 ${cnt('3')}</b></div>`+med.map(m=>`<div class="row" style="padding:6px 0"><div>${esc(POSTO[m.posto]||m.posto)} · <b>${esc(m.gara)}</b>${m.data?` <span class="mu">${esc(fmtD(m.data))}</span>`:''}</div>${w?`<button class="xb" data-a="delM" data-i="${esc(m.id)}" aria-label="Togli dal medagliere">✕</button>`:''}</div>`).join(''):'<div class="mu">Nessuna medaglia registrata.</div>';
  c.innerHTML=`<h2 style="margin:0">${esc(nameOf(it))}${it.grado?`<span class="gr">${esc(it.grado)}</span>`:''}</h2>
    <div class="chips" style="justify-content:flex-start;max-width:none;margin-top:6px">${it.tipo?`<span class="chip">${esc(TIPO[it.tipo]||it.tipo)}</span>`:''}${testChip(it)}</div>
    <h3>Dati anagrafici</h3><dl>${dd('Nome',it.nome)}${dd('Cognome',it.cognome)}${dd('Sesso',it.sesso)}${dd('Anno di nascita',it.anno)}${dd('Grado',it.grado)}${dd('Categoria',it.categoria)}${dd('Peso',it.peso?it.peso+' kg':'')}${dd('Altezza',it.altezza?it.altezza+' cm':'')}${dd('Allenatore',it.allenatore)}${dd('ID atleta (n. tessera)',idAtleta(it))}${dd('Tipo',TIPO[it.tipo]||'')}${isAdm()?dd('Email (solo admin)',mailOf(it.id)):''}</dl>
    <h3>Tecniche</h3><dl>${dd('Kumi kata',it.kumi)}</dl><div class="cols"><div><div class="mu" style="margin-top:6px">Tachi waza</div>${ul(it.tachi)}</div><div><div class="mu" style="margin-top:6px">Ne waza</div>${ul(it.ne)}</div></div>
    <h3>Medagliere${w?'<button class="btn ghost sm" data-a="addM">+ Aggiungi</button>':''}</h3>${medH}
    <h3>Richieste</h3>${bl(it.richieste)}
    <h3>Obiettivi</h3>${bl(it.obiettivi)}
    <h3>Cadenza dei test</h3><dl>${dd('Cadenza',cadTxt(it))}${dd('Ultimo test',isD(ultimoTest(it))?fmtD(ultimoTest(it)):'')}<dt>Prossimo test</dt><dd>${ts?esc(fmtD(ts.data))+` <span class="chip ${ts.due?'bad':ts.g<=14?'warn':''}">${ts.due?(ts.late?'in ritardo di '+(-ts.g)+' g':'da fare'):testTesto(ts.g)}</span>`:'<span class="mu">— (imposta cadenza o data)</span>'}</dd>${dd('Avviso',+it.preavviso>0?(+it.preavviso)+' giorni prima':'dalla data del test')}</dl>
    <h3>Monitoraggio test${w?'<button class="btn ghost sm" data-a="addT">+ Nuova rilevazione</button>':''}</h3>${tbl}
    <h3>Conclusioni</h3>${bl(it.conclusioni)}
    <h3>Tessera e certificato medico</h3>${tt&&(tt.numero||tt.scadenza||tt.certScad)?`<dl>${dd('ID atleta (n. tessera)',tt.numero)}${dd('Ente',tt.ente)}${dd('Scadenza tessera',isD(tt.scadenza)?fmtD(tt.scadenza):'')}${dd('Scadenza certificato medico',isD(tt.certScad)?fmtD(tt.certScad):'')}</dl><div class="mu" style="font-size:.8rem;margin-top:4px">Dati aggiornati in automatico dalla sezione Tessere.</div>`:'<div class="mu">Atleta non ancora tesserato (nessuna tessera nella sezione Tessere).</div>'}
    <h3>Salute</h3><dl>${dd('Infortuni',it.infortuni)}</dl>
    <h3>Note</h3>${bl(it.annotazioni)}<dl>${dd('Firebase',it.fb?'Salvato anche su Firebase':'Solo su Telegram')}</dl>
    <div class="dact">${w?'<button class="btn ghost" data-a="del">Elimina</button><button class="btn ghost" data-a="edit">Modifica dati</button>':''}<button class="btn" data-a="x">Chiudi</button></div>`}

/* ---------- elenco ---------- */
function renderList(){
  const ls=$('#ls');if(!ls)return;
  const t=q.trim().toLowerCase();
  const hay=i=>[nameOf(i),i.sesso,i.anno,i.grado,i.categoria,i.peso,i.allenatore,idAtleta(i),isAdm()?mailOf(i.id):'',TIPO[i.tipo],i.kumi,i.tachi,i.ne,i.richieste,i.obiettivi,i.conclusioni,i.infortuni,i.annotazioni,...(i.medaglie||[]).map(m=>m.gara),...(i.test||[]).flatMap(s=>(s.r||[]).map(r=>r.n))].filter(Boolean).join(' ').toLowerCase();
  const all=items.filter(i=>i.nome||i.cognome||i.title);
  const ok={all:()=>true,test:testDaFare,agonista:i=>i.tipo==='agonista',dilettante:i=>i.tipo==='dilettante'};
  const list=all.filter(i=>(!t||hay(i).includes(t))&&(ok[flt]||ok.all)(i))
    .sort((a,b)=>(a.cognome||nameOf(a)).localeCompare(b.cognome||nameOf(b),'it')||(a.nome||'').localeCompare(b.nome||'','it'));
  const nd=all.filter(testDaFare).length;
  ls.innerHTML=`<div class="flt"><select id="fs" aria-label="Filtro elenco"><option value="all" ${flt==='all'?'selected':''}>Tutti (${all.length})</option><option value="test" ${flt==='test'?'selected':''}>Test da fare (${nd})</option><option value="agonista" ${flt==='agonista'?'selected':''}>Agonisti (${all.filter(ok.agonista).length})</option><option value="dilettante" ${flt==='dilettante'?'selected':''}>Dilettanti (${all.filter(ok.dilettante).length})</option></select></div>`+
  (list.length?list.map(i=>{
    const sub=[i.categoria,i.peso&&i.peso+' kg',i.anno,i.allenatore&&'all. '+i.allenatore].filter(Boolean).join(' · ');
    const tt=tessOf(i.id);
    return `<button class="tr${testDaFare(i)?' alarm':''}" data-id="${esc(i.id)}" aria-label="Apri la scheda di ${esc(nameOf(i))}"><div class="inf"><div><b>${esc(nameOf(i))}</b>${i.grado?`<span class="gr">${esc(i.grado)}</span>`:''}</div><div class="mu">${esc(sub||'—')}</div></div><div class="chips">${i.tipo?`<span class="chip">${esc(TIPO[i.tipo]||i.tipo)}</span>`:''}${testChip(i)}${tt&&tt.numero?`<span class="chip ok">Tesserato · ${esc(tt.numero)}</span>`:''}</div></button>`}).join('')
  :`<div class="mu" style="padding:8px 0">${t||flt!=='all'?'Nessun risultato.':'Nessun atleta registrato.'+(perm()==='w'?' Compila il modulo qui sopra.':'')}</div>`);
  $('#fs').onchange=e=>{flt=e.target.value;renderList()};
  if(perm()==='w'){
    const fill=(id,k)=>{const dl=$('#'+id);if(dl)dl.innerHTML=[...new Set(all.map(i=>i[k]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'it')).map(v=>`<option value="${esc(v)}">`).join('')};
    fill('lg','grado');fill('lc','categoria');fill('la','allenatore')}
  paintDetail()}

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
      if(shellFor!==perm())shell();
      if(isAdm()&&!unsubs.mailSub){unsubs.mailSub=1;unsubs.push(onSnapshot(collection(db,'atletiMail'),s=>{mails={};s.docs.forEach(d=>mails[d.id]=d.data());renderList()},()=>{mails={}}))}
      if(unsubs.length<2||(unsubs.mailSub&&unsubs.length<3)){
        unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));renderList()},()=>{}));
        unsubs.push(onSnapshot(collection(db,'sections','tessere','items'),s=>{tess=s.docs.map(d=>({id:d.id,...d.data()})).filter(t=>t.kind==='tessera');renderList()},()=>{tess=[]}))}
      renderList();
    },()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}));
  });
}
