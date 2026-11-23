/* Calendario timeline: la stagione in linea del tempo (gare, esami, stage, scadenze…), per mese, con il marcatore «Oggi». I passati si aprono con un tasto. */
import {avvia,esc,badge,fmtD,oggiISO} from "./scheda-lista.js";
const CAT=['Gara','Esame','Stage','Allenamento straordinario','Scadenza','Evento','Altro'];
const fine=i=>i.dataFine&&i.dataFine>=i.data?i.dataFine:i.data;
const mese=d=>new Date(d+'T00:00:00').toLocaleDateString('it-IT',{month:'long',year:'numeric'});
avvia({sec:'calendario-timeline',kind:'tappa',nome:'Calendario timeline',nuovo:'Nuova tappa',
  introW:'La stagione in linea del tempo: aggiungi gare, esami, stage e scadenze con la data. Gli appuntamenti passati si aprono con il tasto in alto.',introR:'La stagione in linea del tempo: gare, esami, stage e scadenze.',
  campi:[{k:'titolo',label:'Titolo',t:'text',req:1,ph:'Es. Trofeo Città di…'},{k:'data',label:'Data (inizio)',t:'date',req:1},{k:'dataFine',label:'Data di fine',t:'date'},
    {k:'categoria',label:'Categoria',t:'select',opts:CAT,req:1},{k:'luogo',label:'Luogo',t:'text'},{k:'note',label:'Note',t:'textarea'}],
  titolo1:i=>i.titolo||'Tappa',sotto:i=>[i.categoria,i.luogo].filter(Boolean).join(' · '),
  valida:D=>D.dataFine&&D.dataFine<D.data?'La data di fine non può essere prima di quella di inizio.':'',
  filtro:{k:'categoria',opts:CAT},
  render:(l,stato)=>{
    const oggi=oggiISO(),ord=[...l].sort((a,b)=>(a.data||'').localeCompare(b.data||'')),pas=ord.filter(i=>fine(i)<oggi),fut=ord.filter(i=>fine(i)>=oggi);
    const voce=(i,p)=>{const d=i.dataFine&&i.dataFine>i.data?fmtD(i.data)+' – '+fmtD(i.dataFine):fmtD(i.data);
      return `<button class="tli${p?' pas':''}" data-id="${esc(i.id)}"><b>${esc(i.titolo)}</b><span class="mu">${esc(d)}${i.luogo?' · '+esc(i.luogo):''}</span><span>${badge(i.categoria||'Altro')}</span></button>`};
    const gruppi=(a,p)=>{let m='',h='';for(const i of a){const k=mese(i.data);if(k!==m){m=k;h+=`<h3>${esc(k)}</h3>`}h+=voce(i,p)}return h};
    return (pas.length?`<button class="btn ghost sm" data-pas="1" style="margin-bottom:6px">${stato.passati?'Nascondi':'Mostra'} passati (${pas.length})</button>`:'')+
      `<div class="tl">${stato.passati?gruppi(pas,true):''}<div class="tod">Oggi · ${esc(fmtD(oggi))}</div>${fut.length?gruppi(fut,false):'<div class="mu">Nessun appuntamento in programma.</div>'}</div>`}});
