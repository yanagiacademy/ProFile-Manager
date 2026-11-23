/* Cassetta medica: contenuto del kit di primo soccorso (articolo, quantità, scadenza, posizione). Evidenzia scaduti e in scadenza entro 60 giorni. */
import {avvia,badge,giorniA,fmtD} from "./scheda-lista.js";
const stScad=i=>{const g=giorniA(i.scadenza);return g===null?null:g<0?'sc':g<=60?'in':'ok'};
avvia({sec:'cassetta-medica',kind:'cassetta',nome:'Cassetta medica',nuovo:'Nuovo articolo',qty:true,
  introW:'Il contenuto della cassetta di primo soccorso: quantità, scadenze e dove si trova. Scaduti e in scadenza (entro 60 giorni) sono evidenziati.',introR:'Il contenuto della cassetta di primo soccorso, con scadenze e posizione.',
  campi:[{k:'nome',label:'Articolo',t:'text',req:1,ph:'Es. Ghiaccio istantaneo'},{k:'quantita',label:'Quantità',t:'number',req:1,def:1},{k:'minimo',label:'Scorta minima',t:'number',ph:'Sotto questo numero compare l’avviso'},
    {k:'scadenza',label:'Scadenza',t:'date'},{k:'dove',label:'Dove si trova',t:'text',ph:'Es. Cassetta in palestra'},{k:'note',label:'Note',t:'textarea'}],
  titolo1:i=>i.nome||'Articolo',sotto:i=>[i.dove,i.scadenza?'scade '+fmtD(i.scadenza):''].filter(Boolean).join(' · '),
  ordina:(a,b)=>(a.scadenza||'9999').localeCompare(b.scadenza||'9999')||String(a.nome||'').localeCompare(String(b.nome||''),'it'),
  riga:i=>{const n=Number(i.quantita)||0,m=Number(i.minimo)||0,s=stScad(i),b=[badge('Quantità: '+n,n===0?'r':'')];
    if(s==='sc')b.push(badge('Scaduto il '+fmtD(i.scadenza),'r'));else if(s==='in')b.push(badge('Scade il '+fmtD(i.scadenza),'w'));else if(s==='ok')b.push(badge('Scade il '+fmtD(i.scadenza),'g'));
    if(m>0&&n<=m)b.push(badge('Da riordinare','w'));return {t:i.nome,s:i.dove||'',b}},
  riepilogo:l=>{const sc=l.filter(i=>stScad(i)==='sc').length,im=l.filter(i=>stScad(i)==='in').length,r=l.filter(i=>Number(i.minimo)>0&&(Number(i.quantita)||0)<=Number(i.minimo)).length;
    return (sc||im||r)?`<div style="margin-bottom:6px">${sc?badge(sc+(sc===1?' articolo scaduto':' articoli scaduti'),'r'):''}${im?badge(im+(im===1?' in scadenza':' in scadenza'),'w'):''}${r?badge(r+' da riordinare','w'):''}</div>`:'<div style="margin-bottom:6px">'+(l.length?badge('Tutto in regola','g'):'')+'</div>'}});
