/* Scheda «Notifiche» della sezione Mail (solo admin): sceglie quale evento inviare e a quali indirizzi, e attiva le altre notifiche automatiche
   (scadenze di tessera e certificato agli atleti, riepilogo scadenze all'admin, ricevute di pagamento, esito delle richieste).
   La logica sta in notifiche-motore.js (invio/coda) e notifiche-core.js (calcolo); l'invio passa dal ponte Gmail (ponte-mail.gs). */
import {leggiConfig,salvaConfig,leggiRegistro,elencoEventi,elencoAtleti,inviaEvento,sincronizza,statoMail,provaMail,listaMail,mailPronta} from "./notifiche-motore.js";
import {testoEvento,fmtD,isD} from "./notifiche-core.js";

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const oggi=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
const fmtTs=t=>{const d=new Date(t);return isNaN(d)?'':d.toLocaleDateString('it-IT',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})};

function stile(){
  if(document.getElementById('ntst'))return;
  const s=document.createElement('style');s.id='ntst';
  s.textContent=`.nt h3{margin:0 0 6px}.nt .rw{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--ln)}
.nt .rw:last-child{border-bottom:0}.nt .ac{display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:560px){.nt .rw{flex-wrap:wrap}.nt .ac{width:100%;justify-content:flex-start}}
.nt .chip{font-size:.72rem;padding:2px 8px;border-radius:99px;border:1px solid var(--ln);white-space:nowrap;color:var(--mu);margin-left:4px}
.nt .chip.ok{border-color:var(--ac);color:var(--ac);font-weight:700}
.nt .ck{display:flex;gap:10px;align-items:flex-start;margin:10px 0}.nt .ck input{width:auto;min-height:0;margin-top:4px}
.nt .pn{border:1px solid var(--ln);border-radius:10px;padding:12px;margin:8px 0 4px}
.nt .lst{max-height:240px;overflow:auto;border:1px solid var(--ln);border-radius:8px;padding:4px 10px;margin:6px 0}
.nt .lg{background:var(--bg);border:1px solid var(--ln);border-radius:8px;padding:10px 12px;font-size:.85rem;line-height:1.5;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px}
.nt .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.nt textarea{width:100%;min-height:150px;font:inherit}
.nt .two{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}@media (max-width:560px){.nt .two{grid-template-columns:1fr}}`;
  document.head.appendChild(s)}

export async function mostraNotifiche({db,root,url}){
  stile();
  const S={cfg:null,reg:{voci:{}},evs:[],ats:[],pronta:false,aperto:null,tutti:false,msg:'',errDati:'',log:'',stato:'',busy:false};
  const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)];
  const BASE=url||new URL('index.html',location.href).href;

  async function carica(){
    root.innerHTML='<p class="mu">Caricamento…</p>';
    S.pronta=await mailPronta();S.errDati='';
    try{S.cfg=await leggiConfig(db)}catch(e){S.cfg=null;S.msg='Impossibile leggere le impostazioni delle notifiche.'}
    try{S.reg=await leggiRegistro(db)}catch(e){}
    try{[S.evs,S.ats]=await Promise.all([elencoEventi(db),elencoAtleti(db)])}catch(e){S.evs=[];S.ats=[];S.errDati=e.message}
    disegna()}

  const inviiDi=id=>Object.values(S.reg.voci||{}).filter(v=>v.ev===id).sort((a,b)=>b.t-a.t);
  function rigaEvento(e){
    const nome=e.nome||e.title||'Evento senza nome',inv=inviiDi(e.id),u=inv[0];
    const stato=e.chiuso?'<span class="chip">chiuso</span>':(isD(e.data)&&e.data<oggi()?'<span class="chip">concluso</span>':'');
    return `<div class="rw"><div><b>${esc(nome)}</b>${stato}<br><span class="mu">${isD(e.data)?fmtD(e.data):''}${u?' · '+`<span class="chip ok">inviato ${esc(fmtTs(u.t))} a ${u.n||'?'} indirizzi${inv.length>1?' (+'+(inv.length-1)+' invii)':''}</span>`:''}</span></div>
      <div class="ac"><button class="btn sm${S.aperto===e.id?' ghost':''}" data-ev="${esc(e.id)}">${S.aperto===e.id?'Chiudi':'Invia…'}</button></div></div>${S.aperto===e.id?pannello(e):''}`}

  function pannello(e){
    const nome=e.nome||e.title||'Evento',dst=Array.isArray(e.dest)&&e.dest.length?e.dest:null,per=new Map();
    S.ats.forEach(a=>{const o=per.get(a.email)||{nomi:[],on:!dst};o.nomi.push(a.nome);if(dst&&dst.includes(a.id))o.on=true;per.set(a.email,o)});
    const lista=[...per.entries()].map(([em,o])=>`<label class="ck"><input type="checkbox" data-m="${esc(em)}"${o.on?' checked':''}><span>${esc(o.nomi.join(', '))}<br><span class="mu">${esc(em)}</span></span></label>`).join('');
    return `<div class="pn" data-pn="${esc(e.id)}">
      <label for="og" style="margin-top:0">Oggetto</label><input id="og" type="text" value="${esc('Evento: '+nome)}">
      <label for="tx">Testo della mail</label><textarea id="tx">${esc(testoEvento(e,BASE))}</textarea>
      ${(e.allegati||[]).length?`<label>Allegati <span class="mu">(max 15 MB in tutto)</span></label>${e.allegati.map(f=>`<label class="ck"><input type="checkbox" data-f="${esc(f.id)}" checked><span>${esc(f.title||'file')}${f.size?`<br><span class="mu">${esc((f.size/1048576).toFixed(1))} MB</span>`:''}</span></label>`).join('')}`:''}
      <label>Destinatari${dst?' <span class="mu">(l’evento è rivolto solo ad alcuni atleti: sono già spuntati)</span>':''}</label>
      ${per.size?`<div class="btns" style="margin-top:4px"><button class="btn ghost sm" id="sa">Tutti</button><button class="btn ghost sm" id="sn">Nessuno</button><span class="mu" id="cnt" style="align-self:center"></span></div><div class="lst">${lista}</div>`:'<p class="mu">Nessun atleta ha un indirizzo e-mail nella scheda Atleti.</p>'}
      <label for="ex">Altri indirizzi (facoltativo, separati da virgola o a capo)</label><textarea id="ex" style="min-height:64px" placeholder="es. genitore@email.it, tecnico@email.it"></textarea>
      <p class="err" id="er" role="alert"></p>
      <div class="btns"><button class="btn" id="go">Invia ora</button><button class="btn ghost" id="no">Annulla</button></div></div>`}

  function disegna(){
    const c=S.cfg||{atleti:false,admin:false,ricevute:false,esiti:false,eventiAuto:false,giorni:[30,7,1],ora:9,indirizziAdmin:['info.judoyanagi@gmail.com']};
    const evs=S.evs.filter(e=>S.tutti||(!e.chiuso&&!(isD(e.data)&&e.data<oggi())));
    const ck=(id,on,t,sub)=>`<label class="ck"><input type="checkbox" id="${id}"${on?' checked':''}><span>${t}${sub?`<br><span class="mu">${sub}</span>`:''}</span></label>`;
    root.innerHTML=`<div class="nt">
      <div class="bar"><h2>Notifiche via mail</h2></div>
      ${!S.pronta?'<div class="card"><p class="err" role="alert" style="margin:0">La Mail non è ancora collegata: compila mail-config.js con l’indirizzo dell’app web di Apps Script (istruzioni in ponte-mail.gs). Finché non è collegata puoi preparare le impostazioni, ma nulla viene inviato.</p></div>':''}
      ${S.msg?`<p class="mu" role="status">${esc(S.msg)}</p>`:''}
      <div class="card"><h3>Eventi</h3>
        <p class="mu" style="margin-top:0">Scegli un evento e gli indirizzi a cui mandarlo: parte dal Gmail dell’ASD. Gli indirizzi degli atleti sono quelli della scheda Atleti.</p>
        ${S.errDati?`<p class="err">${esc(S.errDati)}</p>`:''}
        ${evs.length?evs.map(rigaEvento).join(''):(S.errDati?'':'<p class="mu">Nessun evento aperto.</p>')}
        <label class="ck" style="margin-top:12px"><input type="checkbox" id="tt"${S.tutti?' checked':''}><span>Mostra anche eventi chiusi e conclusi</span></label>
      </div>
      <div class="card"><h3>Altre notifiche automatiche</h3>
        <p class="mu" style="margin-top:0">Tutto è disattivato finché non lo spunti. Le mail con scadenze future restano in coda sul ponte e partono all’ora scelta anche a suite chiusa.</p>
        ${ck('c-atleti',c.atleti,'<b>Scadenze all’atleta</b>: tessera e certificato medico','mail all’indirizzo dell’atleta, nei giorni indicati sotto prima della scadenza')}
        ${ck('c-admin',c.admin,'<b>Riepilogo scadenze all’admin</b>','un’unica mail al giorno con documenti, tessere, certificati, tesserini, iscrizioni/hotel degli eventi e test in scadenza')}
        ${ck('c-ric',c.ricevute,'<b>Ricevute di pagamento</b>','all’atleta, quando viene caricata una ricevuta')}
        ${ck('c-esi',c.esiti,'<b>Esito delle richieste</b>','all’atleta, quando l’admin accetta o rifiuta dati, file, medaglie o test')}
        ${ck('c-ev',c.eventiAuto,'<b>Nuovi eventi: invio automatico a tutti</b>','di solito non serve: scegli tu l’evento e i destinatari qui sopra')}
        <div class="two"><div><label for="c-gg">Giorni prima della scadenza</label><input id="c-gg" type="text" value="${esc((c.giorni||[]).join(', '))}"></div>
        <div><label for="c-ora">Ora di invio (6–21)</label><input id="c-ora" type="number" min="6" max="21" value="${esc(c.ora)}"></div></div>
        <label for="c-ad">Indirizzi dell’admin (per il riepilogo e la mail di prova)</label><textarea id="c-ad" style="min-height:64px" placeholder="es. asd@gmail.com">${esc((c.indirizziAdmin||[]).join('\n'))}</textarea>
        <p class="err" id="er2" role="alert"></p>
        <div class="btns"><button class="btn" id="salva">Salva impostazioni</button><button class="btn ghost" id="anteprima">Anteprima</button><button class="btn ghost" id="sync">Invia / programma ora</button></div>
        ${S.log?`<div class="lg">${esc(S.log)}</div>`:''}
      </div>
      <div class="card"><h3>Servizio mail</h3>
        <p class="mu" id="stt" style="margin-top:0">${S.stato?esc(S.stato):'Controlla che il ponte risponda, quante mail Gmail può ancora spedire oggi e quante sono in coda.'}</p>
        <div class="btns"><button class="btn ghost" id="stato">Controlla il servizio</button><button class="btn ghost" id="prova">Mail di prova agli indirizzi admin</button></div>
      </div></div>`;
    lega()}

  function aggiornaConto(){const n=qa('[data-m]:checked').length;const c=q('#cnt');if(c)c.textContent=n+(n===1?' destinatario':' destinatari')}
  function lega(){
    q('#tt').onchange=e=>{S.tutti=e.target.checked;if(S.aperto&&!S.evs.some(x=>x.id===S.aperto))S.aperto=null;disegna()};
    qa('[data-ev]').forEach(b=>b.onclick=()=>{S.aperto=S.aperto===b.dataset.ev?null:b.dataset.ev;S.msg='';disegna();const p=q('[data-pn]');if(p)p.scrollIntoView({block:'nearest'})});
    if(S.aperto){
      aggiornaConto();qa('[data-m]').forEach(i=>i.onchange=aggiornaConto);
      if(q('#sa'))q('#sa').onclick=()=>{qa('[data-m]').forEach(i=>i.checked=true);aggiornaConto()};
      if(q('#sn'))q('#sn').onclick=()=>{qa('[data-m]').forEach(i=>i.checked=false);aggiornaConto()};
      q('#no').onclick=()=>{S.aperto=null;disegna()};
      q('#go').onclick=async()=>{
        const e=S.evs.find(x=>x.id===S.aperto),er=q('#er');if(!e)return;
        const a=[...new Set([...qa('[data-m]:checked').map(x=>x.dataset.m),...listaMail(q('#ex').value)])];
        if(!S.pronta){er.textContent='La Mail non è ancora collegata (mail-config.js).';return}
        if(!a.length){er.textContent='Scegli almeno un destinatario.';return}
        if(!confirm('Inviare «'+(e.nome||e.title||'evento')+'» a '+a.length+(a.length===1?' indirizzo?':' indirizzi?')))return;
        const go=q('#go'),all=(e.allegati||[]).filter(f=>qa('[data-f]:checked').some(x=>x.dataset.f===f.id));
        go.disabled=true;er.textContent=all.length?'Preparazione degli allegati e invio in corso…':'Invio in corso…';
        try{
          const r=await inviaEvento(db,e,{a,oggetto:q('#og').value,testo:q('#tx').value,allegati:all});
          S.msg='Evento inviato a '+r.ok+(r.ok===1?' indirizzo':' indirizzi')+(all.length?' con '+all.length+(all.length===1?' allegato':' allegati'):'')+(r.ko?' · '+r.ko+' non riusciti: '+r.dettagli.join('; '):'')+'.';
          S.aperto=null;try{S.reg=await leggiRegistro(db)}catch(x){}disegna()
        }catch(x){er.textContent=x.message;go.disabled=false}}}
    const leggiForm=()=>({atleti:q('#c-atleti').checked,admin:q('#c-admin').checked,ricevute:q('#c-ric').checked,esiti:q('#c-esi').checked,eventiAuto:q('#c-ev').checked,giorni:q('#c-gg').value,ora:q('#c-ora').value,indirizziAdmin:q('#c-ad').value});
    const salva=async()=>{const f=leggiForm();await salvaConfig(db,f);S.cfg=await leggiConfig(db)};
    const occ=(b,v)=>{[...root.querySelectorAll('#salva,#anteprima,#sync,#stato,#prova')].forEach(x=>x.disabled=v)};
    q('#salva').onclick=async()=>{occ(0,1);q('#er2').textContent='';try{await salva();S.msg='Impostazioni salvate.';disegna()}catch(x){q('#er2').textContent='Salvataggio non riuscito. Controlla i permessi e riprova.';occ(0,0)}};
    q('#anteprima').onclick=async()=>{occ(0,1);q('#er2').textContent='';try{await salva();
      const R=await sincronizza(db,{anteprima:true});
      if(R.errore){S.log=R.errore}else{
        const per={};(R.nuovi||[]).forEach(x=>per[x.tipo]=(per[x.tipo]||0)+1);
        const n={atleta:'promemoria agli atleti',admin:'riepiloghi per l’admin',evento:'eventi',ricevuta:'ricevute',esito:'esiti'};
        S.log='Da fare ora: '+((R.nuovi||[]).length?Object.entries(per).map(([k,v])=>v+' '+(n[k]||k)).join(', '):'niente di nuovo')+(R.annulla&&R.annulla.length?' · da annullare: '+R.annulla.length:'')+' · già fatti: '+R.gia+'.'+(R.note.length?'\n'+R.note.join('\n'):'')}
      disegna()}catch(x){S.log=x.message;disegna()}};
    q('#sync').onclick=async()=>{
      if(!S.pronta){q('#er2').textContent='La Mail non è ancora collegata (mail-config.js).';return}
      occ(0,1);q('#er2').textContent='';let righe=[];
      try{await salva();
        const R=await sincronizza(db,{log:l=>righe.push(l)});
        S.log=R.errore?R.errore:('In coda: '+R.programmate+' · Inviate: '+R.inviati+' · Annullate: '+R.annullate+' · Già fatte: '+R.gia+(R.errori?' · Errori: '+R.errori:'')+(R.note.length?'\n'+R.note.join('\n'):'')+(R.dettagli.length?'\n'+R.dettagli.slice(0,12).join('\n'):''));
        try{S.reg=await leggiRegistro(db)}catch(x){}
      }catch(x){S.log=x.message}
      disegna()};
    q('#stato').onclick=async()=>{occ(0,1);const fine=()=>{q('#stt').textContent=S.stato;occ(0,0)};try{const r=await statoMail(db);S.stato='Il ponte risponde'+(r.mittente?' (invia da '+r.mittente+')':'')+'. Mail ancora spedibili oggi: '+r.quota+' · in coda: '+r.inCoda+(r.prossimo?' · prossima: '+fmtTs(r.prossimo):'')+(r.trigger===false?' · ATTENZIONE: l’attività che spedisce la coda non è installata (esegui «autorizza» nello script).':'')}catch(x){S.stato=x.message}fine()};
    q('#prova').onclick=async()=>{occ(0,1);const fine=()=>{q('#stt').textContent=S.stato;occ(0,0)};try{const a=listaMail(q('#c-ad').value);const r=await provaMail(db,a);S.stato=r.ok?'Mail di prova inviata a '+r.ok+(r.ok===1?' indirizzo.':' indirizzi.'):'Prova non riuscita: '+(r.dettagli.join('; ')||'nessun invio')}catch(x){S.stato=x.message}fine()}}
  await carica()}
