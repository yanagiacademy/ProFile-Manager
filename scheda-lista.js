/* Motore comune delle schede «a elenco» semplici: Materiale, Cassetta medica, Calendario timeline.
   Ogni scheda passa una configurazione (sec, titolo, campi, riga, filtro, render…) a avvia(C).
   Dati: sections/<sec>/items (kind = C.kind) su Firebase (fb:true, come Corsi). Permessi: Gestione account → <scheda> (Lettura per vedere, Scrittura per modificare).
   Regole Firestore: quelle generiche di sections/{sec}/items. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,collection,onSnapshot,addDoc,updateDoc,deleteDoc,serverTimestamp,logEvento} from "./fsx.js";
import {firebaseConfig} from "./firebase-config.js";

export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const oggiISO=()=>new Date().toLocaleDateString('sv-SE');
export const fmtD=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?m[3]+'/'+m[2]+'/'+m[1]:(d||'')};
export const giorniA=d=>d?Math.round((new Date(d+'T00:00:00')-new Date(oggiISO()+'T00:00:00'))/864e5):null;
export const badge=(t,cls='')=>`<span class="bd ${cls}">${esc(t)}</span>`;

const CSS=`.hd{display:flex;gap:6px 12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;min-width:0}
.lgbox{background:#1B2A4A;border-radius:10px;padding:6px 10px;display:inline-flex;flex:none}.lgbox img{height:52px;width:auto;display:block}
.lst{display:flex;flex-direction:column;gap:8px}.rw{display:flex;gap:6px;align-items:stretch;min-width:0}
.cr{display:block;flex:1;text-align:left;min-height:56px;padding:10px 12px;border:1px solid var(--ln);border-radius:10px;background:var(--sf,#fff);color:inherit;font:inherit;cursor:pointer;min-width:0}
.cr:hover{border-color:var(--ac2,var(--ac))}.cr b{display:block;overflow-wrap:anywhere}.cr .mu{display:block;overflow-wrap:anywhere}
.qb{display:flex;flex-direction:column;gap:4px}.qb button{min-width:44px;min-height:26px;flex:1;border:1px solid var(--ln);border-radius:8px;background:var(--sf,#fff);color:inherit;font:inherit;cursor:pointer}
.bd{display:inline-block;margin:4px 6px 0 0;padding:1px 8px;border-radius:999px;font-size:.78rem;border:1px solid var(--ln)}
.bd.w{background:#FFF3CD;color:#7a5b00;border-color:#e8d48a}.bd.r{background:#FDE2E1;color:#8a1f1a;border-color:#efb1ad}.bd.g{background:#E3F4E6;color:#1d5a2a;border-color:#a9d6b2}
.ch{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.dl{margin:10px 0 0}.dl dt{font-size:.8rem;color:var(--mu);margin-top:10px}.dl dd{margin:2px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}
.dlg textarea{min-height:90px}.sm2{display:flex;gap:8px;margin:8px 0}.sm2 input{flex:1;min-width:0}
.tl{border-left:2px solid var(--ln);margin:6px 0 6px 8px;padding-left:14px}.tl h3{margin:14px 0 6px;font-size:.95rem;text-transform:capitalize}
.tli{position:relative;display:block;width:100%;text-align:left;padding:8px 10px;margin:6px 0;border:1px solid var(--ln);border-radius:10px;background:var(--sf,#fff);color:inherit;font:inherit;cursor:pointer;min-width:0}
.tli::before{content:"";position:absolute;left:-23px;top:14px;width:12px;height:12px;border-radius:50%;background:var(--ac,#1B2A4A);border:2px solid var(--sf,#fff)}
.tli.pas{opacity:.6}.tli.pas::before{background:var(--mu,#888)}.tli b,.tli .mu{display:block;overflow-wrap:anywhere}
.tod{position:relative;margin:10px 0;padding:2px 0;font-weight:700;color:var(--ac,#1B2A4A)}.tod::before{content:"";position:absolute;left:-23px;top:6px;width:12px;height:12px;border-radius:50%;background:#C0392B;border:2px solid var(--sf,#fff)}`;

export function avvia(C){
  const SEC=C.sec,$=s=>document.querySelector(s),app=$('#app');
  const st=document.createElement('style');st.textContent=CSS;document.head.append(st);
  const box=(t,m)=>`<div class="wrap"><div class="card login"><h1>ProFile Manager</h1><h2 style="margin-top:12px">${esc(t)}</h2><div class="mu">${esc(m)}</div><p style="margin-top:16px"><a href="index.html" class="mu">← Torna alla suite</a></p></div></div>`;
  const tick=()=>{const d=new Date();$('#clock').textContent=d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})};
  tick();setInterval(tick,15000);
  let auth,db,col,me=null,items=[],unsubs=[],shell=false,letto=false,errLet='',q='',flt='',stato={};
  const puoVedere=()=>!!me&&(me.admin||['r','w'].includes((me.perms||{})[SEC]));
  const puoModif=()=>!!me&&(me.admin||(me.perms||{})[SEC]==='w');
  const msgErr=()=>'Operazione non riuscita. Controlla la connessione e riprova.';
  const elenco=()=>items.filter(i=>i.kind===C.kind||(!i.kind&&i[C.campi[0].k]));

  function modal(title,body,{ok='Salva',cancel='Annulla',onSave,extra=''}={}){
    const o=document.createElement('div');o.className='ov';o.style.zIndex=30;
    o.innerHTML=`<div class="card dlg big" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin:0 0 4px;overflow-wrap:anywhere">${esc(title)}</h2>${body}<p class="err" role="alert" data-er></p><div class="dact"><button class="btn ghost" data-x>${esc(cancel)}</button>${extra}${onSave?`<button class="btn" data-ok>${esc(ok)}</button>`:''}</div></div>`;
    const er=o.querySelector('[data-er]');
    const k=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
    const close=()=>{o.remove();window.removeEventListener('keydown',k,true)};
    window.addEventListener('keydown',k,true);o.addEventListener('click',e=>{if(e.target===o)close()});
    o.querySelector('[data-x]').onclick=close;
    if(onSave)o.querySelector('[data-ok]').onclick=async()=>{er.textContent='';try{if(await onSave(o,er)!==false)close()}catch(x){console.error(x);er.textContent=msgErr(x)}};
    document.body.append(o);o.close=close;return o}

  function dettaglio(it){
    const righe=C.campi.filter(f=>String(it[f.k]??'').trim()!=='').map(f=>`<dt>${esc(f.label)}</dt><dd>${esc(f.t==='date'?fmtD(it[f.k]):it[f.k])}</dd>`).join('');
    const o=modal(C.titolo1(it),`<dl class="dl">${righe}</dl>`,{cancel:'Chiudi',extra:puoModif()?'<button class="btn ghost" data-ed>Modifica</button><button class="btn ghost" data-del>Elimina</button>':''});
    if(puoModif()){
      o.querySelector('[data-ed]').onclick=()=>{o.close();form(it)};
      o.querySelector('[data-del]').onclick=()=>{
        if(!confirm('Eliminare «'+C.titolo1(it)+'»? Va nel Cestino.'))return;
        deleteDoc(doc(db,'sections',SEC,'items',it.id)).then(()=>{logEvento('elimina',SEC,it.id,C.nome,'Eliminato «'+C.titolo1(it)+'»');o.close()}).catch(x=>{o.querySelector('[data-er]').textContent=msgErr(x)})}}}

  function form(it){
    const ex=it||{};
    const body=C.campi.map(f=>{const v=ex[f.k]??(f.def??''),id='f_'+f.k,lab=`<label for="${id}">${esc(f.label)}${f.req?'':' (facoltativo)'}</label>`;
      if(f.t==='select')return lab+`<select id="${id}">${f.opts.map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
      if(f.t==='textarea')return lab+`<textarea id="${id}" maxlength="1500" placeholder="${esc(f.ph||'')}">${esc(v)}</textarea>`;
      return lab+`<input id="${id}" type="${f.t==='number'?'number':f.t==='date'?'date':'text'}"${f.t==='number'?' min="0" inputmode="numeric"':' maxlength="150"'} placeholder="${esc(f.ph||'')}" value="${esc(v)}">`}).join('');
    const o=modal(it?'Modifica':C.nuovo,body,{onSave:async(o,er)=>{
      const D={kind:C.kind};
      for(const f of C.campi){let v=o.querySelector('#f_'+f.k).value.trim();if(f.t==='number')v=v===''?'':Math.max(0,Math.round(Number(v)));
        if(f.req&&v===''){er.textContent='Compila: '+f.label+'.';return false}D[f.k]=v}
      const e=C.valida&&C.valida(D);if(e){er.textContent=e;return false}
      D.title=C.titolo1(D);D.note=C.sotto?C.sotto(D):'';D.fb=true;
      if(it)await updateDoc(doc(db,'sections',SEC,'items',it.id),D);else await addDoc(col,{...D,by:me.id,at:serverTimestamp()});
      logEvento(it?'modifica':'crea',SEC,it?it.id:'',C.nome,(it?'Modificato «':'Aggiunto «')+D.title+'»')}});
    const f0=o.querySelector('input,select,textarea');if(f0)f0.focus()}

  const haystack=i=>JSON.stringify(Object.values(i)).toLowerCase();
  function paint(){
    const el=$('#lista');if(!el)return;
    if(errLet){el.innerHTML=`<p class="err" role="alert">${esc(errLet)}</p>`;return}
    if(!letto){el.innerHTML='<div class="mu">Caricamento…</div>';return}
    const tutti=elenco();let l=tutti;
    if(C.filtro&&flt)l=l.filter(i=>i[C.filtro.k]===flt);
    if(q.trim()){const t=q.trim().toLowerCase();l=l.filter(i=>haystack(i).includes(t))}
    const riep=$('#riep');if(riep)riep.innerHTML=C.riepilogo?C.riepilogo(tutti):'';
    const vuoto=`<div class="mu">${tutti.length?'Nessun risultato.':(puoModif()?'Niente da mostrare. Premi «'+esc(C.nuovo)+'» per aggiungere il primo elemento.':'Niente da mostrare per ora.')}</div>`;
    if(C.render){el.innerHTML=l.length?C.render(l,stato,puoModif()):vuoto;return}
    l=[...l].sort(C.ordina);
    el.innerHTML=l.length?`<div class="lst">${l.map(i=>{const r=C.riga(i);return `<div class="rw"><button class="cr" data-id="${esc(i.id)}"><b>${esc(r.t)}</b>${r.s?`<span class="mu">${esc(r.s)}</span>`:''}<span>${(r.b||[]).join('')}</span></button>${C.qty&&puoModif()?`<span class="qb"><button data-q="1" data-id="${esc(i.id)}" aria-label="Aumenta quantità">+</button><button data-q="-1" data-id="${esc(i.id)}" aria-label="Diminuisci quantità">−</button></span>`:''}</div>`}).join('')}</div>`:vuoto}

  function chips(){return C.filtro?`<div class="ch" id="ch">${['',...C.filtro.opts].map(o=>`<button class="btn sm ${flt===o?'':'ghost'}" data-f="${esc(o)}" aria-pressed="${flt===o}">${esc(o||'Tutte')}</button>`).join('')}</div>`:''}

  function costruisci(){
    shell=true;
    app.innerHTML=`<div class="top"><a class="btn ghost sm" href="index.html" style="text-decoration:none">← Suite</a><span style="flex:1"></span><span class="who">${esc(me.name||me.email||'')}</span><button class="btn ghost sm" id="out">Esci</button></div>
    <div class="wrap"><div class="hd"><span class="lgbox"><img src="logo-yanagi.png" alt="Yanagi Academy"></span><div><h2 style="margin:0">${esc(C.nome)}</h2>${puoModif()?'':'<span class="badge">Sola lettura</span>'}</div></div>
    <div class="card cd"><div class="mu" style="margin-bottom:8px">${esc(puoModif()?C.introW:C.introR)}</div><div id="riep"></div>
    <div class="sm2"><input id="qs" type="search" autocomplete="off" placeholder="Cerca…" aria-label="Cerca in ${esc(C.nome)}"></div>${chips()}<div id="lista"></div>${puoModif()?`<div class="dact"><button class="btn" id="nc">${esc(C.nuovo)}</button></div>`:''}</div></div>`;
    $('#out').onclick=()=>signOut(auth);
    $('#qs').oninput=e=>{q=e.target.value;paint()};
    const ch=$('#ch');if(ch)ch.onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;flt=b.dataset.f;ch.outerHTML=chips();$('#ch').onclick=ch.onclick;paint()};
    $('#lista').addEventListener('click',e=>{
      const qb=e.target.closest('[data-q]');
      if(qb&&puoModif()){const it=items.find(x=>x.id===qb.dataset.id);if(it){const n=Math.max(0,(Number(it.quantita)||0)+Number(qb.dataset.q));updateDoc(doc(db,'sections',SEC,'items',it.id),{quantita:n}).catch(x=>alert(msgErr(x)))}return}
      if(e.target.closest('[data-pas]')){stato.passati=!stato.passati;paint();return}
      const b=e.target.closest('[data-id]');if(!b)return;const it=items.find(x=>x.id===b.dataset.id);if(it)dettaglio(it)});
    if($('#nc'))$('#nc').onclick=()=>form();
    paint()}

  if(firebaseConfig.apiKey==='INSERISCI'){app.innerHTML=box('Firebase non ancora collegato','Apri index.html e incolla i dati del progetto Firebase.');return}
  const fa=initializeApp(firebaseConfig);auth=getAuth(fa);db=getFirestore(fa);col=collection(db,'sections',SEC,'items');
  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f());unsubs=[];shell=false;letto=false;errLet='';
    if(!u){location.href='index.html';return}
    unsubs.push(onSnapshot(doc(db,'users',u.uid),sn=>{
      me=sn.exists()?{id:u.uid,...sn.data()}:null;
      if(!puoVedere()){app.innerHTML=box('Nessun accesso','Non hai accesso a questa scheda. Chiedi all’admin di abilitarti.');shell=false;return}
      if(shell)return;
      costruisci();
      unsubs.push(onSnapshot(col,s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));letto=true;errLet='';paint()},e=>{console.error(SEC,e);errLet='Impossibile leggere i dati. Controlla la connessione e riprova.';paint()}))},
    ()=>{app.innerHTML=box('Errore di connessione','Impossibile leggere l’account. Riprova tra poco.')}))})}
