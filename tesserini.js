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
