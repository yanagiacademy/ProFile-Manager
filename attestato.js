/* attestato.js – Diploma di graduazione (Settore Judo) in PDF, con l'aspetto dell'esempio di Yanagi Academy.
   Si disegna su un canvas (sfondo con cornice, logo CSEN, foglie, firma) e il JPEG ottenuto va in un PDF a una pagina
   scritto a mano qui sotto: nessuna libreria da scaricare. I testi variabili sono solo tre: il grado, il nome e la data.
   Font come nell'esempio (Google Fonts, già usato dal sito): League Spartan, Poppins, Open Sans, Bree Serif.
   Se i font non si caricano, si usano quelli di sistema e l'attestato si crea lo stesso. */
import {gradoByLiv} from "./gradi.js";

export const LUOGO='Grottammare',PRESIDENTE='Loris Antolini Mascitti';
const W=2160,H=1670,K=W/1233;                 /* le misure sotto sono prese sull'esempio largo 1233 px */
const FONTS='https://fonts.googleapis.com/css2?family=Bree+Serif&family=League+Spartan:wght@700&family=Open+Sans:wght@400&family=Poppins:wght@700&display=swap';
const F={sp:'"League Spartan","Poppins",Arial,sans-serif',po:'Poppins,Arial,sans-serif',os:'"Open Sans",Arial,sans-serif',br:'"Bree Serif",Georgia,serif'};

const img=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('IMG '+src));i.src=src});
const timeout=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(r,ms))]);
let fontsOk=null;
function caricaFont(testo){
  if(!fontsOk){fontsOk=new Promise(res=>{
    if(document.querySelector('link[data-att-font]'))return res();
    const l=document.createElement('link');l.rel='stylesheet';l.href=FONTS;l.dataset.attFont='1';l.onload=res;l.onerror=res;document.head.append(l);setTimeout(res,6000)})}
  return fontsOk.then(()=>timeout(Promise.all([
    document.fonts.load('700 60px "League Spartan"','YANAGI ACADEMY'),
    document.fonts.load('700 60px Poppins','DIPLOMA DI GRADUAZIONE SETTORE JUDO CONFERITO A'),
    document.fonts.load('400 40px "Open Sans"',testo),
    document.fonts.load('400 80px "Bree Serif"',testo)]).catch(()=>{}),7000))}

/* "5 kyu" + "gialla" → GRADO 5° KIŪ - CINTURA GIALLA */
export function rigaGrado(g){
  const m=String(g.nome).match(/^(\d+)\s*(kyu|dan)$/i);
  return ('GRADO '+(m?m[1]+'° '+(m[2].toLowerCase()==='kyu'?'KIŪ':'DAN'):g.nome)+' - CINTURA '+g.cint).toUpperCase()}
export const dataIT=iso=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:''};

/* ritaglia sul riquadro (x,y,w,h in px dell'esempio) senza deformare */
function dentro(c,im,x,y,w,h,ax=.5){const r=Math.min(w/im.width,h/im.height),dw=im.width*r,dh=im.height*r;
  c.drawImage(im,(x+(w-dw)*ax)*K,(y+(h-dh)/2)*K,dw*K,dh*K)}

export async function disegnaAttestato({nome,cognome,liv,data}){
  const g=gradoByLiv(liv);if(!g)throw new Error('GRADO');
  const full=(String(nome||'').trim()+' '+String(cognome||'').trim()).trim().toUpperCase(),riga=rigaGrado(g),dt=dataIT(data);
  await caricaFont(riga+' '+full+' '+LUOGO);
  const [bg,csen,fog,fir]=await Promise.all(['attestato-sfondo.jpg','attestato-csen.png','attestato-foglie.png','attestato-firma.png'].map(img));
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
  c.drawImage(bg,0,0,W,H);
  /* dimensione del carattere tale che il testo dell'esempio occupi la larghezza misurata; poi si rimpicciolisce se il testo vero è più lungo */
  const size=(fam,wt,esempio,larg)=>{c.font=wt+' 100px '+fam;return 100*larg*K/c.measureText(esempio).width};
  const centro=(t,fam,wt,sz,cy,col,maxW)=>{c.font=wt+' '+sz+'px '+fam;let s=sz;const w=c.measureText(t).width;if(maxW&&w>maxW*K){s=sz*maxW*K/w;c.font=wt+' '+s+'px '+fam}
    c.fillStyle=col;c.textAlign='center';c.textBaseline='alphabetic';const cap=c.measureText('H').actualBoundingBoxAscent;c.fillText(t,W/2,cy*K+cap/2)};
  centro('YANAGI ACADEMY',F.sp,700,size(F.sp,700,'YANAGI ACADEMY',489),195,'#000');
  const pd=size(F.po,700,'DIPLOMA DI GRADUAZIONE',650);
  centro('DIPLOMA DI GRADUAZIONE',F.po,700,pd,355,'#000');
  centro('SETTORE JUDO',F.po,700,pd,421,'#000');
  centro(riga,F.os,400,size(F.os,400,'GRADO 5° KIŪ - CINTURA GIALLA',610),500,'#000',760);
  centro('CONFERITO A',F.po,700,size(F.po,700,'CONFERITO A',323),578,'#000');
  centro(full,F.br,400,size(F.br,400,'DAWID S. WASICKI',700),690,'#FF3131',800);
  /* logo e foglie */
  dentro(c,csen,160,158,153,153);dentro(c,fog,918,160,158,155);
  /* data, luogo, presidente e firma */
  const s2=size(F.os,400,'Loris Antolini Mascitti',275);c.font='400 '+s2+'px '+F.os;c.fillStyle='#000';c.textAlign='left';c.textBaseline='alphabetic';
  const cap=c.measureText('H').actualBoundingBoxAscent;
  c.fillText(LUOGO+(dt?' '+dt:''),172*K,788*K+cap/2);c.fillText('Il presidente',728*K,785*K+cap/2);c.fillText(PRESIDENTE,670*K,828*K+cap/2);
  dentro(c,fir,676,768,252,98,0);
  return cv}

/* PDF a una pagina con il JPEG a tutta pagina (misure in punti: 792 × 612,3 ≈ Letter, come l'esempio) */
export function jpegInPdf(jpg,wpx,hpx,titolo){
  const pw=792,ph=Math.round(pw*hpx/wpx*100)/100,enc=new TextEncoder(),parts=[],off=[];let len=0;
  const put=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);len+=b.length};
  const obj=(n,fn)=>{off[n]=len;put(n+' 0 obj\n');fn();put('\nendobj\n')};
  put(new Uint8Array([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));
  obj(1,()=>put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2,()=>put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3,()=>put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pw+' '+ph+'] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>'));
  obj(4,()=>{put('<< /Type /XObject /Subtype /Image /Width '+wpx+' /Height '+hpx+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n');put(jpg);put('\nendstream')});
  const cs='q '+pw+' 0 0 '+ph+' 0 0 cm /Im0 Do Q';
  obj(5,()=>put('<< /Length '+cs.length+' >>\nstream\n'+cs+'\nendstream'));
  const hex='FEFF'+[...String(titolo||'Attestato')].map(ch=>ch.charCodeAt(0).toString(16).padStart(4,'0')).join('').toUpperCase();
  obj(6,()=>put('<< /Title <'+hex+'> /Producer (ProFile Manager) >>'));
  const xr=len;put('xref\n0 7\n0000000000 65535 f \n');for(let n=1;n<=6;n++)put(String(off[n]).padStart(10,'0')+' 00000 n \n');
  put('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n'+xr+'\n%%EOF');
  return new Blob(parts,{type:'application/pdf'})}

/* attestato pronto da scaricare: Blob PDF */
export async function attestatoPdf(d){
  const cv=await disegnaAttestato(d);
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.93));
  if(!blob)throw new Error('JPEG');
  const g=gradoByLiv(d.liv);
  return jpegInPdf(new Uint8Array(await blob.arrayBuffer()),cv.width,cv.height,'Attestato '+(d.nome||'')+' '+(d.cognome||'')+' - '+g.nome+' '+g.cint)}
export const nomeFile=(d)=>{const g=gradoByLiv(d.liv);return ('Attestato '+(d.cognome||'')+' '+(d.nome||'')+' - '+g.nome+' '+g.cint+'.pdf').replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ')}
