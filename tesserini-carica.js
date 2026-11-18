/* Caricamento dei tesserini di un tecnico (foto o PDF, anche più di uno): ognuno viene letto in automatico (OCR, come le tessere degli atleti),
   l'admin controlla i dati e al salvataggio ogni tesserino diventa un documento kind='tesserino' nella sezione Tessere con la copia del file in Archivio.
   Usato da Tecnici (Nuovo tecnico / Modifica tecnico). I dati letti vanno sempre controllati. */
import {collection,doc,addDoc,updateDoc,serverTimestamp} from "./fsx.js";
import {parseTesserino} from "./tessere-lettura.js";
import {ocrFile} from "./ocr-lettura.js";
import {ALBI,tesName,rigaBreve} from "./tesserini.js";

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function tesBox(root,{getArch,onDati=()=>{}}){
  const voci=[];let coda=Promise.resolve();
  root.innerHTML=`<label for="tsf">Foto o PDF dei tesserini (anche più di uno)</label><input id="tsf" type="file" multiple accept="image/*,application/pdf">
    <div class="ocr" id="tso">Con una foto o un PDF i dati si compilano da soli: poi controllali. Un tesserino per ogni file.</div><div id="tsl"></div>`;
  const f=root.querySelector('#tsf'),msg=root.querySelector('#tso'),lst=root.querySelector('#tsl');
  const say=t=>{msg.textContent=t||'Con una foto o un PDF i dati si compilano da soli: poi controllali. Un tesserino per ogni file.'};
  const etLiv=a=>a==='cinture'?'Grado (es. 4° Dan)':a==='qualifiche'?'Qualifica (es. Istruttore)':'Dettaglio (facoltativo)';
  function disegna(){
    lst.innerHTML=voci.map((v,i)=>`<div class="card" style="margin:8px 0;padding:10px 12px" data-v="${i}">
      <div class="mu">${esc(v.file.name)} · ${v.stato==='lettura'?'lettura in corso…':v.stato==='errore'?'non sono riuscito a leggerlo: compila a mano':v.incerto?'letto con dubbi: controlla bene':'letto: controlla i dati'}</div>
      <label>Tipo di tesserino</label><select data-k="albo">${Object.entries(ALBI).map(([k,l])=>`<option value="${k}"${v.albo===k?' selected':''}>${l}</option>`).join('')}</select>
      ${v.albo==='altra'?`<label>Nome della qualifica</label><input type="text" data-k="altraNome" autocomplete="off" value="${esc(v.altraNome)}">`:''}
      <div class="two"><div><label>Sport</label><input type="text" data-k="sport" autocomplete="off" value="${esc(v.sport)}"></div><div><label>Disciplina</label><input type="text" data-k="disciplina" autocomplete="off" value="${esc(v.disciplina)}"></div></div>
      <div class="two"><div><label>Specialità (facoltativa)</label><input type="text" data-k="settore" autocomplete="off" value="${esc(v.settore)}"></div><div><label>${etLiv(v.albo)}</label><input type="text" data-k="livello" autocomplete="off" value="${esc(v.livello)}"></div></div>
      <div class="two"><div><label>Matricola</label><input type="text" data-k="numero" autocomplete="off" value="${esc(v.numero)}"></div><div><label>Scadenza (facoltativa)</label><input type="date" data-k="scadenza" value="${esc(v.scadenza)}"></div></div>
      <button type="button" class="btn ghost sm" data-rm style="margin-top:8px">Togli questo tesserino</button></div>`).join('')}
  lst.oninput=lst.onchange=e=>{const c=e.target.closest('[data-v]'),k=e.target.dataset.k;if(!c||!k)return;voci[+c.dataset.v][k]=e.target.value;if(k==='albo'&&e.type==='change')disegna()};
  lst.onclick=e=>{const b=e.target.closest('[data-rm]');if(!b)return;voci.splice(+b.closest('[data-v]').dataset.v,1);disegna()};
  async function leggi(v){
    try{
      const p=parseTesserino(await ocrFile(v.file,s=>say(v.file.name+': '+s)));
      if(p.vuoto)v.stato='errore';
      else{v.stato='ok';v.incerto=!!p.incerto;v.albo=p.albo;Object.assign(v,p.riga)}
      if(p.numero)v.numero=p.numero;
      onDati({nome:p.nome||'',cognome:p.cognome||'',numero:p.numero||''})
    }catch(e){console.error(e);v.stato='errore'}
    say('');disegna()}
  f.onchange=()=>{
    const arch=getArch&&getArch();
    for(const file of [...f.files]){
      if(arch&&file.size>arch.maxBytes()){say('«'+file.name+'» è troppo grande per il caricamento.');continue}
      const v={file,stato:'lettura',incerto:false,albo:'qualifiche',altraNome:'',sport:'',disciplina:'',settore:'',livello:'',numero:'',scadenza:''};
      voci.push(v);coda=coda.then(()=>leggi(v))}
    f.value='';disegna()};
  return {
    voci:()=>voci.filter(v=>v.stato!=='lettura'),
    inLettura:()=>voci.some(v=>v.stato==='lettura'),
    reset(){voci.length=0;say('');disegna()},
    controlla(){
      for(const v of voci){
        if(v.stato==='lettura')continue;
        if(v.albo==='altra'&&!(v.altraNome||'').trim())return 'Per il tesserino «'+v.file.name+'» scrivi il nome della qualifica.';
        if(v.albo!=='altra'&&(!(v.sport||'').trim()||!(v.livello||'').trim()))return 'Per il tesserino «'+v.file.name+'» indica lo sport e '+(v.albo==='cinture'?'il grado (es. 4° Dan)':'la qualifica (es. Istruttore)')+'.'}
      return ''}}}

/* crea i documenti dei tesserini (Tessere) e carica le copie in Archivio; restituisce quanti e gli eventuali errori */
export async function salvaTesserini({db,arch,uid,tec,voci,say=()=>{}}){
  const col=collection(db,'sections','tessere','items');let n=0;const errori=[];
  for(const v of voci){
    const nome0=tesName({albo:v.albo,altraNome:v.altraNome}),t=k=>String(v[k]||'').trim();
    const riga={sport:t('sport'),disciplina:t('disciplina'),settore:t('settore'),livello:t('livello')},righe=Object.values(riga).some(Boolean)?[riga]:[],numero=t('numero').toUpperCase();
    const data={kind:'tesserino',tecnico:tec.id,nome:tec.nome,cognome:tec.cognome,albo:v.albo,altraNome:v.albo==='altra'?t('altraNome'):'',righe,ente:'',numero,emissione:'',scadenza:v.scadenza||'',nota:'',fb:true,
      title:nome0+' · '+((tec.cognome||'')+' '+(tec.nome||'')).trim(),note:[nome0,righe.map(rigaBreve).join(', '),numero&&'n. '+numero].filter(Boolean).join(' · ').slice(0,300)};
    let id;
    try{id=(await addDoc(col,{...data,by:uid,at:serverTimestamp()})).id}catch(e){console.error(e);errori.push(v.file.name+': dati non salvati');continue}
    n++;
    if(v.file){
      try{say('Caricamento di '+v.file.name+'…');
        const fid=await arch.save(v.file,{tesTec:tec.id,ruolo:'tesserino',fb:true},p=>say('Caricamento di '+v.file.name+' '+p+'%'));
        await updateDoc(doc(db,'sections','tessere','items',id),{tesFile:fid})
      }catch(e){console.error(e);errori.push(v.file.name+': file non caricato ('+arch.errText(e)+')')}}}
  return {n,errori}}
