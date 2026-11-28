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
let reg=[],stag=[],regErr=false,stagOk=false;                                  /* lato admin */
let mio=null,mioState='',catalogo=[],miei=[],carrello=[],mioMsg='',per='',notaTxt='',atlList=[],catErr='',extTxt='',invErr='',azzera=[],nuovoForm=false,ultimo='',rinviato=false,meSig='',inInvio=false;
const aperti=new Set();      /* schede aperte con il + (restano aperte quando la pagina si ridisegna) */   /* lato atleta: mio={ids:[],nomi:{}} */
const perm=()=>me?(me.admin?'w':((me.perms||{}).ordini||'n')):'n';
const gest=()=>perm()==='r'||perm()==='w',scrive=()=>perm()==='w';
const ms=t=>t&&t.toMillis?t.toMillis():(typeof t==='number'?t:0);
const quando=m=>m?new Date(m).toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const STATO={inviato:['Richiesto','warn'],pagamento:['Da pagare','warn'],effettuato:['Ordinato al fornitore',''],ricevuto:['Ricevuto','ok'],evaso:['Consegnato','']};
/* i sottomenu seguono la vita di un ordine: richiesto dall'atleta → in pagamento (prezzo e bonifico) → ordinato al fornitore → ricevuto (in mio possesso) → consegnato (evaso) */
const FASI=[['cat','Catalogo'],['inviato','Ordini richiesti'],['pagamento','Ordini in pagamento'],['effettuato','Ordini effettuati'],['ricevuto','Ordini ricevuti'],['evaso','Ordini evasi']];
const FASE_L=Object.fromEntries(FASI),PREV={pagamento:'inviato',effettuato:'pagamento',ricevuto:'effettuato',evaso:'ricevuto'};
const num=v=>{const n=parseFloat(String(v==null?'':v).replace(/\s/g,'').replace('€','').replace(',','.'));return isFinite(n)?n:0};
const rTot=r=>num(r.prezzo)*(+r.qta||1),totRighe=l=>(l||[]).reduce((t,r)=>t+rTot(r),0);
/* l'atleta può accettare tutto, solo alcuni articoli o nessuno: scelta={ts,righe:[indici],importo}. Senza scelta contano tutte le righe */
const sceltaOk=o=>o.scelta&&Array.isArray(o.scelta.righe)?o.scelta.righe:null;
const righeAttive=o=>{const c=sceltaOk(o);return c?(o.righe||[]).filter((_,i)=>c.includes(i)):(o.righe||[])};
const dovuto=o=>totRighe(righeAttive(o));
const eur=n=>'€ '+(Math.round(num(n)*100)/100).toFixed(2).replace('.',',');
/* Per chi si ordina: solo gli atleti collegati all'account (stessa email inserita in Atleti), oppure un nome scritto a mano */
const chi=()=>mio?mio.ids.map(id=>({id,n:nomeDi(mio.nomi[id]||{})})):[];
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
const righeHtml=o=>{const c=sceltaOk(o);return (o.righe||[]).map((r,i)=>{
  const det=[r.misura&&'Misura '+r.misura,r.colore&&'Colore '+r.colore,r.marchio&&'Marchio '+r.marchio,r.altro&&(r.altroLabel||'Altro')+' '+r.altro].filter(Boolean).join(' · '),off=c&&!c.includes(i),
    pr=num(r.prezzo)>0?` <span class="mu">· ${esc(eur(r.prezzo))}${(+r.qta||1)>1?' × '+(+r.qta||1)+' = '+esc(eur(rTot(r))):''}</span>`:'';
  return `<div style="padding:4px 0${off?';opacity:.55':''}"><b${off?' style="text-decoration:line-through"':''}>${esc(r.qta||1)} × ${esc(r.nome)}</b>${pr}${off?' <span class="chip">non accettato</span>':''}${det?`<div class="mu">${esc(det)}</div>`:''}</div>`}).join('')};
function ordiniUniti(){
  const rids=new Set(ordiniReg().map(o=>o.id)),sm=new Map(stag.map(x=>[x.id,x]));
  /* dall'archivio (Telegram) arriva tutto; dalla copia dell'atleta (Firebase) il bonifico dichiarato. Se l'atleta ha annullato un ordine in pagamento la copia non c'è più: resta «annullato» */
  const l=ordiniReg().map(o=>{const x=sm.get(o.id);return {...o,reg:true,t:o.ts||0,stag:!!x,bonifico:x?x.bonifico:o.bonifico,scelta:x?x.scelta:o.scelta,annullato:stagOk&&!x&&o.stato==='pagamento'}});
  stag.filter(x=>!rids.has(x.id)).forEach(x=>l.push({...x,reg:false,t:ms(x.at),stag:true}));
  return l.sort((a,b)=>b.t-a.t)}
/* quanto va ordinato: somma delle righe uguali (stesso prodotto e stesse scelte) degli ordini non ancora evasi */
function riepilogo(l){
  const m=new Map();
  l.filter(o=>o.stato!=='evaso').forEach(o=>righeAttive(o).forEach(r=>{
    const k=[r.nome,r.misura,r.colore,r.marchio,r.altro].join('|');
    const x=m.get(k)||{r,qta:0,chi:[]};x.qta+=+r.qta||1;x.chi.push(nomeDi(o)+((+r.qta||1)>1?' (×'+r.qta+')':''));m.set(k,x)}));
  return [...m.values()].sort((a,b)=>String(a.r.nome).localeCompare(String(b.r.nome),'it'))}
const rigaTxt=r=>[r.nome,r.misura&&'misura '+r.misura,r.colore&&r.colore,r.marchio&&r.marchio,r.altro&&(r.altroLabel||'')+' '+r.altro].filter(Boolean).join(', ');
let payEv='';      /* modalità di pagamento dell'ASD: le scrive l'admin in Eventi → «Come pagare» */
const payTxt=()=>payEv;
function ordineHtml(o){
  const [lab,cl]=STATO[o.stato]||['',''];
  const chips=o.annullato?'<span class="chip bad">Annullato dall’atleta</span>':(dovuto(o)>0?`<span class="chip">${esc(eur(dovuto(o)))}</span>`:'')+(o.stato==='pagamento'?(o.pagato?'<span class="chip ok">Pagamento verificato</span>':o.bonifico?'<span class="chip warn">Bonifico dichiarato</span>':o.scelta?'<span class="chip">Scelta fatta · attesa bonifico</span>':'<span class="chip">Attende la scelta dell’atleta</span>'):`<span class="chip ${cl}">${lab}</span>`);
  const nC=sceltaOk(o)?sceltaOk(o).length:0,nT=(o.righe||[]).length;
  const pag=o.stato==='pagamento'&&!o.annullato?`<div class="fbox"><b>Totale proposto: ${esc(eur(totRighe(o.righe)))}</b>${o.scelta?`<div class="mu">L’atleta ha accettato ${nC} articol${nC===1?'o':'i'} su ${nT}: <b>da pagare ${esc(eur(dovuto(o)))}</b></div>`:'<div class="mu">L’atleta non ha ancora scelto cosa accettare.</div>'}${o.bonifico?`<div class="mu">Bonifico dichiarato il ${esc(quando(+o.bonifico.ts||0))}${o.bonifico.nota?' · '+esc(o.bonifico.nota):''}</div>`:''}${o.msgPag?`<div class="mu" style="white-space:pre-wrap">${esc(o.msgPag)}</div>`:''}</div>`:'';
  const B=(a,t,p)=>`<button class="btn ${p?'':'ghost '}sm" data-a="${a}" data-id="${esc(o.id)}">${t}</button>`,az=[];
  if(!o.annullato){
    if(o.stato==='inviato')az.push(B('prezzo','Imposta il prezzo e chiedi il pagamento',1));
    if(o.stato==='pagamento'){az.push(B('pagato',o.pagato?'Annulla verifica del pagamento':'✔ Pagamento ricevuto',!o.pagato&&!!o.bonifico));az.push(B('ordinato','Ordinato al fornitore',!!o.pagato));az.push(B('prezzo','Cambia prezzo o reinvia'))}
    if(o.stato==='effettuato')az.push(B('arrivato','Segna come ricevuto',1));
    if(o.stato==='ricevuto')az.push(B('consegnato','Segna come consegnato',1));
    if(PREV[o.stato])az.push(B('indietro','← '+FASE_L[PREV[o.stato]]))}
  az.push(B('elim','Elimina'));
  if(o.stato==='evaso'&&o.stag)az.push(B('togli','Togli dalla lista dell’atleta'));
  const corpo=`<div class="mu">${esc(quando(o.t))}${o.esterno?' · persona non atleta':''}</div>${righeHtml(o)}${o.nota?`<div class="fbox" style="white-space:pre-wrap"><span class="mu">Note</span><div>${esc(o.nota)}</div></div>`:''}${pag}
    ${scrive()?`<div class="dact" style="flex-wrap:wrap">${az.join('')}</div>`:''}`;
  return acc('o_'+o.id,esc(nomeDi(o)),chips,corpo)}
/* un ordine sta in due posti: archivio permanente (Telegram) e copia dell'atleta (Firebase). Ogni cambio di stato li aggiorna entrambi; l'archivio nasce al primo passaggio oltre «richiesto» */
async function cambiaStato(id,stato,extra={}){
  const x=stag.find(v=>v.id===id),a=reg.find(r=>r.id===id&&r.kind==='ordine'),patch={stato,...extra};
  if(a)await updateDoc(doc(db,'sections','ordini','items',id),patch);
  else if(x&&stato!=='inviato')await setDoc(doc(db,'sections','ordini','items',id),{kind:'ordine',atleta:x.atleta||'',esterno:!!x.esterno,nome:x.nome||'',cognome:x.cognome||'',righe:x.righe||[],nota:x.nota||'',ts:ms(x.at)||Date.now(),by:uid,title:'Ordine · '+nomeDi(x),note:(x.righe||[]).map(r=>(r.qta||1)+'× '+r.nome).join(', ').slice(0,300),...patch});
  if(x)await rupdate(rdoc(db,'ordiniInviati',id),patch)}
/* mail all'atleta (dal Gmail dell'ASD) con costo e istruzioni; se non parte, la richiesta resta comunque visibile all'atleta in «I miei ordini» */
async function mandaMail(o){
  try{
    const {mailPronta,inviaDiretta}=await import('./notifiche-motore.js');
    if(!(await mailPronta()))throw new Error('la Mail non è ancora collegata (mail-config.js)');
    const u=o.by?await rgetDoc(rdoc(db,'users',o.by)):null,to=u&&u.exists()?String(u.data().email||'').trim():'';
    if(!to)throw new Error('non trovo l’indirizzo mail dell’account che ha inviato l’ordine');
    const righe=(o.righe||[]).map(r=>'• '+(r.qta||1)+' × '+rigaTxt(r)+' — '+eur(rTot(r))).join('\n'),url=location.href.replace(/[^/]*$/,'')+'atleti.html';
    const testo=['Ciao,','','il tuo ordine ('+nomeDi(o)+') è pronto per il pagamento.','','Costo totale: '+eur(totRighe(o.righe)),'',righe,'','Puoi accettare tutto, solo alcuni articoli oppure nessuno: paghi solo ciò che accetti.',...(o.msgPag?['',o.msgPag]:[]),...(o.istruzioni?['','Come pagare:',o.istruzioni]:[]),'','Apri ProFile Manager → Atleti → «I miei ordini»: da lì scegli gli articoli, poi dichiari il bonifico effettuato oppure cancelli l’ordine.',url,'','Yanagi Academy'].join('\n');
    const r=await inviaDiretta(db,{key:'ord:'+o.id+':'+Date.now(),to,subject:'Ordine da pagare: '+eur(totRighe(o.righe)),text:testo});
    if(!r.ok)throw new Error(r.e||'invio non riuscito')
  }catch(x){console.error(x);alert('Richiesta di pagamento registrata, ma la mail non è partita: '+((x&&x.message)||x)+'. L’atleta la trova comunque in «I miei ordini».')}}
function apriPrezzo(o){
  const nuovo=o.stato==='inviato',R=o.righe||[];
  const m=modal(nuovo?'Prezzi e richiesta di pagamento':'Cambia i prezzi',`<p class="mu" style="margin:4px 0 8px">Ordine di <b>${esc(nomeDi(o))}</b>: indica il prezzo di ogni articolo (per un pezzo). L’atleta potrà accettare tutto, solo alcuni articoli o nessuno.</p>
    ${R.map((r,i)=>`<div class="fh" style="gap:8px;padding:5px 0;border-top:1px solid var(--ln);align-items:flex-start"><div style="flex:1;min-width:0"><b>${esc(r.qta||1)} × ${esc(r.nome)}</b><div class="mu">${esc([r.misura&&'Misura '+r.misura,r.colore,r.marchio,r.altro].filter(Boolean).join(' · '))}</div><div class="mu" id="ps_${i}"></div></div><div style="flex:none"><label for="pr_${i}" class="mu" style="margin:0">Prezzo (€)</label><input id="pr_${i}" type="text" inputmode="decimal" autocomplete="off" style="max-width:100px" placeholder="0,00" value="${num(r.prezzo)>0?esc(String(r.prezzo).replace('.',',')):''}"></div></div>`).join('')}
    <div class="fh" style="padding:8px 0;border-top:1px solid var(--ln)"><b>Totale</b><b id="ptotv">${esc(eur(0))}</b></div>
    <label for="pmsg">Messaggio per l’atleta (facoltativo)</label><textarea id="pmsg" maxlength="500" placeholder="es. Consegna prevista tra due settimane">${esc(o.msgPag||'')}</textarea>
    <div class="mu" style="margin-top:8px"><b>Come pagherà</b> (dati dell’ASD, da Eventi → «Come pagare»)</div>
    ${payTxt()?`<div class="fbox" style="white-space:pre-wrap">${esc(payTxt())}</div>`:'<div class="fbox"><span class="mu">Non hai ancora scritto le modalità di pagamento: aprile in Eventi → «Come pagare» (l’atleta le vedrebbe vuote).</span></div>'}
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="pmail" checked style="width:auto;min-height:auto"> Invia anche una mail all’atleta</label>`,
    nuovo?'Invia richiesta':'Salva',async(mm,er)=>{
      const pr=R.map((r,i)=>Math.round(num(mm.querySelector('#pr_'+i).value)*100)/100);
      if(pr.some(v=>!(v>0))){er.textContent='Indica il prezzo di ogni articolo (maggiore di zero).';return false}
      if(!nuovo&&(o.scelta||o.bonifico)&&!confirm('L’atleta ha già risposto: cambiando i prezzi dovrà confermare di nuovo la scelta (e il bonifico dichiarato viene tolto). Continuare?'))return false;
      const righe=R.map((r,i)=>({...r,prezzo:pr[i]})),tot=Math.round(totRighe(righe)*100)/100,msg=mm.querySelector('#pmsg').value.trim(),mail=mm.querySelector('#pmail').checked;
      await cambiaStato(o.id,'pagamento',{righe,totale:tot,msgPag:msg,istruzioni:payTxt(),inPagAt:Date.now(),pagato:false,...(nuovo?{}:{scelta:null,bonifico:null})});
      if(mail)setTimeout(()=>mandaMail({...o,righe,totale:tot,msgPag:msg,istruzioni:payTxt()}),0)});
  const rc=()=>{let t=0;R.forEach((r,i)=>{const v=num(m.querySelector('#pr_'+i).value),sub=v*(+r.qta||1);t+=sub;const e=m.querySelector('#ps_'+i);if(e)e.textContent=v>0&&(+r.qta||1)>1?'= '+eur(sub)+' ('+(+r.qta||1)+' pezzi)':''});m.querySelector('#ptotv').textContent=eur(t)};
  m.addEventListener('input',rc);rc()}
async function azioneAdmin(a,id){
  const o=ordiniUniti().find(x=>x.id===id);
  if(a==='prezzo'){if(o)apriPrezzo(o)}
  else if(a==='pagato')await cambiaStato(id,'pagamento',{pagato:!(o&&o.pagato),pagatoAt:Date.now()});
  else if(a==='ordinato'){if(o&&!o.pagato&&!confirm('Il pagamento non risulta verificato. Segnare comunque come ordinato al fornitore?'))return;await cambiaStato(id,'effettuato',{effettuatoAt:Date.now()})}
  else if(a==='arrivato')await cambiaStato(id,'ricevuto',{ricevutoAt:Date.now()});
  else if(a==='consegnato')await cambiaStato(id,'evaso',{evasoAt:Date.now()});
  else if(a==='indietro'){if(o&&PREV[o.stato])await cambiaStato(id,PREV[o.stato])}
  else if(a==='togli'){await rdelete(rdoc(db,'ordiniInviati',id));stag=stag.filter(x=>x.id!==id);renderBg()}
  else if(a==='elim'){
    if(!confirm('Eliminare questo ordine di '+(o?nomeDi(o):'')+'?'))return;
    /* un ordine può stare in due posti: archivio (Telegram) e copia inviata dall'atleta (Firebase). Si tolgono entrambi e gli errori non restano più nascosti */
    const errs=[];
    if(reg.some(r=>r.id===id&&r.kind==='ordine')){try{await deleteDoc(doc(db,'sections','ordini','items',id))}catch(x){console.error('elimina archivio ordine',x);errs.push(x)}}
    if(stag.some(x=>x.id===id)){try{await rdelete(rdoc(db,'ordiniInviati',id))}catch(x){console.error('elimina ordine inviato',x);errs.push(x)}}
    if(errs.length){
      const e=errs[0],m=e&&e.message,c=e&&e.code;
      throw new Error(m==='NOPUB'?'il Cestino non è ancora attivo: l’admin deve aprire la Home una volta.':m==='PROTETTO'?'ordine protetto, non eliminabile.':c==='permission-denied'?'permessi insufficienti (controlla che le regole Firestore siano pubblicate e che il tuo account abbia «Scrittura» su Ordini).':(m||'riprova tra poco.'))}
    reg=reg.filter(r=>!(r.id===id&&r.kind==='ordine'));stag=stag.filter(x=>x.id!==id);renderBg()}}
function catalogoHtml(){
  const P=prodotti();
  return `<div class="fh" style="margin:18px 0 6px"><h2 style="margin:0">Prodotti</h2>${scrive()?'<button class="btn sm" data-a="nuovoP">+ Nuovo prodotto</button>':''}</div>
    ${P.length?P.map(p=>acc('p_'+p.id,esc(p.nome),p.attivo===false?'<span class="chip">Non disponibile</span>':'',`${p.prezzo?`<div class="mu">${esc(p.prezzo)}</div>`:''}${p.descr?`<div class="mu">${esc(p.descr)}</div>`:''}
      ${[['Misure',p.misure],['Colori',p.colori],['Marchi',p.marchi],[altroNome(p),p.altro]].filter(x=>(x[1]||[]).length).map(([l,a])=>`<div class="mu" style="margin-top:4px"><b>${esc(l)}:</b> ${esc(a.join(', '))}</div>`).join('')}
      ${scrive()?`<div class="dact"><button class="btn ghost sm" data-a="elP" data-id="${esc(p.id)}">Elimina</button><button class="btn ghost sm" data-a="edP" data-id="${esc(p.id)}">Modifica</button></div>`:''}`)).join(''):'<div class="card"><div class="mu">Nessun prodotto. Crea il primo: gli atleti potranno sceglierlo dalle tendine.</div></div>'}`}
const SPIEGA={inviato:'Le richieste degli atleti. Quando hai il prezzo premi «Imposta il prezzo»: l’atleta riceve il costo e sceglie se fare il bonifico o cancellare l’ordine.',pagamento:'Ordini in attesa del pagamento. Quando il bonifico è arrivato premi «Pagamento ricevuto», poi «Ordinato al fornitore».',effettuato:'Ordini già fatti ai fornitori, in attesa che arrivino.',ricevuto:'Materiale arrivato e in tuo possesso, da consegnare agli atleti.',evaso:'Materiale consegnato agli atleti.'};
const VUOTO={inviato:'Nessuna richiesta. Quando un atleta invia un ordine lo trovi qui.',pagamento:'Nessun ordine in attesa di pagamento.',effettuato:'Nessun ordine effettuato verso i fornitori.',ricevuto:'Nessun ordine ricevuto in attesa di consegna.',evaso:'Nessun ordine consegnato.'};
function faseHtml(k){
  if(k==='cat')return catalogoHtml();
  const L=ordiniUniti().filter(o=>o.stato===k),nuovi=k==='inviato'?L.length:0;
  let extra='';
  if(k==='pagamento'){
    const R=riepilogo(L.filter(o=>o.pagato&&!o.annullato));
    extra=`<div class="card" style="margin-bottom:12px"><div class="fh"><b>Come pagano gli atleti</b><a class="btn ghost sm" href="eventi.html" style="text-decoration:none">Modifica in Eventi</a></div><div class="mu" style="white-space:pre-wrap">${esc(payTxt()||'Non ancora scritte: aprile in Eventi → «Come pagare».')}</div></div>`
      +(R.length?`<div class="card" style="margin-bottom:12px"><div class="fh"><b>Da ordinare ai fornitori (ordini già pagati)</b><button class="btn ghost sm" data-a="copia">Copia l’elenco</button></div>
      ${R.map(x=>`<div style="padding:5px 0;border-top:1px solid var(--ln)"><b>${x.qta} × ${esc(rigaTxt(x.r))}</b><div class="mu">${esc(x.chi.join(', '))}</div></div>`).join('')}</div>`:'')}
  return `${regErr?'<div class="card" style="margin-bottom:12px"><b>Dati non completi</b><div class="mu">Non riesco a leggere il catalogo e l’archivio ordini: sono su Telegram. Accedi dalla pagina <a href="chat.html">Chat</a> e riapri questa pagina.</div></div>':''}
    <h2 style="margin:0 0 4px">${esc(FASE_L[k])} ${nuovi?`<span class="chip warn">${nuovi} ${nuovi===1?'nuovo':'nuovi'}</span>`:''}</h2><div class="mu" style="margin-bottom:10px">${esc(SPIEGA[k])}</div>
    ${extra}${L.length?L.map(ordineHtml).join(''):`<div class="card"><div class="mu">${esc(VUOTO[k])}</div></div>`}`}

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
}
const optSel=(id,lab,arr)=>(arr||[]).length?`<label for="${id}">${esc(lab)}</label><select id="${id}"><option value="">Scegli…</option>${arr.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>`:'';
const ALTRA='__altra';
function ordinaHtml(){
  const C=catAttivo(),W=chi(),sel=per===ALTRA||W.some(c=>c.id===per)?per:((W[0]||{}).id||ALTRA);
  return `${mioMsg?`<div class="card" role="status" style="margin-bottom:12px"><b>${esc(mioMsg)}</b></div>`:''}
    ${catErr?`<div class="card" role="alert" style="margin-bottom:12px"><b>Catalogo non disponibile</b><div class="mu">${esc(catErr)}</div></div>`:''}
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
      <p class="err" role="alert" id="oer" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(invErr)}</p>
      <div class="dact"><button class="btn" data-a="invia" ${carrello.length?'':'disabled'}>Invia l’ordine</button></div></div>`}
async function azioneAtleta(a,b){
  if(a==='agg'){
    const p=catAttivo().find(x=>x.id===b.dataset.id);if(!p)return;
    const v=id=>{const e=document.getElementById(id);return e?e.value:''};
    const r={p:p.id,nome:p.nome,misura:v('m_'+p.id),colore:v('c_'+p.id),marchio:v('k_'+p.id),altroLabel:p.altroLabel||'',altro:v('a_'+p.id),qta:Math.min(99,Math.max(1,parseInt(v('q_'+p.id),10)||1))};
    const manca=[['misura','Misura',p.misure],['colore','Colore',p.colori],['marchio','Marchio',p.marchi],['altro',altroNome(p),p.altro]].find(([k,,arr])=>(arr||[]).length&&!r[k]);
    if(manca){alert('Scegli '+manca[1].toLowerCase()+' per «'+p.nome+'».');return false}
    carrello.push(r);mioMsg='';invErr='';azzera=['m_','c_','k_','a_','q_'].map(x=>x+p.id);return true}
  if(a==='togliR'){carrello.splice(+b.dataset.i,1);return true}
  if(a==='invia'){
    const errInv=m=>{invErr=m;const e=$('#oer');if(e)e.textContent=m};
    if(inInvio)return false;
    const nota=(($('#nota')||{}).value||'').trim().slice(0,1000);
    if(!carrello.length)return false;
    const sel=($('#per')||{}).value||per;let atleta,nome,cognome,esterno=false;
    if(sel===ALTRA){
      const t=(($('#pext')||{}).value||'').trim().replace(/\s+/g,' ');
      if(!t){errInv('Scrivi il nome della persona per cui ordini: non può restare vuoto.');const f=$('#pext');if(f)f.focus();return false}
      esterno=true;nome=t;cognome='';
      atleta=(mio&&mio.ids[0])||'';      /* l'ordine resta legato all'account di chi lo invia */
    }else{
      const pa=chi().find(c=>c.id===sel);
      if(!pa){errInv('Scegli per chi è l’ordine.');return false}
      const n=mio.nomi[sel]||{};
      atleta=sel;nome=n.nome||'';cognome=n.cognome||''}
    per=sel;inInvio=true;invErr='';
    const bt=document.querySelector('[data-a="invia"]');if(bt){bt.disabled=true;bt.textContent='Invio…'}
    try{
      const ordine={atleta,nome,cognome,righe:carrello.map(r=>({...r})),nota,stato:'inviato',by:uid,at:rts()};
      if(esterno)ordine.esterno=true;      /* senza il campo per gli ordini normali: funziona anche con regole meno recenti */
      await raddDoc(rcol(db,'ordiniInviati'),ordine);
      carrello=[];notaTxt='';extTxt='';nuovoForm=true;mioMsg=gest()?'Ordine inviato: lo trovi in Gestione.':'Ordine inviato: l’admin lo riceve. Lo trovi in «I miei ordini», nella tua scheda personale (Atleti).';await caricaCatalogo();return true
    }catch(x){console.error(x);errInv(((x&&x.code==='permission-denied')?'Invio non permesso da Firebase.':'Invio non riuscito. Controlla la connessione e riprova.')+'\nDiagnosi: '+[
        'errore '+((x&&(x.code||x.message))||'?'),
        'admin '+(me&&me.admin?'sì':'no'),
        'permesso Ordini '+perm(),
        'atleta collegato '+(mio?mio.ids.join(','):'nessuno'),
        'ordine per '+(esterno?'altra persona':atleta),
        'atleta nel documento '+(atleta||'(vuoto)'),
        'righe '+carrello.length].join(' · '));if(bt){bt.disabled=false;bt.textContent='Invia l’ordine'}return false}
    finally{inInvio=false}}
  if(a==='annulla'){
    if(!confirm('Annullare questo ordine?'))return false;
    await rdelete(rdoc(db,'ordiniInviati',b.dataset.id));await caricaCatalogo();return true}
  return false}

/* ---------- pagina ---------- */
const modi=()=>[...(gest()?FASI:[]),...((mio||gest())?[['o','Ordina']]:[])];
/* Quello che l'utente sta scrivendo o scegliendo (tendine, quantità, note, nome) non deve sparire se la pagina si ridisegna */
const campiForm=()=>[...app.querySelectorAll('input[id],select[id],textarea[id]')];
const salvaForm=()=>{const st={};campiForm().forEach(e=>{st[e.id]=e.type==='checkbox'?e.checked:e.value});return st};
function ripristinaForm(st,skip){
  Object.entries(st).forEach(([id,v])=>{if(skip.includes(id))return;const e=document.getElementById(id);if(!e)return;if(e.type==='checkbox')e.checked=v;else if(e.value!==v)e.value=v})}
const inForm=()=>{const a=document.activeElement;return !!(a&&app.contains(a)&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))};
/* ridisegno causato da aggiornamenti in sottofondo: mentre si scrive o si sceglie in «Ordina» si rimanda a dopo (altrimenti sparirebbe la tastiera) */
function renderBg(){if(tab==='o'&&ultimo==='o'&&inForm()){rinviato=true;return}render()}
{ /* scorrimento a destra/sinistra: sottomenu successivo/precedente (solo gesti chiaramente orizzontali, mai dentro la barra, i campi o contenuti che scorrono di lato; non da «Ordina», dove ci sono campi da compilare) */
  let tx=0,ty=0,tt=0,ok=false;
  const lato=el=>{for(let n=el;n&&n!==app;n=n.parentElement){if(n.scrollWidth>n.clientWidth+4&&/(auto|scroll)/.test(getComputedStyle(n).overflowX))return true}return false};
  app.addEventListener('touchstart',e=>{if(e.touches.length!==1){ok=false;return}const t=e.touches[0];tx=t.clientX;ty=t.clientY;tt=Date.now();ok=!e.target.closest('.dtabs,input,select,textarea,canvas')&&!lato(e.target)},{passive:true});
  app.addEventListener('touchend',e=>{
    if(!ok||!me||tab==='o')return;ok=false;
    const t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.6||Date.now()-tt>800)return;
    const ids=modi().map(x=>x[0]),n=ids.indexOf(tab)+(dx<0?1:-1);
    if(n<0||n>=ids.length)return;tab=ids[n];mioMsg='';nuovoForm=true;render();window.scrollTo(0,0)},{passive:true})}
app.addEventListener('focusout',()=>{if(rinviato)setTimeout(()=>{if(rinviato&&!inForm()){rinviato=false;render()}},350)});
function render(){
  if(!me)return;
  const M=modi();
  if(!M.length){
    if(mioState==='load'){app.innerHTML=box('Un momento…','Sto cercando i tuoi dati.');return}
    app.innerHTML=box('Nessun accesso','Non hai i permessi per questa sezione. Chiedi all’admin.');return}
  if(!M.some(x=>x[0]===tab))tab=(M.find(x=>x[0]==='inviato')||M[0])[0];
  const cnt={};if(gest())ordiniUniti().forEach(o=>{if(!o.annullato)cnt[o.stato]=(cnt[o.stato]||0)+1});
  const sv=(tab==='o'&&ultimo==='o'&&!nuovoForm)?salvaForm():null,az=azzera;azzera=[];nuovoForm=false;rinviato=false;
  app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
  <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div class="grow"><h2 style="margin:0">Ordini</h2><span class="badge">${tab==='o'?'Ordina il materiale':(scrive()?'Gestione: lettura e scrittura':'Gestione: sola lettura')}</span></div></div>
  ${M.length>1?`<div class="dtabs" role="tablist" aria-label="Sezioni degli ordini">${M.map(([k,l])=>`<button type="button" role="tab" aria-selected="${tab===k}" data-tab="${k}">${l}${gest()&&cnt[k]?` <span class="n">${cnt[k]}</span>`:''}</button>`).join('')}</div>`:''}
  ${tab==='o'?ordinaHtml():faseHtml(tab)}</div>`;
  ultimo=tab;if(sv)ripristinaForm(sv,az);
  { /* la barra si ricrea a ogni ridisegno: rimette in vista il sottomenu attivo */
    const at=app.querySelector('.dtabs [aria-selected="true"]'),bar=at&&at.parentElement;if(bar)bar.scrollLeft=Math.max(0,at.offsetLeft-(bar.clientWidth-at.offsetWidth)/2)}
  $('#out').onclick=()=>signOut(auth).then(()=>location.href='index.html');
  const sp=$('#per');if(sp)sp.onchange=e=>{per=e.target.value;render()};
  const pe=$('#pext');if(pe)pe.oninput=()=>{extTxt=pe.value};
  const nt=$('#nota');if(nt)nt.oninput=()=>{notaTxt=nt.value};
  app.onclick=async e=>{
    const t=e.target.closest('[data-tab]');if(t){tab=t.dataset.tab;mioMsg='';nuovoForm=true;render();return}
    const tg=e.target.closest('[data-a="tog"]');
    if(tg){const id=tg.dataset.id,ap=!aperti.has(id);if(ap)aperti.add(id);else aperti.delete(id);tg.setAttribute('aria-expanded',ap);tg.querySelector('.accp').textContent=ap?'−':'+';tg.nextElementSibling.hidden=!ap;return}
    const b=e.target.closest('[data-a]');if(!b||b.disabled)return;const a=b.dataset.a;
    try{
      if(tab==='o'){const ok=await azioneAtleta(a,b);if(ok)render();return}
      if(a==='nuovoP')apriProdotto(null);
      else if(a==='edP')apriProdotto(reg.find(x=>x.id===b.dataset.id&&x.kind==='prodotto'));
      else if(a==='elP')await eliminaProdotto(reg.find(x=>x.id===b.dataset.id));
      else if(a==='copia'){
        const txt=riepilogo(ordiniUniti().filter(o=>o.stato==='pagamento'&&o.pagato&&!o.annullato)).map(x=>x.qta+' x '+rigaTxt(x.r)+'  ['+x.chi.join(', ')+']').join('\n');
        try{await navigator.clipboard.writeText(txt);b.textContent='Copiato'}catch(x){prompt('Copia l’elenco:',txt)}}
      else await azioneAdmin(a,b.dataset.id)
    }catch(x){console.error(x);alert('Operazione non riuscita: '+((x&&x.message)||'controlla la connessione e che Telegram sia collegato, poi riprova.'))}};
}

if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Compila firebase-config.js con i dati del progetto.')}
else{
  auth=getAuth(initializeApp(firebaseConfig));db=getFirestore(auth.app);
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];started=false;mio=null;mioState='';reg=[];stag=[];stagOk=false;payEv='';catalogo=[];miei=[];carrello=[];atlList=[];catErr='';
    if(!u){location.href='index.html';return}
    uid=u.uid;
    unsubs.push(onSnapshot(doc(db,'users',uid),sn=>{
      me=sn.exists()?{id:uid,...sn.data()}:null;
      if(!me){app.innerHTML=box('Account non abilitato','Chiedi all’admin di abilitare il tuo account.');return}
      const sig=JSON.stringify([me.admin||false,me.perms||null]);
      if(started){if(sig!==meSig){meSig=sig;renderBg()}return}
      meSig=sig;
      started=true;
      if(gest()){
        unsubs.push(onSnapshot(collection(db,'sections','ordini','items'),s=>{reg=s.docs.map(d=>({id:d.id,...d.data()}));regErr=false;renderBg()},()=>{reg=[];regErr=true;renderBg()}));
        unsubs.push(onSnapshot(doc(db,'sections','eventi','meta','pagamenti'),sn=>{payEv=sn.exists()?(sn.data().text||''):'';renderBg()},()=>{payEv=''}));
        unsubs.push(ronSnap(rcol(db,'ordiniInviati'),s=>{stag=s.docs.map(d=>({id:d.id,...d.data()}));stagOk=true;renderBg()},()=>{stag=[];stagOk=false}));}
      /* chi è anche un atleta (stessa email inserita dall'admin in Atleti) vede anche la parte «Ordina» */
      mioState='load';render();
      caricaMio().then(async ok=>{mioState=ok?'ok':'no';if(ok){await caricaCatalogo();if(!gest())tab='o'}render()})},()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
