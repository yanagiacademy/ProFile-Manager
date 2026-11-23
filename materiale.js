/* Materiale: inventario dell'attrezzatura della palestra (kimono, tatami, protezioni, segnapunti…) con quantità, scorta minima, stato e posizione. */
import {avvia,badge} from "./scheda-lista.js";
const CAT=['Kimono e cinture','Tatami e protezioni','Attrezzi','Segnapunti e gara','Pulizia e igiene','Altro'];
avvia({sec:'materiale',kind:'materiale',nome:'Materiale',nuovo:'Nuovo materiale',qty:true,
  introW:'L’attrezzatura dell’ASD: quantità (con i tasti + e −), scorta minima, stato e dove si trova.',introR:'L’attrezzatura dell’ASD e dove si trova.',
  campi:[{k:'nome',label:'Nome',t:'text',req:1,ph:'Es. Kimono bianchi taglia 140'},{k:'categoria',label:'Categoria',t:'select',opts:CAT,req:1},
    {k:'quantita',label:'Quantità',t:'number',req:1,def:1},{k:'minimo',label:'Scorta minima',t:'number',ph:'Sotto questo numero compare l’avviso'},
    {k:'stato',label:'Stato',t:'select',opts:['Buono','Da riparare','Da sostituire'],req:1},{k:'dove',label:'Dove si trova',t:'text',ph:'Es. Armadio spogliatoio'},{k:'note',label:'Note',t:'textarea'}],
  titolo1:i=>i.nome||'Materiale',sotto:i=>[i.categoria,i.dove].filter(Boolean).join(' · '),
  filtro:{k:'categoria',opts:CAT},ordina:(a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'it',{numeric:true}),
  riga:i=>{const n=Number(i.quantita)||0,m=Number(i.minimo)||0,b=[badge('Quantità: '+n,n===0?'r':'')];
    if(m>0&&n<=m)b.push(badge('Da riordinare','w'));if(i.stato&&i.stato!=='Buono')b.push(badge(i.stato,'w'));
    return {t:i.nome,s:[i.categoria,i.dove].filter(Boolean).join(' · '),b}},
  riepilogo:l=>{const r=l.filter(i=>Number(i.minimo)>0&&(Number(i.quantita)||0)<=Number(i.minimo)).length,g=l.filter(i=>i.stato&&i.stato!=='Buono').length;
    return (r||g)?`<div style="margin-bottom:6px">${r?badge(r+(r===1?' articolo da riordinare':' articoli da riordinare'),'w'):''}${g?badge(g+(g===1?' articolo da riparare o sostituire':' articoli da riparare o sostituire'),'w'):''}</div>`:''}});
