/* Ricevute ASD (scheda Commercialista → Ricevute ASD).
   Disegna il modulo a ricevuta (copia VERDE = resta all'ASD, copia BLU = va al cliente) su un canvas, con i dati scritti nei campi,
   l'importo in lettere e una delle tre firme digitali; produce il PDF (A5 orizzontale) della copia.
   I modelli sono ricevuta-verde.jpg e ricevuta-blu.jpg (850x476), le firme firma-1.png … firma-3.png (inchiostro su fondo trasparente). */

const W=850,H=476,S=2;                       /* misure del modello; il canvas è disegnato a doppia risoluzione */
const INK='#10163a';
export const FIRME=['firma-1.png','firma-2.png','firma-3.png'];
const FONT=(px,st='')=>(st?st+' ':'')+px+'px "Segoe UI",Arial,Helvetica,sans-serif';
const p2=n=>String(n).padStart(2,'0');
const fmtD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.split('-').reverse().join('/'):'';

/* ---------- importo in lettere (italiano) ---------- */
const U=['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici','tredici','quattordici','quindici','sedici','diciassette','diciotto','diciannove'];
const T=['','','venti','trenta','quaranta','cinquanta','sessanta','settanta','ottanta','novanta'];
function sotto1000(n){                         /* n da 1 a 999 */
  const c=Math.floor(n/100),r=n%100;let s='';
  if(c)s=c===1?'cento':U[c]+'cento';
  if(r){
    if(r<20)s+=U[r];
    else{
      const d=Math.floor(r/10),u=r%10;let t=T[d];
      if(c&&d===8)s=s.slice(0,-1);              /* cent + ottanta = centottanta */
      if(u===1||u===8)t=t.slice(0,-1);           /* vent + uno = ventuno, trent + otto = trentotto */
      s+=t+(u?U[u]:'')}}
  return s}
function inParole(n){                          /* intero da 0 a 999.999.999 */
  if(n===0)return 'zero';
  let s='';
  const mil=Math.floor(n/1e6),mig=Math.floor((n%1e6)/1000),r=n%1000;
  if(mil)s+=mil===1?'un milione ':sotto1000(mil)+' milioni ';
  if(mig)s+=mig===1?'mille':sotto1000(mig)+'mila';
  if(r)s+=sotto1000(r);
  s=s.trim();
  if(n>3&&n%10===3)s=s.replace(/tre$/,'tré');   /* ventitré, centotré */
  return s}
export function importoInLettere(cent){
  cent=Math.round(Number(cent));
  if(!(cent>0)||cent>=1e11)return '';
  const e=Math.floor(cent/100),c=cent%100;
  let s=(e===1?'un':inParole(e))+' euro';
  if(c)s+=' e '+(c===1?'un':inParole(c))+' '+(c===1?'centesimo':'centesimi');
  return s.charAt(0).toUpperCase()+s.slice(1)}

/* ---------- firma: una a caso, scartando l'ultima usata ---------- */
const scegli=(escl)=>{const o=FIRME.map((_,i)=>i).filter(i=>!escl.includes(i));return o.length?o[Math.floor(Math.random()*o.length)]:0};
export const prossimaFirma=ultima=>scegli(Number.isInteger(ultima)?[ultima]:[]);
export const altraFirma=(corrente,ultima)=>scegli([corrente,...(Number.isInteger(ultima)?[ultima]:[])]);

/* ---------- immagini ---------- */
const cache={};
const img=src=>cache[src]||(cache[src]=new Promise((ok,ko)=>{
  const i=new Image();i.onload=()=>ok(i);i.onerror=()=>{delete cache[src];ko(new Error('Immagine non trovata: '+src))};i.src=src}));

/* ---------- misura della causale: nel modulo entrano due righe ---------- */
let _m=null;
const mctx=()=>_m||(_m=document.createElement('canvas').getContext('2d'));
const PER_MAX=[690,714];                       /* larghezza delle due righe del «Per» */
export function righePer(testo){
  const x=mctx();x.font=FONT(17);
  const parole=String(testo||'').replace(/\s+/g,' ').trim().split(' ').filter(Boolean),L=[''];let ok=true;
  for(const p of parole){
    const i=L.length-1,cand=L[i]?L[i]+' '+p:p;
    if(x.measureText(cand).width<=PER_MAX[i]){L[i]=cand;continue}
    if(L[i]===''){ok=false;L[i]=p;continue}      /* parola più larga della riga */
    if(i===1){ok=false;break}
    L.push(p);if(x.measureText(p).width>PER_MAX[1])ok=false}
  return {righe:L,ok}}

/* ---------- disegno ---------- */
/* d = {num, data (AAAA-MM-GG), da, dett:[riga2,riga3], cent, lett, per, firma (0-2)}; copia = 'verde' | 'blu' */
export async function disegna(d,copia){
  const [bg,fi]=await Promise.all([img(copia==='blu'?'ricevuta-blu.jpg':'ricevuta-verde.jpg'),Number.isInteger(d.firma)&&FIRME[d.firma]?img(FIRME[d.firma]):null]);
  const c=document.createElement('canvas');c.width=W*S;c.height=H*S;
  const x=c.getContext('2d');x.scale(S,S);x.imageSmoothingQuality='high';x.drawImage(bg,0,0,W,H);
  x.fillStyle=INK;x.textBaseline='alphabetic';
  const put=(t,px,X,Y,max,st='',al='left')=>{
    t=String(t??'');if(!t)return;
    let s=px;x.font=FONT(s,st);while(s>9&&x.measureText(t).width>max){s-=.5;x.font=FONT(s,st)}
    x.textAlign=al;x.fillText(t,X,Y)};
  put(d.num,22,505,92,88,'bold');                                  /* N. */
  put(fmtD(d.data),18,640,92,138);                                 /* Data */
  put(d.da,18,535,152,252);                                        /* Ricevuto da */
  (d.dett||[]).slice(0,2).forEach((t,i)=>put(t,15,458,187+35*i,328));
  put(d.lett,17,148,267,636,'italic');                             /* importo in lettere */
  const pr=righePer(d.per).righe;                                  /* Per */
  x.font=FONT(17);x.textAlign='left';
  if(pr[0])x.fillText(pr[0],100,307);
  if(pr[1])x.fillText(pr[1],76,340);
  const cent=Math.round(Number(d.cent)||0);                        /* importo in cifre: euro | centesimi */
  if(cent>0){
    put(Math.floor(cent/100).toLocaleString('it-IT'),22,343,392,196,'bold','right');
    put(p2(cent%100),22,393,392,76,'bold','center')}
  if(fi){                                                          /* firma, appoggiata sulla riga «Firma» */
    const bw=250,bh=62,k=Math.min(bw/fi.naturalWidth,bh/fi.naturalHeight),w=fi.naturalWidth*k,h=fi.naturalHeight*k;
    x.drawImage(fi,690-w/2,405-h,w,h);x.drawImage(fi,690-w/2,405-h,w,h)}   /* due volte: il tratto sottile resta ben leggibile */
  return c}

/* ---------- PDF (A5 orizzontale con la ricevuta in pagina) ---------- */
export function pdfDaCanvas(canvas){
  return new Promise((ok,ko)=>canvas.toBlob(async b=>{
    try{
      if(!b)throw new Error('Immagine non generata');
      const jpg=new Uint8Array(await b.arrayBuffer()),w=canvas.width,h=canvas.height;
      const PW=595.28,PH=419.53,M=20,iw=PW-2*M,ih=iw*h/w,iy=(PH-ih)/2;
      const enc=new TextEncoder(),parts=[],offs=[];let len=0;
      const push=u=>{parts.push(u);len+=u.length},txt=s=>push(enc.encode(s));
      const obj=(n,body)=>{offs[n]=len;txt(n+' 0 obj\n'+body+'\nendobj\n')};
      txt('%PDF-1.4\n');
      obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
      obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PW+' '+PH+'] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
      offs[4]=len;
      txt('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+w+' /Height '+h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n');
      push(jpg);txt('\nendstream\nendobj\n');
      const cs='q '+iw.toFixed(2)+' 0 0 '+ih.toFixed(2)+' '+M+' '+iy.toFixed(2)+' cm /Im0 Do Q';
      obj(5,'<< /Length '+cs.length+' >>\nstream\n'+cs+'\nendstream');
      const xr=len;let t='xref\n0 6\n0000000000 65535 f \n';
      for(let i=1;i<=5;i++)t+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
      txt(t+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xr+'\n%%EOF');
      ok(new Blob(parts,{type:'application/pdf'}))
    }catch(e){ko(e)}},'image/jpeg',0.93))}
