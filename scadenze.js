/* Scadenze dei documenti: logica condivisa da Home, Documenti e Documenti in scadenza.
   Un file di Documenti con il campo "scadenza" (AAAA-MM-GG) compare in "Documenti in scadenza" quando mancano 30 giorni o meno (anche se è già scaduto). */
export const SOGLIA=30;
export const isD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
const oggi=()=>{const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate())};
export const giorni=d=>isD(d)?Math.round((new Date(d+'T00:00:00')-oggi())/864e5):null;
export const inScadenza=i=>!!i&&i.kind==='file'&&!i.archiviatoIl&&isD(i.scadenza)&&giorni(i.scadenza)<=SOGLIA;
export const fmtD=d=>String(d||'').split('-').reverse().join('/');
export const testo=g=>g===null?'':g<0?'scaduto da '+(-g)+(g===-1?' giorno':' giorni'):g===0?'scade oggi':g===1?'scade domani':'scade tra '+g+' giorni';
export const pill=g=>g===null?'':g<0?'Scaduto da '+(-g)+' g':g===0?'Oggi':g===1?'1 giorno':g+' giorni';
