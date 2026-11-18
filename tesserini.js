/* Tesserini dei tecnici: logica condivisa da Tessere (dove si inseriscono) e Tecnici (dove si leggono).
   Un tesserino è un documento della sezione Tessere con kind='tesserino' e questi campi:
     tecnico   id del tecnico (sezione Tecnici)
     albo      'cinture' (albo cinture nere) | 'qualifiche' (albo qualifiche) | 'altra' (altra qualifica: es. Mental Coach)
     altraNome nome della qualifica quando albo='altra'
     righe     [{sport, settore, livello}]  livello = grado (cinture, es. "4° Dan") oppure qualifica (es. "Istruttore")
               più righe = un tesserino che contiene più sport; più tesserini = uno per ogni sport/ente
     ente, numero, emissione, scadenza (tutti facoltativi), nota, tesFile (copia del tesserino, foto o PDF) */
export const ALBI={cinture:'Albo cinture nere',qualifiche:'Albo qualifiche',altra:'Altra qualifica'};
const ORDINE={cinture:0,qualifiche:1,altra:2};
export const livelloEtichetta=albo=>albo==='cinture'?'Grado':albo==='qualifiche'?'Qualifica':'Dettaglio (facoltativo)';
export const livelloEsempio=albo=>albo==='cinture'?'es. 4° Dan':albo==='qualifiche'?'es. Istruttore':'';
export const tesName=z=>z.albo==='altra'?(z.altraNome||ALBI.altra):(ALBI[z.albo]||'Tesserino');
/* "Judo 4° Dan" · "Jiu Jutsu (Gemart) Istruttore" */
export const rigaBreve=x=>[((x.sport||'')+(x.settore?' ('+x.settore+')':'')).trim(),x.livello||''].filter(Boolean).join(' ');
export const sumTes=list=>list.map(z=>{const r=(z.righe||[]).map(rigaBreve).filter(Boolean).join(', ');return tesName(z)+(r?': '+r:'')}).join(' · ');
/* i tesserini di un tecnico, in ordine di albo */
export const tesserini=(items,id)=>items.filter(i=>i.kind==='tesserino'&&i.tecnico===id)
  .sort((a,b)=>(ORDINE[a.albo]??9)-(ORDINE[b.albo]??9)||tesName(a).localeCompare(tesName(b),'it'));

/* ---------- scheda grafica del tesserino, come si vede nelle tessere dei tecnici ----------
   Un riquadro per ogni riga (sport) del tesserino: nome del tecnico, Sport, Disciplina, Specialità (= settore), Qualifica o Livello, Matricola.
   Albo cinture nere: riquadro chiaro; albo qualifiche e altre qualifiche: riquadro blu con le voci gialle. */
const e_=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tesStile(){
  if(typeof document==='undefined'||document.getElementById('tesst'))return;
  const s=document.createElement('style');s.id='tesst';
  s.textContent=`.tcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin:8px 0}
.tc{border:1px solid #2b2762;border-radius:6px;overflow:hidden;background:#fff;color:#2b2762;display:flex;flex-direction:column;font-size:.92rem}
.tc .tn{padding:14px 16px 12px;font-weight:800;font-size:1.05rem;text-transform:uppercase;min-height:3.4em;overflow-wrap:anywhere}
.tc .tb{margin:0 16px;border-top:1px solid #2b2762;padding:10px 0 12px;flex:1}
.tc .tw{display:grid;grid-template-columns:6.8em 1fr;gap:8px;padding:3px 0}
.tc .tl{color:#f0b323;font-weight:800}.tc .tv{overflow-wrap:anywhere}
.tc .tf{background:#2b2762;color:#fff;font-weight:800;padding:9px 16px}
.tc.chiaro{border-color:#dfe3e8;color:#333}.tc.chiaro .tn{font-weight:400;text-transform:none}
.tc.chiaro .tb{border-top:0;padding-top:0}.tc.chiaro .tl{color:#222}
.tc.chiaro .tf{background:#f4f5f7;color:#667;font-weight:400;border-top:1px solid #dfe3e8}`;
  document.head.appendChild(s)}
export function tesCard(z,{nome='',matricola=''}={}){
  const righe=(z.righe&&z.righe.length)?z.righe:[{}],mat=z.numero||matricola,chiaro=z.albo==='cinture';
  const r_=(l,v)=>`<div class="tw"><span class="tl">${l}</span><span class="tv">${e_(v||'')}</span></div>`;
  return righe.map(x=>{
    const voci=[x.sport&&r_('Sport',x.sport),x.disciplina&&r_('Disciplina',x.disciplina),x.settore&&r_('Specialità',x.settore)];
    if(chiaro)voci.push(r_('Qualifica',''),r_('Livello',x.livello));
    else voci.push(r_('Qualifica',x.livello||(z.albo==='altra'?z.altraNome:'')));
    return `<div class="tc${chiaro?' chiaro':''}"><div class="tn">${e_(nome)}</div><div class="tb">${voci.filter(Boolean).join('')}</div>${mat?`<div class="tf">Matricola: ${e_(mat)}</div>`:''}</div>`}).join('')}
