/* Richieste di atleti e tecnici: caricano da soli file (tessera, certificato medico, tesserino) e proposte di modifica dei loro dati.
   Niente viene applicato da solo: l'admin vede tutto in anteprima (pagina Richieste) e accetta o rifiuta ogni file e ogni singolo campo.

   Dove stanno i dati (raccolte Firestore a parte, fuori da Telegram, come atletiModifiche):
     atletiModifiche/<idPersona>   {campi:{campo:nuovoValore}, at, by}   proposte sui dati personali (atleti e tecnici)
     atletiDati/<idPersona>        copia dei dati personali che la persona può vedere (la scrive l'admin)
     richieste/<id>                {soggetto, ruolo:'atleta'|'tecnico', tipo:'tessera'|'certificato'|'tesserino', tes, campi:{…}, file:{nome,size,mime,chunks}, by, at, completa}
     richieste/<id>/chunks/c<n>    contenuto del file a blocchi (max 10 MB); compare all'admin solo con completa=true
     tecniciTes/<idTecnico>        copia dei tesserini del tecnico (la scrive l'admin): serve al tecnico per leggere i propri */
import {doc,collection,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,serverTimestamp,Bytes,query,where} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {isD,fmtD} from "./atleti-scadenze.js";
import {guessMime} from "./file-tools.js";
import {GRADI_LAB} from "./gradi.js";
import {ALBI,livelloEtichetta,livelloEsempio,tesName,rigaBreve,tesserini} from "./tesserini.js";

export const MAX_FILE=10*1024*1024,CH=900000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- campi che la persona può proporre di cambiare: [chiave, etichetta, tipo] ----------
   tipi: t testo · n numero · d decimale · a testo lungo · s sesso · p agonista/dilettante · D data · c codice fiscale */
export const ATL_EDIT=[['nome','Nome','t'],['cognome','Cognome','t'],['sesso','Sesso','s'],['anno','Anno di nascita','n'],['peso','Peso (kg)','d'],['altezza','Altezza (cm)','n'],['grado','Grado',GRADI_LAB],['categoria','Categoria','t'],['allenatore','Allenatore','t'],['tipo','Agonista o dilettante','p'],['kumi','Kumi kata','t'],['tachi','Tachi waza (una per riga)','a'],['ne','Ne waza (una per riga)','a'],['richieste','Richieste','a'],['obiettivi','Obiettivi','a'],['infortuni','Infortuni','a']];
export const TEC_EDIT=[['nome','Nome','t'],['cognome','Cognome','t'],['nascita','Data di nascita','D'],['cf','Codice fiscale','c'],['info','Informazioni','a']];
export const TIPO_LAB={agonista:'Agonista',dilettante:'Dilettante'};
export const TIPO_RICH={tessera:'Tessera',certificato:'Certificato medico',tesserino:'Tesserino',medaglia:'Medaglia o risultato',test:'Rilevazione test'};
export const POSTO={'1':'🥇 1° posto','2':'🥈 2° posto','3':'🥉 3° posto','5':'5° posto','P':'Partecipazione'};
export const DEF_TEST=['CMJ','1RM p.piana+squat','Sprint 30m','Illinois Agility test','Test di Cooper','SJFT','Beep test','Peso'];
const FIELD_TESSERA=[['ente','Ente / federazione','t'],['numero','Numero tessera','t'],['tipoTessera','Tipo di tessera','t'],['stagione','Stagione','t'],['emissione','Data emissione','D'],['scadenza','Scadenza tessera','D'],['associazione','Associazione','t']];
const FIELD_CERT=[['certTipo','Tipo di certificato',['agonistico','non agonistico']],['certScad','Scadenza certificato','D']];
const FIELD_TESSERINO=[['ente','Ente / federazione','t'],['numero','Numero tesserino','t'],['emissione','Data emissione (facoltativa)','D'],['scadenza','Scadenza (facoltativa)','D'],['nota','Note','a']];
/* etichette di tutti i campi, per mostrarli all'admin */
export const ETICHETTE=Object.fromEntries([...ATL_EDIT,...TEC_EDIT,...FIELD_TESSERA,...FIELD_CERT,...FIELD_TESSERINO,['data','Data'],['gara','Gara'],['posto','Risultato'],['albo','Tipo di tesserino'],['altraNome','Nome della qualifica'],['righe','Sport, settore e livello']].map(([k,l])=>[k,l]));

/* testo di un valore per il confronto prima/dopo */
export function valTxt(k,v){
  if(k==='righe')return Array.isArray(v)&&v.length?v.map(rigaBreve).join(', '):'';
  if(v==null||v==='')return '';
  if(['emissione','scadenza','certScad','nascita'].includes(k))return isD(v)?fmtD(v):String(v);
  if(k==='tipo')return TIPO_LAB[v]||String(v);
  if(k==='albo')return ALBI[v]||String(v);
  if(k==='peso')return v+' kg';
  if(k==='altezza')return v+' cm';
  return String(v)}
export const uguali=(k,a,b)=>k==='righe'?JSON.stringify(a||[])===JSON.stringify(b||[]):String(a??'').trim()===String(b??'').trim();

/* ---------- finestra di dialogo ---------- */
function modal(ttl,body,okLabel,onOk){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(ttl)}"><h2 style="margin:0 0 4px">${esc(ttl)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>Annulla</button><button class="btn" data-ok>${esc(okLabel)}</button></div></div>`;
  const er=o.querySelector('[data-er]'),kd=e=>{if(e.key==='Escape'){e.stopPropagation();close()}},close=()=>{o.remove();window.removeEventListener('keydown',kd,true)};
  window.addEventListener('keydown',kd,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  o.querySelector('[data-x]').onclick=close;
  o.querySelector('[data-ok]').onclick=async()=>{
    const b=o.querySelector('[data-ok]');b.disabled=true;er.textContent='';
    try{if(await onOk(o,er)!==false)close()}catch(x){console.error(x);er.textContent='Invio non riuscito. Controlla la connessione e riprova.'}
    b.disabled=false};
  document.body.append(o);return o}

/* un campo di modulo */
function campoHtml(id,[k,l,t],v){
  v=String(v??'');
  if(t==='a')return `<label for="${id}${k}">${esc(l)}</label><textarea id="${id}${k}" style="min-height:80px">${esc(v)}</textarea>`;
  if(t==='D')return `<label for="${id}${k}">${esc(l)}</label><input id="${id}${k}" type="date" value="${esc(v)}">`;
  if(t==='s')return `<label for="${id}${k}">${esc(l)}</label><select id="${id}${k}"><option value=""></option>${['M','F'].map(x=>`<option value="${x}" ${v===x?'selected':''}>${x}</option>`).join('')}</select>`;
  if(t==='p')return `<label for="${id}${k}">${esc(l)}</label><select id="${id}${k}"><option value=""></option>${Object.entries(TIPO_LAB).map(([x,n])=>`<option value="${x}" ${v===x?'selected':''}>${n}</option>`).join('')}</select>`;
  if(Array.isArray(t))return `<label for="${id}${k}">${esc(l)}</label><select id="${id}${k}"><option value=""></option>${(v&&!t.includes(v)?[v,...t]:t).map(x=>`<option value="${x}" ${v===x?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select>`;
  return `<label for="${id}${k}">${esc(l)}</label><input id="${id}${k}" type="text" inputmode="${t==='d'?'decimal':t==='n'?'numeric':'text'}" autocomplete="off" ${t==='c'?'maxlength="16" autocapitalize="characters" ':''}value="${esc(v)}">`}

/* ---------- modifica dei propri dati: si inviano solo i campi cambiati ---------- */
export function apriDati({db,uid,soggetto,defs,base={},mod={},after=()=>{}}){
  const cur=k=>String((k in mod?mod[k]:base[k])??'');
  const body=`<p class="mu" style="margin:6px 0 0">Le modifiche vengono inviate all’admin, che le controlla e accetta o rifiuta ogni campo.</p>${defs.map(d=>campoHtml('md_',d,cur(d[0]))).join('')}`;
  modal('Modifica i miei dati',body,'Invia all’admin',async(o,er)=>{
    const nx={};defs.forEach(([k])=>nx[k]=o.querySelector('#md_'+k).value.trim());
    if('peso' in nx)nx.peso=nx.peso.replace(',','.');
    if('cf' in nx)nx.cf=nx.cf.toUpperCase().replace(/\s+/g,'');
    const yr=new Date().getFullYear();
    if('nome' in nx&&(!nx.nome||!nx.cognome)){er.textContent='Nome e cognome sono obbligatori.';return false}
    if(nx.anno&&!(/^\d{4}$/.test(nx.anno)&&+nx.anno>=1900&&+nx.anno<=yr)){er.textContent='L’anno di nascita non è valido (4 cifre).';return false}
    if(nx.peso&&!/^\d{1,3}(\.\d{1,2})?$/.test(nx.peso)){er.textContent='Il peso non è valido (es. 72.5).';return false}
    if(nx.altezza&&!/^\d{2,3}$/.test(nx.altezza)){er.textContent='L’altezza non è valida (in cm, es. 175).';return false}
    if(nx.nascita&&!isD(nx.nascita)){er.textContent='La data di nascita non è valida.';return false}
    if(nx.cf&&!/^[A-Z0-9]{16}$/.test(nx.cf)){er.textContent='Il codice fiscale deve avere 16 caratteri (lettere e cifre).';return false}
    const campi={};defs.forEach(([k])=>{if(nx[k]!==String(base[k]??'').trim())campi[k]=nx[k]});
    er.textContent='Invio…';
    if(Object.keys(campi).length)await setDoc(doc(db,'atletiModifiche',soggetto),{campi,at:serverTimestamp(),by:uid});
    else if(Object.keys(mod).length)await deleteDoc(doc(db,'atletiModifiche',soggetto));
    after(campi)})}

/* ---------- invio di un file (con i dati che lo accompagnano) ---------- */
export async function eliminaRichiesta(db,id,chunks=0){
  for(let k=0;k<chunks;k++)await deleteDoc(doc(db,'richieste',id,'chunks','c'+k)).catch(()=>{});
  await deleteDoc(doc(db,'richieste',id))}
export async function inviaRichiesta(db,uid,{soggetto,ruolo,tipo,tes='',campi={},file=null},say=()=>{}){
  const n=file?Math.max(1,Math.ceil(file.size/CH)):0;
  const base={soggetto,ruolo,tipo,tes,campi,by:uid,at:serverTimestamp(),completa:false};
  if(file)base.file={nome:file.name,size:file.size,mime:file.type||'',chunks:n};
  const ref=await addDoc(collection(db,'richieste'),base);
  try{
    for(let k=0;k<n;k++){
      const buf=new Uint8Array(await file.slice(k*CH,(k+1)*CH).arrayBuffer());
      await setDoc(doc(db,'richieste',ref.id,'chunks','c'+k),{i:k,data:Bytes.fromUint8Array(buf)});say(Math.round((k+1)/n*100))}
    await updateDoc(ref,{completa:true})
  }catch(e){await eliminaRichiesta(db,ref.id,n).catch(()=>{});throw e}
  return ref.id}
export async function blobRichiesta(db,r){
  const sn=await getDocs(collection(db,'richieste',r.id,'chunks'));
  const parts=sn.docs.map(d=>({i:d.data().i,b:d.data().data.toUint8Array()})).sort((a,b)=>a.i-b.i).map(x=>x.b);
  if(!parts.length)throw new Error('EMPTY');
  const f=r.file||{};return new Blob(parts,{type:guessMime(f.nome,f.mime)})}
/* le richieste inviate da questo account e ancora in attesa */
export async function mieRichieste(db,uid){
  const sn=await getDocs(query(collection(db,'richieste'),where('by','==',uid)));
  const l=[];
  for(const d of sn.docs){const r={id:d.id,...d.data()};
    if(r.completa)l.push(r);
    else if(r.at&&r.at.toMillis&&Date.now()-r.at.toMillis()>36e5)eliminaRichiesta(db,r.id,(r.file||{}).chunks||0).catch(()=>{})}
  return l.sort((a,b)=>((a.at&&a.at.toMillis&&a.at.toMillis())||0)-((b.at&&b.at.toMillis&&b.at.toMillis())||0))}
export const annullaRichiesta=(db,r)=>eliminaRichiesta(db,r.id,(r.file||{}).chunks||0);
/* elenco delle richieste in attesa di una persona; pulsante Annulla (data-a="rAnn") gestito dalla pagina */
export function richiesteHtml(list,soggetto){
  const l=list.filter(r=>r.soggetto===soggetto);
  if(!l.length)return '';
  return `<div style="margin-top:10px"><b style="font-size:.9rem">In attesa di conferma dell’admin</b>${l.map(r=>{
    const nc=Object.keys(r.campi||{}).length,p=[r.file?'file «'+esc(r.file.nome)+'»':'',nc?nc+(nc===1?' campo':' campi'):''].filter(Boolean).join(' e ');
    return `<div class="fr"><span class="mu">${esc(TIPO_RICH[r.tipo]||'')}: ${p||'—'}</span><button class="btn ghost sm" data-a="rAnn" data-id="${esc(r.id)}">Annulla</button></div>`}).join('')}</div>`}

/* ---------- finestra per caricare tessera, certificato o tesserino ----------
   attuale = dati attuali (tessera/certificato: la scheda tessera; tesserino: il tesserino che si modifica, oppure null per uno nuovo) */
export function apriCarica({db,uid,soggetto,ruolo,tipo,attuale=null,after=()=>{}}){
  const cur=attuale||{},defs=tipo==='tessera'?FIELD_TESSERA:tipo==='certificato'?FIELD_CERT:FIELD_TESSERINO;
  const nuovoTes=tipo==='tesserino'&&!cur.id;
  const tit={tessera:'Carica la tessera',certificato:'Carica il certificato medico',tesserino:nuovoTes?'Nuovo tesserino o qualifica':'Modifica il tesserino'}[tipo];
  const righe0=Array.isArray(cur.righe)&&cur.righe.length?cur.righe:[{}];
  const body=`<p class="mu" style="margin:6px 0 0">Il file e i dati vengono inviati all’admin, che li controlla in anteprima e accetta o rifiuta ogni file e ogni campo. Finché non li accetta, restano come sono.</p>
    <fieldset><legend>${tipo==='tesserino'?'Tesserino':tipo==='tessera'?'Tessera':'Certificato medico'}</legend>
      <label for="rf">Copia (foto o PDF, max 10 MB)</label><input id="rf" type="file" accept="image/*,application/pdf">
      ${tipo==='tesserino'?`<label for="rb">Tipo</label><select id="rb"><option value="cinture">Albo cinture nere</option><option value="qualifiche">Albo qualifiche</option><option value="altra">Altra qualifica (es. Mental Coach)</option></select>
        <div id="ralw" hidden><label for="ran">Nome della qualifica</label><input id="ran" type="text" autocomplete="off" placeholder="es. Mental Coach, Insegnante ADHD e asperger" value="${esc(cur.altraNome||'')}"></div>`:''}
      ${defs.map(d=>campoHtml('rc_',d,cur[d[0]])).join('')}
    </fieldset>
    ${tipo==='tesserino'?`<fieldset><legend>Sport, settore e livello</legend><div class="mu" style="margin-top:6px">Un tesserino con più sport: una riga per ognuno. Tesserini diversi (es. Judo e Jiu Jutsu): invia un tesserino per volta.</div><div id="rrg"></div><button type="button" class="btn ghost sm" id="rra" style="margin-top:8px">+ Aggiungi sport</button></fieldset>`:''}`;
  const o=modal(tit,body,'Invia all’admin',async(o,er)=>{
    const g=id=>(o.querySelector('#'+id)||{value:''}).value.trim();
    const campi={};
    defs.forEach(([k])=>{let v=g('rc_'+k);if(k==='numero')v=v.toUpperCase();if(v!==String(cur[k]??'').trim())campi[k]=v});
    for(const [k,l] of [['emissione','La data di emissione'],['scadenza','La scadenza'],['certScad','La scadenza del certificato']])if(campi[k]&&!isD(campi[k])){er.textContent=l+' non è valida.';return false}
    if(tipo==='tesserino'){
      const albo=g('rb'),altraNome=g('ran');
      const righe=[...o.querySelectorAll('[data-r]')].map(e=>{const f=k=>e.querySelector('[data-f="'+k+'"]').value.trim();return {sport:f('sport'),settore:f('settore'),livello:f('livello')}}).filter(x=>x.sport||x.settore||x.livello);
      if(albo==='altra'&&!altraNome){er.textContent='Scrivi il nome della qualifica.';return false}
      if(albo!=='altra'&&(!righe.length||righe.some(x=>!x.sport||!x.livello))){er.textContent='Per ogni riga indica lo sport e '+(albo==='cinture'?'il grado (es. 4° Dan)':'la qualifica (es. Istruttore)')+'.';return false}
      if(nuovoTes||albo!==(cur.albo||''))campi.albo=albo;
      if(albo==='altra'&&(nuovoTes||altraNome!==(cur.altraNome||'')))campi.altraNome=altraNome;
      if(nuovoTes||!uguali('righe',righe,cur.righe))campi.righe=righe}
    const f=o.querySelector('#rf').files[0];
    if(f&&f.size>MAX_FILE){er.textContent='“'+f.name+'” supera il limite di 10 MB.';return false}
    if(f&&!/^image\//.test(f.type)&&f.type!=='application/pdf'&&!/\.(pdf|jpe?g|png|webp|heic)$/i.test(f.name)){er.textContent='Carica una foto o un PDF.';return false}
    if(!f&&!Object.keys(campi).length){er.textContent='Non hai cambiato niente: scegli un file o modifica almeno un campo.';return false}
    er.textContent='Invio…';
    await inviaRichiesta(db,uid,{soggetto,ruolo,tipo,tes:cur.id||'',campi,file:f||null},p=>{er.textContent='Invio del file '+p+'%'});
    after()});
  if(tipo==='tesserino'){
    const tb=o.querySelector('#rb'),rg=o.querySelector('#rrg');tb.value=cur.albo||'cinture';
    const sports=['Judo','Jiu Jutsu','Lotta','Karate'];
    const lv=()=>{o.querySelector('#ralw').hidden=tb.value!=='altra';
      rg.querySelectorAll('[data-lv]').forEach(e=>e.textContent=livelloEtichetta(tb.value));
      rg.querySelectorAll('[data-f="livello"]').forEach(e=>{e.placeholder=livelloEsempio(tb.value);e.setAttribute('aria-label',livelloEtichetta(tb.value))})};
    const add=x=>{
      const d=document.createElement('div');d.setAttribute('data-r','');d.style.cssText='border:1px solid var(--ln);border-radius:10px;padding:8px 10px;margin-top:8px';
      d.innerHTML=`<div class="two"><div><label>Sport</label><input type="text" data-f="sport" list="rsl" autocomplete="off" aria-label="Sport" value="${esc(x.sport||'')}"></div><div><label>Settore (facoltativo)</label><input type="text" data-f="settore" autocomplete="off" aria-label="Settore" value="${esc(x.settore||'')}"></div></div>
        <label data-lv></label><input type="text" data-f="livello" autocomplete="off" value="${esc(x.livello||'')}">
        <button type="button" class="btn ghost sm" data-rm style="margin-top:6px">Togli questo sport</button>`;
      d.querySelector('[data-rm]').onclick=()=>{if(rg.children.length>1)d.remove();else d.querySelectorAll('input').forEach(i=>i.value='')};
      rg.append(d);lv()};
    const dl=document.createElement('datalist');dl.id='rsl';dl.innerHTML=sports.map(v=>`<option value="${v}">`).join('');rg.after(dl);
    righe0.forEach(add);tb.onchange=lv;lv();o.querySelector('#rra').onclick=()=>add({})}}

/* ---------- l'atleta aggiunge una medaglia/risultato o una rilevazione di test: una voce intera, che l'admin accetta o rifiuta ---------- */
const oggi=()=>{const n=new Date(),p=x=>String(x).padStart(2,'0');return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate())};
export function apriMedaglia({db,uid,soggetto,after=()=>{}}){
  const body=`<p class="mu" style="margin:6px 0 0">La voce viene inviata all’admin, che la controlla e la aggiunge al medagliere.</p>
    <label for="mmd">Data</label><input id="mmd" type="date" value="${oggi()}">
    <label for="mmg">Gara</label><input id="mmg" type="text" autocomplete="off">
    <label for="mmp">Risultato</label><select id="mmp">${Object.entries(POSTO).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select>`;
  modal('Nuova medaglia o risultato',body,'Invia all’admin',async(o,er)=>{
    const data=o.querySelector('#mmd').value,gara=o.querySelector('#mmg').value.trim(),posto=o.querySelector('#mmp').value;
    if(!gara){er.textContent='Indica il nome della gara.';return false}
    if(data&&!isD(data)){er.textContent='La data non è valida.';return false}
    er.textContent='Invio…';
    await inviaRichiesta(db,uid,{soggetto,ruolo:'atleta',tipo:'medaglia',campi:{data,gara,posto}});after()})}
export function apriTest({db,uid,soggetto,nomi=[],after=()=>{}}){
  const lista=[...new Set([...nomi,...DEF_TEST])];let rows=[{n:'',v:''},{n:'',v:''}];
  const body=`<p class="mu" style="margin:6px 0 0">La rilevazione viene inviata all’admin, che la controlla e la aggiunge ai test.</p>
    <label for="mtd">Data del test</label><input id="mtd" type="date" value="${oggi()}">
    <label>Test e risultati</label><div id="mtr"></div><button class="btn ghost sm" id="mta" type="button">+ Aggiungi test</button>
    <datalist id="mtl">${lista.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
  const o=modal('Nuova rilevazione di test',body,'Invia all’admin',async(o,er)=>{
    const data=o.querySelector('#mtd').value;
    if(!isD(data)){er.textContent='Indica la data del test.';return false}
    const righe=rows.map(x=>({n:x.n.trim(),v:x.v.trim()})).filter(x=>x.n&&x.v);
    if(!righe.length){er.textContent='Inserisci almeno un test con il risultato.';return false}
    er.textContent='Invio…';
    await inviaRichiesta(db,uid,{soggetto,ruolo:'atleta',tipo:'test',campi:{data,righe}});after()});
  const draw=()=>{o.querySelector('#mtr').innerHTML=rows.map((x,i)=>`<div class="rw"><input type="text" list="mtl" data-n="${i}" placeholder="Test" value="${esc(x.n)}" aria-label="Nome del test"><input type="text" data-v="${i}" placeholder="Risultato" value="${esc(x.v)}" aria-label="Risultato"><button class="xb" type="button" data-r="${i}" aria-label="Togli questo test">✕</button></div>`).join('')};
  draw();
  const c=o.querySelector('#mtr');
  c.addEventListener('input',e=>{const n=e.target.dataset.n,v=e.target.dataset.v;if(n!==undefined)rows[+n].n=e.target.value;if(v!==undefined)rows[+v].v=e.target.value});
  c.addEventListener('click',e=>{const b=e.target.closest('[data-r]');if(b){rows.splice(+b.dataset.r,1);if(!rows.length)rows.push({n:'',v:''});draw()}});
  o.querySelector('#mta').onclick=()=>{rows.push({n:'',v:''});draw()}}

/* ---------- copia dei tesserini per il tecnico (la scrive chi gestisce Tessere) ---------- */
const sigTes=new Map();
export function syncTesserini(db,items,tecnici){
  tecnici.forEach(t=>{
    const l=tesserini(items,t.id).map(z=>({id:z.id,albo:z.albo||'',altraNome:z.altraNome||'',righe:z.righe||[],ente:z.ente||'',numero:z.numero||'',emissione:z.emissione||'',scadenza:z.scadenza||'',nota:z.nota||'',tesFile:z.tesFile||''}));
    const sig=JSON.stringify(l);
    if(!l.length&&!sigTes.has(t.id))return;
    if(sigTes.get(t.id)===sig)return;
    sigTes.set(t.id,sig);
    setDoc(doc(db,'tecniciTes',t.id),{tesserini:l}).catch(()=>sigTes.delete(t.id))})}
