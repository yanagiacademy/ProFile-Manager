/* Eventi → emissione della ricevuta a modulo (copia VERDE per l'ASD, copia BLU per chi ha pagato) per chi ha caricato il bonifico, interni ed esterni.
   Usa lo STESSO registro e lo stesso disegno di Commercialista → Ricevute ASD (kind:'ricasd' in sections/commercialista), quindi la numerazione è consequenziale:
   il numero proposto è quello successivo alle ricevute già emesse (e a quelle numerate in sezione Ricevute, a parità di formato: 12 → 13, 12/2026 → 13/2026).
   • Interni: la copia blu diventa una normale ricevuta di sections/ricevute (ricAtl): l'atleta la legge in «Le mie ricevute».
   • Esterni: la copia blu si può inviare per e-mail all'associazione (Gmail dell'ASD, stesso ponte delle notifiche) e si può aprire/scaricare.
   La ricevuta resta legata all'iscrizione (campi evId, evRid, evTipo nel registro) per mostrarla nell'elenco di Eventi. */
import {doc,collection,onSnapshot,setDoc,updateDoc,serverTimestamp} from "./fsx.js";
import {archivio} from "./archivio.js";
import {showPreview} from "./file-tools.js";
import {disegna,righePer,importoInLettere,pdfDaCanvas,prossimaFirma} from "./ricevute-asd.js";

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2=n=>String(n).padStart(2,'0');
const oggi=()=>{const d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())};
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
const msOf=r=>r.at&&r.at.toMillis?r.at.toMillis():(r.at&&r.at.seconds?r.at.seconds*1000:0);
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const b64=blob=>new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>ko(new Error('Lettura del file non riuscita.'));r.readAsDataURL(blob)});
const nomeFile=(r,suf)=>('Ricevuta n '+r.num+' '+(r.da||'')+(suf?' ('+suf+')':'')).replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,90);

function modal(titolo){
  const o=document.createElement('div');o.className='ov';o.style.zIndex=50;
  o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(titolo)}" style="max-width:720px"><h2 style="margin:0 0 4px">${esc(titolo)}</h2><div data-b></div></div>`;
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
  const close=()=>{window.removeEventListener('keydown',k,true);o.remove()};
  window.addEventListener('keydown',k,true);
  o.addEventListener('click',e=>{if(e.target===o)close()});
  document.body.append(o);
  return {o,body:o.querySelector('[data-b]'),close}}

export function ricevuteEvento(db,{uid}){
  let reg=[],ric=[],regOk=false,un=[],cbs=new Set(),archC=null,archR=null;
  const getArch=()=>archC||(archC=archivio(db,'commercialista',uid)),ricArch=()=>archR||(archR=archivio(db,'ricevute',uid));
  const notifica=()=>cbs.forEach(f=>{try{f()}catch(e){console.error(e)}});
  const ricasd=()=>reg.filter(i=>i.kind==='ricasd');

  /* numero successivo: stesso formato dell'ultima ricevuta emessa; si guarda anche il numero più alto già usato (Ricevute ASD e sezione Ricevute) */
  function prossimoNum(){
    const asd=ricasd().sort((a,b)=>msOf(b)-msOf(a));
    const ultimaRic=ric.filter(r=>/\d/.test(String(r.ricNum||''))).sort((a,b)=>(b.ricTs||0)-(a.ricTs||0))[0];
    const base=asd[0]?String(asd[0].num||''):ultimaRic?String(ultimaRic.ricNum||''):'';
    const m=/^(\D*)(\d+)(.*)$/.exec(base);
    if(!m)return '1';
    const [,pre,dig,suf]=m,re=new RegExp('^'+reEsc(pre)+'(\\d+)'+reEsc(suf)+'$');
    let max=parseInt(dig,10);
    for(const n of [...asd.map(x=>x.num),...ric.map(x=>x.ricNum)]){const mm=re.exec(String(n||'').trim());if(mm)max=Math.max(max,parseInt(mm[1],10))}
    return pre+String(max+1).padStart(dig.length,'0')+suf}
  const firmaUlt=()=>{const u=ricasd().sort((a,b)=>msOf(b)-msOf(a))[0];return u&&Number.isInteger(u.firma)?u.firma:undefined};

  return {
    /* si legge il registro delle ricevute ASD (Telegram, come Commercialista) e le ricevute della sezione Ricevute */
    start(cb){
      if(cb)cbs.add(cb);
      if(un.length)return;
      un.push(onSnapshot(collection(db,'sections','commercialista','items'),s=>{reg=s.docs.map(d=>({id:d.id,...d.data()}));regOk=true;notifica()},e=>{regOk=false;console.warn('Ricevute ASD:',e&&e.message)}));
      un.push(onSnapshot(collection(db,'sections','ricevute','items'),s=>{ric=s.docs.map(d=>({id:d.id,...d.data()}));notifica()},e=>console.warn('Ricevute:',e&&e.message)))},
    stop(){un.forEach(f=>{try{f()}catch(e){}});un=[];cbs.clear()},
    onChange(f){cbs.add(f);return()=>cbs.delete(f)},
    pronte:()=>regOk,
    /* ricevuta già emessa per quell'iscrizione (interna o esterna) */
    di:rid=>ricasd().filter(x=>x.evRid===rid&&!x.archiviatoIl).sort((a,b)=>msOf(b)-msOf(a))[0]||null,
    apri(r,copia){
      const blu=copia==='blu';
      showPreview({title:'Ricevuta n. '+r.num+(blu?' (copia blu)':' (copia ASD)'),mime:'application/pdf',
        load:async()=>pdfDaCanvas(await disegna(r,blu?'blu':'verde')),errText:()=>'ricevuta non generata',fileName:nomeFile(r,blu?'copia blu':'copia ASD')+'.pdf'})},

    /* o = {tipo:'int'|'est', rid, ev, da, cent, per, email, atl:{id,nome,cognome}|null, uid, evNome} */
    emetti(o){
      if(!regOk){alert('Non riesco a leggere il registro delle ricevute (serve l’accesso a Telegram dalla Chat): senza non posso proporre il numero giusto. Apri la Chat, accedi e riprova.');return}
      const esiste=this.di(o.rid);
      if(esiste&&!confirm('Per questa iscrizione è già stata emessa la ricevuta n. '+esiste.num+'. Emetterne un’altra?'))return;
      const M=modal('Emetti ricevuta · '+(o.da||''));
      let firma=prossimaFirma(firmaUlt()),T=0,busy=false;
      const est=o.tipo==='est';
      M.body.innerHTML=`<p class="mu" style="margin:6px 0">Ricevuta a modulo, in continuità con quelle già emesse (Commercialista → Ricevute ASD). Si salva la copia verde per l’ASD${o.atl?' e la copia blu arriva all’atleta in «Le mie ricevute»':est&&o.email?' e puoi inviare la copia blu all’associazione per e-mail':''}.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label for="rv-n">N. ricevuta</label><input id="rv-n" type="text" autocomplete="off" maxlength="40" value="${esc(prossimoNum())}"></div>
          <div><label for="rv-d">Data</label><input id="rv-d" type="date" value="${oggi()}"></div></div>
        <label for="rv-da">Ricevuto da</label><input id="rv-da" type="text" autocomplete="off" maxlength="80" value="${esc(o.da||'')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label for="rv-i">Importo in euro</label><input id="rv-i" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 45,00" value="${o.cent>0?esc(String(o.cent/100).replace('.',',')):''}"></div>
          <div><label for="rv-l">Importo in lettere</label><input id="rv-l" type="text" autocomplete="off" value="${o.cent>0?esc(importoInLettere(o.cent)):''}"></div></div>
        <label for="rv-p">Per (causale)</label><input id="rv-p" type="text" autocomplete="off" maxlength="120" value="${esc(o.per||'')}">
        ${est&&o.email?`<label style="display:flex;gap:8px;align-items:center;margin:10px 0 2px"><input id="rv-m" type="checkbox" checked style="width:auto;min-height:0"><span>Invia la copia blu per e-mail a ${esc(o.email)}</span></label>`:''}
        <div class="mu" style="margin:10px 0 4px">Anteprima (copia blu):</div><div id="rv-pv" class="mu">…</div>
        <p class="err" role="alert" id="rv-er"></p>
        <div class="dact"><button class="btn ghost" id="rv-x" type="button">Annulla</button><button class="btn ghost" id="rv-f" type="button" title="Cambia la firma">Cambia firma</button><button class="btn" id="rv-ok" type="button">Emetti ricevuta</button></div>`;
      const $=s=>M.body.querySelector(s),er=$('#rv-er');
      let lettMan=false;
      const dati=()=>({num:$('#rv-n').value.trim(),data:$('#rv-d').value,da:$('#rv-da').value.trim(),dett:[],cent:parseEuro($('#rv-i').value),lett:$('#rv-l').value.trim(),per:$('#rv-p').value.trim(),firma});
      const prev=()=>{clearTimeout(T);T=setTimeout(async()=>{const w=$('#rv-pv');if(!w)return;const d=dati();
        try{const cv=await disegna({...d,cent:d.cent>0?d.cent:0},'blu');cv.style.cssText='width:100%;max-width:680px;height:auto;border:1px solid var(--ln);border-radius:6px;display:block';cv.setAttribute('aria-label','Anteprima della ricevuta');w.replaceChildren(cv)}
        catch(e){console.error(e);w.textContent='Anteprima non disponibile ('+(e&&e.message||'errore')+').'}},120)};
      $('#rv-i').oninput=()=>{if(!lettMan){const c=parseEuro($('#rv-i').value);$('#rv-l').value=c>0?importoInLettere(c):''}prev()};
      $('#rv-l').oninput=()=>{lettMan=!!$('#rv-l').value.trim();if(!lettMan){const c=parseEuro($('#rv-i').value);$('#rv-l').value=c>0?importoInLettere(c):''}prev()};
      ['#rv-n','#rv-d','#rv-da','#rv-p'].forEach(s=>{$(s).oninput=prev});$('#rv-d').onchange=prev;
      $('#rv-f').onclick=()=>{firma=prossimaFirma(firma);prev()};
      const chiudi=()=>{clearTimeout(T);M.close()};
      $('#rv-x').onclick=()=>{if(!busy)chiudi()};
      prev();

      $('#rv-ok').onclick=async()=>{
        if(busy)return;
        const d=dati();er.textContent='';
        if(!d.num){er.textContent='Indica il numero della ricevuta.';return}
        if(!isD(d.data)){er.textContent='Indica la data.';return}
        if(!d.da){er.textContent='Indica da chi è ricevuta la somma («Ricevuto da»).';return}
        if(!(d.cent>0)){er.textContent='Indica un importo valido, maggiore di zero (es. 45,00).';return}
        if(!d.lett){er.textContent='L’importo in lettere è vuoto.';return}
        if(!d.per){er.textContent='Indica la causale («Per»).';return}
        if(!righePer(d.per).ok){er.textContent='La causale è troppo lunga: nel modulo entrano due righe. Accorciala.';return}
        if(ricasd().some(x=>String(x.num)===d.num)&&!confirm('Esiste già una ricevuta con il numero '+d.num+'. Vuoi emetterla lo stesso?'))return;
        if(getArch().needsTelegram()||(o.atl&&ricArch().needsTelegram())){
          if(confirm('I dati vengono salvati su Telegram (con copia su Firebase): prima devi accedere dalla pagina Chat. Aprire la Chat adesso?'))location.href='chat.html';
          return}
        busy=true;$('#rv-ok').disabled=true;er.textContent='Preparazione della ricevuta…';
        const col=collection(db,'sections','commercialista','items');
        let ref=null,rec=null;
        try{
          const pv=await pdfDaCanvas(await disegna(d,'verde'));
          const fV=new File([pv],nomeFile({num:d.num,da:d.da},'copia ASD')+'.pdf',{type:'application/pdf'});
          ref=doc(col);
          const verdeId=await getArch().save(fV,{ricasd:ref.id},p=>{er.textContent='Salvataggio della copia ASD: '+p+'%'});
          rec={kind:'ricasd',num:d.num,data:d.data,da:d.da,dett:[],cent:d.cent,lett:d.lett,per:d.per,firma:d.firma,
            atlBlu:o.atl?o.atl.id:'',atlNome:o.atl?o.atl.nome:'',atlCognome:o.atl?o.atl.cognome:'',verdeId,fb:false,
            evId:o.ev.id,evRid:o.rid,evTipo:o.tipo,
            title:'Ricevuta n. '+d.num+' · '+d.da,
            note:['Ricevuta n. '+d.num,d.da,euro(d.cent),fmtD(d.data),d.per].filter(Boolean).join(' · ').replace(/\s+/g,' ').slice(0,300)};
          await setDoc(ref,{...rec,by:uid,at:serverTimestamp()})}
        catch(e){console.error(e);er.textContent='Salvataggio non riuscito: '+getArch().errText(e)+'.';busy=false;$('#rv-ok').disabled=false;return}
        let msg='Ricevuta n. '+d.num+' emessa: la copia verde è salvata in Commercialista → Ricevute ASD.';
        if(o.atl){
          er.textContent='Invio della copia blu a '+(o.atl.nome+' '+o.atl.cognome).trim()+'…';
          try{
            const pb=await pdfDaCanvas(await disegna(rec,'blu')),f=new File([pb],nomeFile(rec,'')+'.pdf',{type:'application/pdf'});
            const cau=String(d.per).replace(/\s+/g,' ').slice(0,120),v={ricAtl:o.atl.id,nome:o.atl.nome,cognome:o.atl.cognome,ricData:d.data,importo:d.cent/100,causale:cau,ricNum:String(d.num),metodo:'Bonifico',asdId:ref.id};
            v.note=[(o.atl.cognome+' '+o.atl.nome).trim(),cau,euro(d.cent),'n. '+d.num].filter(Boolean).join(' · ');
            const bid=await ricArch().save(f,{...v,ricTs:Date.now(),evId:o.ev.id,ricUid:o.uid||'',fb:true},p=>{er.textContent='Invio della copia blu: '+p+'%'});
            await updateDoc(doc(col,ref.id),{bluId:bid}).catch(x=>console.warn(x));
            msg+=' Copia blu inviata all’atleta (la trova in «Le mie ricevute»).'}
          catch(e){console.error(e);msg+=' La copia blu NON è arrivata all’atleta ('+ricArch().errText(e)+'): puoi aprirla e scaricarla da «Copia blu».'}}
        else if(est&&o.email&&$('#rv-m')&&$('#rv-m').checked){
          er.textContent='Invio della copia blu a '+o.email+'…';
          try{
            const m=await import('./notifiche-motore.js');
            if(!(await m.mailPronta()))throw new Error('La Mail non è collegata (mail-config.js).');
            const pb=await pdfDaCanvas(await disegna(rec,'blu'));
            const es=await m.inviaDiretta(db,{key:'evric:'+ref.id+':'+Date.now(),to:o.email,subject:'Ricevuta n. '+d.num+' – '+(o.evNome||o.ev.nome),
              text:`Buongiorno,\n\nin allegato la ricevuta n. ${d.num} del ${fmtD(d.data)} di ${euro(d.cent)} per «${d.per}».\n\nGrazie.\n\n— Yanagi Academy`,
              files:[{name:nomeFile(rec,'')+'.pdf',type:'application/pdf',data:await b64(pb)}]});
            if(!es.ok)throw new Error(es.e||'Invio non riuscito');
            msg+=' Copia blu inviata a '+o.email+'.'}
          catch(e){console.error(e);msg+=' La mail NON è partita ('+(e&&e.message||e)+'): apri la «Copia blu» e inviala a mano.'}}
        busy=false;
        M.body.innerHTML=`<p style="margin:10px 0">${esc(msg)}</p><div class="dact"><button class="btn ghost" id="rv-b" type="button">Apri copia blu</button><button class="btn" id="rv-c" type="button">Chiudi</button></div>`;
        M.body.querySelector('#rv-b').onclick=()=>this.apri({...rec,id:ref.id},'blu');
        M.body.querySelector('#rv-c').onclick=chiudi;
        notifica()}}}}
