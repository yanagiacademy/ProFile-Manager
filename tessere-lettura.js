/* Lettura dei dati dal testo ricavato (OCR) dalla copia di una tessera o di un certificato medico.
   Funzione pura, senza DOM: riceve il testo e restituisce i campi riconosciuti. I dati vanno sempre controllati. */
const p2=n=>String(n).padStart(2,'0');
export const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export const title=s=>String(s||'').toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase()).trim();
export const ENTI=['FIJLKAM','UISP','CSEN','ENDAS','OPES','ACSI','AICS','LIBERTAS','CSI','ASI','FILPJ','MSP','USACLI','ACLI'];
/* diciture che identificano l'ente anche quando il suo nome non è scritto nella parte letta */
const MARKER={CSEN:/silver\s*base|centro\s+sportivo\s+educativo/i};
const LABELS=/^[^A-Za-z]*(ASSOCIAZIONE|COGNOME|CODICE|QUALIFICA|SPORT\b|COMITATO|ENTE DI|IL PRESIDENTE|RILASCIO|TESSERA)/i;

/* ---------- date ---------- */
const dateIso=(d,m,y)=>{d=+d;m=+m;y=+y;if(y<100)y+=2000;return (m<1||m>12||d<1||d>31||y<1950||y>2100)?'':y+'-'+p2(m)+'-'+p2(d)};
function dateList(t){
  const low=t.toLowerCase(),re=/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g,out=[];let m;
  while((m=re.exec(t))){
    const iso=dateIso(m[1],m[2],m[3]);if(!iso)continue;
    const from=Math.max(t.lastIndexOf('\n',m.index-1),m.index-45);
    out.push({iso,ctx:low.slice(from<0?0:from,m.index)})}
  return out}
/* scadenza: la data accanto a "scadenza/valido fino al"; se manca, la più recente tra quelle non di nascita né di rilascio (da verificare) */
function pickScad(ds){
  const d=ds.find(x=>/scad|valid|fino al|entro il/.test(x.ctx));
  if(d)return {v:d.iso,dedotta:false};
  const c=ds.filter(x=>!/nasc|nato/.test(x.ctx)&&!/emiss|rilasc|iscriz|affiliaz/.test(x.ctx)).map(x=>x.iso).sort();
  return c.length?{v:c[c.length-1],dedotta:true}:null}

/* ---------- righe etichetta / valore ---------- */
const rows=t=>t.replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
const upperRatio=s=>{const l=s.replace(/[^A-Za-zÀ-ÿ]/g,'');return l?l.replace(/[^A-ZÀ-Þ]/g,'').length/l.length:0};
function clean(v){
  const tk=v.split(/\s+/);
  while(tk.length>1&&/^[^A-Za-z]{1,2}$/.test(tk[0]))tk.shift();
  return tk.join(' ').replace(/^[^A-Za-z0-9]+/,'').replace(/([a-z])(A\.S\.D\.)/,'$1 $2').replace(/([A-Z])(A\.S\.D\.)/,'$1 $2').trim()}
/* il valore sta dopo l'etichetta sulla stessa riga oppure nelle righe sotto (scartando righe-spazzatura e altre etichette) */
function valueAfter(L,re,{max=4}={}){
  for(let i=0;i<L.length;i++){
    const m=L[i].match(re);if(!m)continue;
    const rest=L[i].slice(m.index+m[0].length).replace(/^[\s:\-–]+/,'');
    if(rest.length>2&&!LABELS.test(rest)&&upperRatio(rest)>=.6)return clean(rest);
    for(let j=i+1;j<Math.min(L.length,i+1+max);j++){
      const v=L[j];
      if(LABELS.test(v)||v.replace(/[^A-Za-z0-9]/g,'').length<3||upperRatio(v)<.6||dateList(v).length)continue;
      return clean(v)}}
  return ''}

/* ---------- codice fiscale (con correzione degli errori tipici dell'OCR e controllo del carattere finale) ---------- */
const DIG='0123456789',TOD={O:'0',Q:'0',D:'0',I:'1',L:'1',Z:'2',S:'5',B:'8',G:'6',T:'7'},TOL={'0':'O','1':'I','2':'Z','5':'S','8':'B','6':'G'};
export function fixCF(s){
  s=String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(s.length!==16)return s;
  const dig=[6,7,9,10,12,13,14];
  return s.split('').map((c,i)=>dig.includes(i)?(DIG.includes(c)?c:(TOD[c]||c)):(DIG.includes(c)?(TOL[c]||c):c)).join('')}
const ODD=[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
export function cfOk(cf){
  cf=String(cf||'').toUpperCase();
  if(!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(cf))return false;
  let sum=0;
  for(let i=0;i<15;i++){const c=cf[i],v=DIG.includes(c)?+c:c.charCodeAt(0)-65;sum+=i%2===0?ODD[v]:v}
  return String.fromCharCode(65+sum%26)===cf[15]}

/* scadenza della tessera = data di rilascio + 1 anno - 1 giorno (es. 03/04/2026 -> 02/04/2027) */
export function scadDaEmissione(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return '';
  const [y,m,d]=iso.split('-').map(Number),x=new Date(y+1,m-1,d,12);x.setDate(x.getDate()-1);
  return x.getFullYear()+'-'+p2(x.getMonth()+1)+'-'+p2(x.getDate())}

/* ---------- tessera ---------- */
export function parseTessera(text,atl=[]){
  const t=String(text||'').replace(/\r/g,''),L=rows(t),out={},ds=dateList(t);
  for(const e of ENTI)if(new RegExp('(^|[^A-Za-z])'+e+'([^A-Za-z]|$)').test(t)){out.ente=e;break}
  if(!out.ente)for(const [e,re] of Object.entries(MARKER))if(re.test(t)){out.ente=e;break}
  /* numero tessera: "N. 26B2130741"; in alternativa "tessera n° ..." */
  let m=t.match(/\bN\s*[.°º]\s*([A-Z0-9]{7,14})\b/);
  if(!(m&&/\d{5}/.test(m[1])))m=t.match(/(?:tessera\s*(?:n[.°º]?|numero)|numero\s*tessera|matricola)\s*[:\-]?\s*([A-Z]{0,5}\d[\dA-Z\-\/]{3,14})/i);
  if(m)out.numero=m[1].replace(/[\s]+/g,'').toUpperCase();
  /* tipo tessera: "Tessera Silver BASE" */
  const tp=L.map(x=>x.match(/^Tessera\s+([A-Za-z][^\n]{2,30})$/)).find(Boolean);
  if(tp)out.tipoTessera=clean(tp[1]);
  const em=ds.find(x=>/emiss|rilasc|iscriz|affiliaz|data tessera/.test(x.ctx));if(em)out.emissione=em.iso;
  const sc=pickScad(ds);if(sc){out.scadenza=sc.v;if(sc.dedotta)out.dedotta='data';}
  /* stagione sportiva "25/26" (non confondere con le date gg/mm/aaaa) */
  const sg=t.match(/(?<![\d\/.])(\d{2})\s*\/\s*(\d{2})(?![\d\/.])/);
  if(sg&&+sg[2]===+sg[1]+1)out.stagione=sg[1]+'/'+sg[2];
  /* se la scadenza non è stampata: rilascio + 1 anno - 1 giorno (valore calcolato, da verificare) */
  if(!out.scadenza&&out.emissione){out.scadenza=scadDaEmissione(out.emissione);out.dedotta='rilascio'}
  /* dati stampati con etichetta */
  const ass=valueAfter(L,/ASSOCIAZIONE/i);if(ass)out.associazione=ass;
  const ql=valueAfter(L,/QUALIFICA/i);if(ql)out.qualifica=ql;
  const sp=(()=>{for(let i=0;i<L.length;i++){if(!/\bSPORT\b/.test(L[i])||/ENTE DI|PROMOZIONE|SPORTIV/i.test(L[i]))continue;
    for(let j=i;j<Math.min(L.length,i+3);j++){const k=L[j].split(/\s+/).filter(w=>/^[A-Z0-9]{4,6}$/.test(w)&&/\d/.test(w)&&!/^\d+$/.test(w)&&w!==out.numero);if(k.length)return k[k.length-1]}}return ''})();
  if(sp)out.sport=sp;
  /* comitato / codice affiliazione: "ASCOLI PICENO APS 60915" */
  const ci=L.findIndex(x=>/COMITATO/i.test(x)&&/AFF/i.test(x));
  if(ci>=0)for(let j=ci;j<Math.min(L.length,ci+7);j++){const lj=L[j].replace(/\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}/g,' ').replace(/Rilascio/gi,' '),mm=lj.match(/([A-Z][A-Z' .]{3,}?)\s+(\d{4,6})\s*$/);if(mm&&!/^N\./.test(lj.trim())){out.comitato=clean(mm[1]);out.codAff=mm[2];break}}
  /* codice fiscale */
  let cf=fixCF(valueAfter(L,/CODICE\s+FISCALE/i));
  if(cf.length!==16){const c=(t.toUpperCase().match(/\b[A-Z0-9]{16}\b/g)||[]).map(fixCF).find(x=>/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(x));cf=c||''}
  if(cf){out.cf=cf;out.cfValido=cfOk(cf)}
  /* nome: "COGNOME E NOME" = cognome per primo */
  const cn=valueAfter(L,/COGNOME\s+E\s+NOME/i);
  if(cn){const tk=cn.split(/\s+/);out.cognomeRil=title(tk[0]);out.nomeRil=title(tk.slice(1).join(' '))}
  const full=norm(cn||t);let best=null;
  atl.forEach(a=>{const c=norm(a.cognome),n=norm(a.nome);if(c&&n&&full.includes(c)&&full.includes(n))best=a});
  if(best)out.atleta=best.id;
  return out}

/* ---------- certificato medico ---------- */
export function parseCert(text){
  const t=String(text||'').replace(/\r/g,''),out={},sc=pickScad(dateList(t));
  if(sc){out.certScad=sc.v;if(sc.dedotta)out.dedotta='data'}
  if(/non\s+agonistic/i.test(t))out.certTipo='non agonistico';else if(/agonistic/i.test(t))out.certTipo='agonistico';
  return out}
