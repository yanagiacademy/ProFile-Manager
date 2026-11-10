/* Ordini: l'admin crea il catalogo dei prodotti (misure, colori, marchi e un attributo «altro», ognuno a tendina);
   gli atleti scelgono dalle tendine, aggiungono note e inviano l'ordine; l'admin riceve l'elenco di ciò che ogni atleta ha scelto.

   Dove stanno i dati:
   - sections/ordini (argomento Telegram «Ordini», cifrato come le altre sezioni, via fsx.js):
       kind='prodotto'  {nome, descr, prezzo, attivo, misure[], colori[], marchi[], altroLabel, altro[]}  con fb:true: la copia su Firebase serve agli atleti per leggere il catalogo
       kind='ordine'    {atleta, nome, cognome, righe[], nota, stato:'ricevuto'|'evaso', ts}  archivio permanente (solo Telegram), creato quando l'admin prende in carico l'ordine
   - ordiniInviati/<id> (Firebase, fuori da Telegram: l'atleta non ha la sessione Telegram): l'ordine appena inviato, in attesa dell'admin.
       {atleta, nome, cognome, righe[], nota, stato:'inviato'|'ricevuto'|'evaso', by, at}. L'atleta lo legge e, finché è «inviato», lo annulla. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,setDoc,updateDoc,deleteDoc,serverTimestamp} from "./fsx.js";
import {doc as rdoc,collection as rcol,getDoc as rgetDoc,getDocs as rgetDocs,query as rquery,where as rwhere,addDoc as raddDoc,updateDoc as rupdate,deleteDoc as rdelete,onSnapshot as ronSnap,serverTimestamp as rts} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";

const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
function tick(){const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,15000);

let auth,db,uid=null,me=null,unsubs=[],tab='',started=false;
let reg=[],stag=[],regErr=false;                                  /* lato admin */
let mio=null,mioState='',catalogo=[],miei=[],carrello=[],mioMsg='',per='',notaTxt='',atlList=[],catErr='',extTxt='';
const aperti=new Set();      /* schede aperte con il + (restano aperte quando la pagina si ridisegna) */   /* lato atleta: mio={ids:[],nomi:{}} */
const perm=()=>me?(me.admin?'w':((me.perms||{}).ordini||'n')):'n';
const gest=()=>perm()==='r'||perm()==='w',scrive=()=>perm()==='w';
const ms=t=>t&&t.toMillis?t.toMillis():(typeof t==='number'?t:0);
const quando=m=>m?new Date(m).toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const STATO={inviato:['Nuovo','warn'],ricevuto:['Ricevuto','ok'],evaso:['Evaso','']};
/* Per chi si ordina: l'atleta collegato alla sua email; chi gestisce gli Ordini (admin) può ordinare per qualsiasi atleta */
const chi=()=>gest()?atlList.map(a=>({id:a.id,n:nomeDi(a)})).sort((a,b)=>a.n.localeCompare(b.n,'it')):(mio?mio.ids.map(id=>({id,n:nomeDi(mio.nomi[id]||{})})):[]);
const nomeAt=id=>{const c=chi().find(x=>x.id===id);return c?c.n:(mio&&mio.nomi[id]?nomeDi(mio.nomi[id]):'')};
const catAttivo=()=>gest()?prodotti().filter(p=>p.attivo!==false):catalogo;
/* scheda a tendina: si legge solo il titolo, il + (o −) apre e chiude tutto il resto */
const acc=(id,titolo,extra,corpo)=>{const a=aperti.has(id);
  return `<div class="card" style="margin-bottom:10px"><button type="button" class="acch" data-a="tog" data-id="${esc(id)}" aria-expanded="${a}"><span class="acct">${titolo}</span>${extra||''}<span class="accp" aria-hidden="true">${a?'−':'+'}</span></button><div class="accb" ${a?'':'hidden'}>${corpo}</div></div>`};
const nomeDi=o=>((o.cognome||'')+' '+(o.nome||'')).trim()||'Atleta';

/* ---------- finestra di dialogo ---------- */
function modal(ttl,body,okLabel,onOk){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(ttl)}"><h2 style="margin:0 0 4px">${esc(ttl)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>Annulla</button><button class="btn" data-ok>${esc(okLabel)}</button></div></div>`;
  const er=o.querySelector('[data-er]'),kd=e=>{if(e.key==='Escape'){e.stopPropagation();close()}},close=()=>{o.remove();window.removeEventListener('keydown',kd,true)};
  window.addEventListener('keydown',kd,true);o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  o.querySelector('[data-ok]').onclick=async()=>{const b=o.querySelector('[data-ok]');b.disabled=true;er.textContent='';
    try{if(await onOk(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Operazione non riuscita. Controlla la connessione e riprova.'}b.disabled=false};
  document.body.append(o);return o}

/* ---------- prodotti ---------- */
const prodotti=()=>reg.filter(r=>r.kind==='prodotto').sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'it'));
const ordiniReg=()=>reg.filter(r=>r.kind==='ordine');
const lista=txt=>[...new Set(String(txt||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))].slice(0,40);
const opzioniTxt=a=>(a||[]).join('\n');
const ATTR=[['misure','Misure','es. S, M, L, XL'],['colori','Colori','es. Bianco, Blu, Nero'],['marchi','Marchi','es. Mizuno, Adidas']];
const altroNome=p=>p.altroLabel||'Altro';
function apriProdotto(p){
  const z=p||{attivo:true};
  const body=`<label for="pn">Nome del prodotto</label><input id="pn" type="text" autocomplete="off" placeholder="es. Judogi, Tuta di rappresentanza" value="${esc(z.nome||'')}">
    <label for="pd">Descrizione (facoltativa)</label><input id="pd" type="text" autocomplete="off" value="${esc(z.descr||'')}">
    <label for="pp">Prezzo (facoltativo)</label><input id="pp" type="text" autocomplete="off" placeholder="es. 45 €" value="${esc(z.prezzo||'')}">
    <p class="mu" style="margin:10px 0 0">Per ogni voce scrivi le opzioni, una per riga o separate da virgola: l’atleta le sceglie da un menu a tendina. Lascia vuoto se non serve.</p>
    ${ATTR.map(([k,l,ph])=>`<label for="p_${k}">${l}</label><textarea id="p_${k}" style="min-height:64px" placeholder="${ph}">${esc(opzioniTxt(z[k]))}</textarea>`).join('')}
    <label for="pal">Altra scelta: come si chiama? (facoltativa)</label><input id="pal" type="text" autocomplete="off" placeholder="es. Versione, Taglio, Personalizzazione" value="${esc(z.altroLabel||'')}">
    <label for="p_altro">Altra scelta: opzioni</label><textarea id="p_altro" style="min-height:64px" placeholder="es. Con stemma, Senza stemma">${esc(opzioniTxt(z.altro))}</textarea>
    <label class="mu" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pat" style="width:auto;min-height:0" ${z.attivo!==false?'checked':''}> Disponibile: gli atleti lo vedono e possono ordinarlo</label>`;
  modal(p?'Modifica il prodotto':'Nuovo prodotto',body,'Salva',async(o,er)=>{
    const g=id=>o.querySelector('#'+id).value.trim();
    const nome=g('pn');if(!nome){er.textContent='Scrivi il nome del prodotto.';return false}
    const d={kind:'prodotto',nome,descr:g('pd'),prezzo:g('pp'),attivo:o.querySelector('#pat').checked,
      misure:lista(g('p_misure')),colori:lista(g('p_colori')),marchi:lista(g('p_marchi')),altroLabel:g('pal'),altro:lista(g('p_altro')),fb:true};
    if(d.altro.length&&!d.altroLabel){er.textContent='Scrivi come si chiama l’altra scelta (es. Versione).';return false}
    if([...d.misure,...d.colori,...d.marchi,...d.altro].some(x=>x.length>40)){er.textContent='Ogni opzione può avere al massimo 40 caratteri.';return false}
    d.title=nome;d.note=[d.descr,d.prezzo,d.misure.length&&'misure: '+d.misure.join('/'),d.colori.length&&'colori: '+d.colori.join('/'),d.marchi.length&&'marchi: '+d.marchi.join('/')].filter(Boolean).join(' · ').slice(0,300);
    if(p)await updateDoc(doc(db,'sections','ordini','items',p.id),d);
    else await addDoc(collection(db,'sections','ordini','items'),{...d,by:uid,at:serverTimestamp()})})}
async function eliminaProdotto(p){
  if(!confirm('Eliminare «'+p.nome+'»? Finisce nel Cestino; gli ordini già inviati non cambiano.'))return;
  await deleteDoc(doc(db,'sections','ordini','items',p.id))}

/* ---------- ordini (lato admin) ---------- */
const righeHtml=o=>(o.righe||[]).map(r=>{
  const det=[r.misura&&'Misura '+r.misura,r.colore&&'Colore '+r.colore,r.marchio&&'Marchio '+r.marchio,r.altro&&(r.altroLabel||'Altro')+' '+r.altro].filter(Boolean).join(' · ');
  return `<div style="padding:4px 0"><b>${esc(r.qta||1)} × ${esc(r.nome)}</b>${det?`<div class="mu">${esc(det)}</div>`:''}</div>`}).join('');
function ordiniUniti(){
  const rids=new Set(ordiniReg().map(o=>o.id)),l=ordiniReg().map(o=>({...o,reg:true,t:o.ts||0,stag:stag.some(s=>s.id===o.id)}));
  stag.filter(s=>!rids.has(s.id)).forEach(s=>l.push({...s,reg:false,t:ms(s.at),stag:true}));
  return l.sort((a,b)=>b.t-a.t)}
/* quanto va ordinato: somma delle righe uguali (stesso prodotto e stesse scelte) degli ordini non ancora evasi */
function riepilogo(l){
  const m=new Map();
  l.filter(o=>o.stato!=='evaso').forEach(o=>(o.righe||[]).forEach(r=>{
    const k=[r.nome,r.misura,r.colore,r.marchio,r.altro].join('|');
    const x=m.get(k)||{r,qta:0,chi:[]};x.qta+=+r.qta||1;x.chi.push(nomeDi(o)+((+r.qta||1)>1?' (×'+r.qta+')':''));m.set(k,x)}));
  return [...m.values()].sort((a,b)=>String(a.r.nome).localeCompare(String(b.r.nome),'it'))}
const rigaTxt=r=>[r.nome,r.misura&&'misura '+r.misura,r.colore&&r.colore,r.marchio&&r.marchio,r.altro&&(r.altroLabel||'')+' '+r.altro].filter(Boolean).join(', ');
function ordineHtml(o){
  const [lab,cl]=STATO[o.stato]||['',''];
  const corpo=`<div class="mu">${esc(quando(o.t))}${o.esterno?' · persona non atleta':''}</div>${righeHtml(o)}${o.nota?`<div class="fbox" style="white-space:pre-wrap"><span class="mu">Note</span><div>${esc(o.nota)}</div></div>`:''}
    ${scrive()?`<div class="dact" style="flex-wrap:wrap">
      <button class="btn ghost sm" data-a="elim" data-id="${esc(o.id)}">Elimina</button>
      ${o.stato==='evaso'&&o.stag?`<button class="btn ghost sm" data-a="togli" data-id="${esc(o.id)}">Togli dalla lista dell’atleta</button>`:''}
      ${o.stato==='inviato'?`<button class="btn sm" data-a="ric" data-id="${esc(o.id)}">Segna come ricevuto</button>`:''}
      ${o.stato==='ricevuto'?`<button class="btn sm" data-a="eva" data-id="${esc(o.id)}">Segna come evaso</button>`:''}</div>`:''}`;
  return acc('o_'+o.id,esc(nomeDi(o)),`<span class="chip ${cl}">${lab}</span>`,corpo)}
async function azioneAdmin(a,id){
  const o=ordiniUniti().find(x=>x.id===id);
  if(a==='ric'){
    const s=stag.find(x=>x.id===id);if(!s)return;
    /* copia permanente su Telegram (cifrata), poi lo stato visibile all'atleta */
    await setDoc(doc(db,'sections','ordini','items',id),{kind:'ordine',atleta:s.atleta||'',esterno:!!s.esterno,nome:s.nome||'',cognome:s.cognome||'',righe:s.righe||[],nota:s.nota||'',stato:'ricevuto',ts:ms(s.at)||Date.now(),by:uid,
      title:'Ordine · '+nomeDi(s),note:(s.righe||[]).map(r=>(r.qta||1)+'× '+r.nome).join(', ').slice(0,300)});
    await rupdate(rdoc(db,'ordiniInviati',id),{stato:'ricevuto'})}
  else if(a==='eva'){
    await updateDoc(doc(db,'sections','ordini','items',id),{stato:'evaso'});
    if(stag.some(x=>x.id===id))await rupdate(rdoc(db,'ordiniInviati',id),{stato:'evaso'}).catch(()=>{})}
  else if(a==='togli'){await rdelete(rdoc(db,'ordiniInviati',id))}
  else if(a==='elim'){
    if(!confirm('Eliminare questo ordine di '+(o?nomeDi(o):'')+'?'))return;
    if(reg.some(r=>r.id===id&&r.kind==='ordine'))await deleteDoc(doc(db,'sections','ordini','items',id));
    if(stag.some(x=>x.id===id))await rdelete(rdoc(db,'ordiniInviati',id)).catch(()=>{})}}
function gestioneHtml(){
  const P=prodotti(),L=ordiniUniti(),R=riepilogo(L),nuovi=L.filter(o=>o.stato==='inviato').length;
  return `${regErr?'<div class="card" style="margin-bottom:12px"><b>Dati non completi</b><div class="mu">Non riesco a leggere il catalogo e l’archivio ordini: sono su Telegram. Accedi dalla pagina <a href="chat.html">Chat</a> e riapri questa pagina.</div></div>':''}
    <h2 style="margin:0 0 6px">Ordini ricevuti ${nuovi?`<span class="chip warn">${nuovi} ${nuovi===1?'nuovo':'nuovi'}</span>`:''}</h2>
    ${R.length?`<div class="card" style="margin-bottom:12px"><div class="fh"><b>Da ordinare in totale</b><button class="btn ghost sm" data-a="copia">Copia l’elenco</button></div>
      ${R.map(x=>`<div style="padding:5px 0;border-top:1px solid var(--ln)"><b>${x.qta} × ${esc(rigaTxt(x.r))}</b><div class="mu">${esc(x.chi.join(', '))}</div></div>`).join('')}</div>`:''}
    ${L.length?L.map(ordineHtml).join(''):'<div class="card"><div class="mu">Nessun ordine. Quando un atleta ne invia uno, lo trovi qui.</div></div>'}
    <div class="fh" style="margin:18px 0 6px"><h2 style="margin:0">Prodotti</h2>${scrive()?'<button class="btn sm" data-a="nuovoP">+ Nuovo prodotto</button>':''}</div>
    ${P.length?P.map(p=>acc('p_'+p.id,esc(p.nome),p.attivo===false?'<span class="chip">Non disponibile</span>':'',`${p.prezzo?`<div class="mu">${esc(p.prezzo)}</div>`:''}${p.descr?`<div class="mu">${esc(p.descr)}</div>`:''}
      ${[['Misure',p.misure],['Colori',p.colori],['Marchi',p.marchi],[altroNome(p),p.altro]].filter(x=>(x[1]||[]).length).map(([l,a])=>`<div class="mu" style="margin-top:4px"><b>${esc(l)}:</b> ${esc(a.join(', '))}</div>`).join('')}
      ${scrive()?`<div class="dact"><button class="btn ghost sm" data-a="elP" data-id="${esc(p.id)}">Elimina</button><button class="btn ghost sm" data-a="edP" data-id="${esc(p.id)}">Modifica</button></div>`:''}`)).join(''):'<div class="card"><div class="mu">Nessun prodotto. Crea il primo: gli atleti potranno sceglierlo dalle tendine.</div></div>'}`}

/* ---------- lato atleta ---------- */
async function caricaMio(){
  const e=auth.currentUser&&auth.currentUser.email;if(!e)return false;
  try{
    const k=await rgetDoc(rdoc(db,'atletiEmail',e.toLowerCase()));if(!k.exists())return false;
    const d=k.data(),ids=(d.atleti&&d.atleti.length)?d.atleti:(d.atleta?[d.atleta]:[]);if(!ids.length)return false;
    const nomi={};
    for(const id of ids){try{const s=await rgetDoc(rdoc(db,'atletiDati',id));nomi[id]=s.exists()?{nome:s.data().nome||'',cognome:s.data().cognome||''}:{nome:'',cognome:''}}catch(x){nomi[id]={nome:'',cognome:''}}}
    mio={ids,nomi};if(!per||!ids.includes(per))per=ids[0];return true
  }catch(x){console.error(x);return false}}
async function caricaMiei(){
  try{const sn=await rgetDocs(rquery(rcol(db,'ordiniInviati'),rwhere('by','==',uid)));miei=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>ms(b.at)-ms(a.at))}catch(x){miei=[]}}
async function caricaCatalogo(){
  catErr='';
  if(gest())catalogo=[];      /* chi gestisce legge il catalogo direttamente da Telegram */
  else try{
    const sn=await rgetDocs(rquery(rcol(db,'sections','ordini','items'),rwhere('kind','==','prodotto'),rwhere('attivo','==',true)));
    catalogo=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'it'));
  }catch(x){console.error(x);catalogo=[];catErr=(x&&x.code==='permission-denied')?'Non ho il permesso di leggere il catalogo: l’admin deve ripubblicare le regole Firestore (firestore.rules).':'Non riesco a leggere il catalogo. Riprova tra poco.'}
  try{
    const sn=await rgetDocs(rquery(rcol(db,'ordiniInviati'),rwhere('by','==',uid)));
    miei=sn.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>ms(b.at)-ms(a.at))
  }catch(x){console.error(x);miei=[]}}
const optSel=(id,lab,arr)=>(arr||[]).length?`<label for="${id}">${esc(lab)}</label><select id="${id}"><option value="">Scegli…</option>${arr.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>`:'';
const ALTRA='__altra';
function ordinaHtml(){
  const C=catAttivo(),W=chi(),sel=per===ALTRA||W.some(c=>c.id===per)?per:((W[0]||{}).id||ALTRA);
  return `${mioMsg?`<div class="card" role="status" style="margin-bottom:12px"><b>${esc(mioMsg)}</b></div>`:''}
    ${catErr?`<div class="card" role="alert" style="margin-bottom:12px"><b>Catalogo non disponibile</b><div class="mu">${esc(catErr)}</div></div>`:''}
    ${gest()&&!W.length?'<div class="card" style="margin-bottom:12px"><b>Elenco atleti non disponibile</b><div class="mu">Per ordinare a nome di un atleta serve l’elenco degli atleti, che è su Telegram: accedi dalla pagina <a href="chat.html">Chat</a> e riapri questa pagina. Intanto puoi ordinare per un’altra persona.</div></div>':''}
    <label for="per">Per chi è l’ordine</label><select id="per">${W.map(c=>`<option value="${esc(c.id)}" ${c.id===sel?'selected':''}>${esc(c.n||'Atleta')}</option>`).join('')}<option value="${ALTRA}" ${sel===ALTRA?'selected':''}>Un’altra persona (non atleta)…</option></select>
    ${sel===ALTRA?`<label for="pext">Nome e cognome della persona (obbligatorio)</label><input id="pext" type="text" autocomplete="off" required aria-required="true" value="${esc(extTxt)}" placeholder="es. Mario Rossi">`:''}
    <h2 style="margin:12px 0 6px">Prodotti</h2>
    ${C.length?C.map(p=>acc('a_'+p.id,esc(p.nome),p.prezzo?`<span class="mu">${esc(p.prezzo)}</span>`:'',`${p.descr?`<div class="mu">${esc(p.descr)}</div>`:''}
      ${optSel('m_'+p.id,'Misura',p.misure)}${optSel('c_'+p.id,'Colore',p.colori)}${optSel('k_'+p.id,'Marchio',p.marchi)}${optSel('a_'+p.id,altroNome(p),p.altro)}
      <label for="q_${esc(p.id)}">Quantità</label><input id="q_${esc(p.id)}" type="number" min="1" max="99" value="1" inputmode="numeric" style="max-width:110px">
      <div class="dact"><button class="btn sm" data-a="agg" data-id="${esc(p.id)}">Aggiungi all’ordine</button></div>`)).join(''):'<div class="card"><div class="mu">Al momento non ci sono prodotti da ordinare.</div></div>'}
    <h2 style="margin:18px 0 6px">Il mio ordine</h2>
    <div class="card">${carrello.length?carrello.map((r,i)=>`<div class="fh" style="padding:4px 0"><div><b>${esc(r.qta)} × ${esc(r.nome)}</b><div class="mu">${esc([r.misura&&'Misura '+r.misura,r.colore&&'Colore '+r.colore,r.marchio&&'Marchio '+r.marchio,r.altro&&r.altroLabel+' '+r.altro].filter(Boolean).join(' · '))}</div></div><button class="btn ghost sm" data-a="togliR" data-i="${i}" aria-label="Togli ${esc(r.nome)} dall’ordine">Togli</button></div>`).join(''):'<div class="mu">Non hai ancora scelto niente.</div>'}
      <label for="nota">Note per l’ordine (facoltative)</label><textarea id="nota" maxlength="1000" placeholder="Altri dettagli utili per l’ordine">${esc(notaTxt)}</textarea>
      <p class="err" role="alert" id="oer"></p>
      <div class="dact"><button class="btn" data-a="invia" ${carrello.length?'':'disabled'}>Invia l’ordine</button></div></div>
    <h2 style="margin:18px 0 6px">I miei ordini</h2>
    ${miei.length?miei.map(o=>{const [lab,cl]=STATO[o.stato]||['',''];return acc('m_'+o.id,esc(nomeDi(o)),`<span class="chip ${cl}">${lab}</span>`,`<div class="mu">${esc(quando(ms(o.at)))}${o.esterno?' · persona non atleta':''}</div>${righeHtml(o)}${o.nota?`<div class="mu" style="white-space:pre-wrap">Note: ${esc(o.nota)}</div>`:''}${o.stato==='inviato'?`<div class="dact"><button class="btn ghost sm" data-a="annulla" data-id="${esc(o.id)}">Annulla l’ordine</button></div>`:''}`)}).join(''):'<div class="card"><div class="mu">Non hai ancora inviato ordini.</div></div>'}`}
async function azioneAtleta(a,b){
  if(a==='agg'){
    const p=catAttivo().find(x=>x.id===b.dataset.id);if(!p)return;
    const v=id=>{const e=document.getElementById(id);return e?e.value:''};
    const r={p:p.id,nome:p.nome,misura:v('m_'+p.id),colore:v('c_'+p.id),marchio:v('k_'+p.id),altroLabel:p.altroLabel||'',altro:v('a_'+p.id),qta:Math.min(99,Math.max(1,parseInt(v('q_'+p.id),10)||1))};
    const manca=[['misura','Misura',p.misure],['colore','Colore',p.colori],['marchio','Marchio',p.marchi],['altro',altroNome(p),p.altro]].find(([k,,arr])=>(arr||[]).length&&!r[k]);
    if(manca){alert('Scegli '+manca[1].toLowerCase()+' per «'+p.nome+'».');return false}
    carrello.push(r);mioMsg='';return true}
  if(a==='togliR'){carrello.splice(+b.dataset.i,1);return true}
  if(a==='invia'){
    const er=$('#oer'),nota=($('#nota').value||'').trim().slice(0,1000);
    if(!carrello.length)return false;
    const sel=($('#per')||{}).value||per;let atleta,nome,cognome,esterno=false;
    if(sel===ALTRA){
      const t=(($('#pext')||{}).value||'').trim().replace(/\s+/g,' ');
      if(!t){if(er)er.textContent='Scrivi il nome della persona per cui ordini: non può restare vuoto.';const f=$('#pext');if(f)f.focus();return false}
      esterno=true;nome=t;cognome='';
      atleta=gest()?'':((mio&&mio.ids[0])||'');      /* l'ordine resta legato all'account di chi lo invia */
    }else{
      const pa=chi().find(c=>c.id===sel);
      if(!pa){if(er)er.textContent='Scegli per chi è l’ordine.';return false}
      const n=gest()?(atlList.find(a=>a.id===sel)||{}):(mio.nomi[sel]||{});
      atleta=sel;nome=n.nome||'';cognome=n.cognome||''}
    per=sel;
    try{
      await raddDoc(rcol(db,'ordiniInviati'),{atleta,esterno,nome,cognome,righe:carrello.map(r=>({...r})),nota,stato:'inviato',by:uid,at:rts()});
      carrello=[];notaTxt='';extTxt='';mioMsg='Ordine inviato: l’admin lo riceve e lo trovi qui sotto.';await caricaCatalogo();return true
    }catch(x){console.error(x);if(er)er.textContent=(x&&x.code==='permission-denied')?'Invio non permesso: l’admin deve ripubblicare le regole Firestore (firestore.rules).':'Invio non riuscito. Controlla la connessione e riprova.';return false}}
  if(a==='annulla'){
    if(!confirm('Annullare questo ordine?'))return false;
    await rdelete(rdoc(db,'ordiniInviati',b.dataset.id));await caricaCatalogo();return true}
  return false}

/* ---------- pagina ---------- */
const modi=()=>[...(gest()?[['g','Gestione']]:[]),...((mio||gest())?[['o','Ordina']]:[])];
function render(){
  if(!me)return;
  const M=modi();
  if(!M.length){
    if(mioState==='load'){app.innerHTML=box('Un momento…','Sto cercando i tuoi dati.');return}
    app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');return}
  if(!M.some(x=>x[0]===tab))tab=M[0][0];
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Ordini</h2><span class="badge">${tab==='g'?(scrive()?'Gestione: lettura e scrittura':'Gestione: sola lettura'):'Ordina il materiale'}</span></div></div>
  ${M.length>1?`<div class="flt" role="tablist">${M.map(([k,l])=>`<button class="btn ${tab===k?'':'ghost'} sm" role="tab" aria-selected="${tab===k}" data-tab="${k}">${l}</button>`).join('')}</div>`:''}
  ${tab==='g'?gestioneHtml():ordinaHtml()}</div>`;
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  const sp=$('#per');if(sp)sp.onchange=e=>{per=e.target.value;render()};
  const pe=$('#pext');if(pe)pe.oninput=()=>{extTxt=pe.value};
  const nt=$('#nota');if(nt)nt.oninput=()=>{notaTxt=nt.value};
  app.onclick=async e=>{
    const t=e.target.closest('[data-tab]');if(t){tab=t.dataset.tab;mioMsg='';render();return}
    const tg=e.target.closest('[data-a="tog"]');
    if(tg){const id=tg.dataset.id,ap=!aperti.has(id);if(ap)aperti.add(id);else aperti.delete(id);tg.setAttribute('aria-expanded',ap);tg.querySelector('.accp').textContent=ap?'−':'+';tg.nextElementSibling.hidden=!ap;return}
    const b=e.target.closest('[data-a]');if(!b||b.disabled)return;const a=b.dataset.a;
    try{
      if(tab==='o'){const ok=await azioneAtleta(a,b);if(ok)render();return}
      if(a==='nuovoP')apriProdotto(null);
      else if(a==='edP')apriProdotto(reg.find(x=>x.id===b.dataset.id&&x.kind==='prodotto'));
      else if(a==='elP')await eliminaProdotto(reg.find(x=>x.id===b.dataset.id));
      else if(a==='copia'){
        const txt=riepilogo(ordiniUniti()).map(x=>x.qta+' x '+rigaTxt(x.r)+'  ['+x.chi.join(', ')+']').join('\n');
        try{await navigator.clipboard.writeText(txt);b.textContent='Copiato'}catch(x){prompt('Copia l’elenco:',txt)}}
      else await azioneAdmin(a,b.dataset.id)
    }catch(x){console.error(x);alert('Operazione non riuscita: '+((x&&x.message)||'controlla la connessione e che Telegram sia collegato, poi riprova.'))}};
}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;mio=null;mioState='';reg=[];stag=[];catalogo=[];miei=[];carrello=[];atlList=[];catErr='';
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me){app.innerHTML=box('Account non abilitato','Chiedi all’admin di abilitare il tuo account.');return}
      if(started){render();return}
      started=true;
      if(gest()){
        unsubs.push(onSnapshot(collection(db,'sections','ordini','items'),s=>{reg=s.docs.map(d=>({id:d.id,...d.data()}));regErr=false;render()},()=>{reg=[];regErr=true;render()}));
        unsubs.push(ronSnap(rcol(db,'ordiniInviati'),s=>{stag=s.docs.map(d=>({id:d.id,...d.data()}));render()},()=>{stag=[]}));
        unsubs.push(onSnapshot(collection(db,'sections','atleti','items'),s=>{atlList=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.nome||a.cognome);if(!per||!atlList.some(a=>a.id===per))per=(atlList[0]||{}).id||'';render()},()=>{atlList=[]}));
        caricaMiei()}
      /* chi è anche un atleta (stessa email inserita dall'admin in Atleti) vede anche la parte «Ordina» */
      mioState='load';render();
      caricaMio().then(async ok=>{mioState=ok?'ok':'no';if(ok){await caricaCatalogo();if(!gest())tab='o'}render()})},()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
