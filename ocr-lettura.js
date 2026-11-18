/* Lettura del testo da una foto o da un PDF, nel browser (Tesseract.js + pdf.js, italiano, gratuita). Stesso motore della lettura delle tessere in Tessere. */
const loadJs=src=>new Promise((res,rej)=>{const e=document.createElement('script');e.src=src;e.onload=res;e.onerror=()=>rej(new Error('LOAD'));document.head.append(e)});
let tessP=null;
const loadTess=()=>tessP||(tessP=loadJs('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js').then(()=>window.Tesseract).catch(e=>{tessP=null;throw e}));
const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
/* foto: ridimensionata a una misura comoda per la lettura */
async function imgCanvas(file){
  const bmp=await createImageBitmap(file),m=Math.max(bmp.width,bmp.height),k=m>3000?3000/m:(m<1800?Math.min(2,1800/m):1),c=document.createElement('canvas');
  c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(bmp,0,0,c.width,c.height);return c}
/* PDF: se ha il testo lo usa direttamente, altrimenti disegna la prima pagina per leggerla come una foto */
async function pdfCanvas(file){
  if(!window.pdfjsLib){await loadJs(PDFJS+'pdf.min.js');window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js'}
  const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,page=await pdf.getPage(1);
  let text='';
  try{
    const its=(await page.getTextContent()).items.filter(i=>i.str&&i.str.trim()).sort((a,b)=>(b.transform[5]-a.transform[5])||(a.transform[4]-b.transform[4]));
    let y=null;its.forEach(i=>{const yy=Math.round(i.transform[5]);text+=(y===null?'':Math.abs(yy-y)>3?'\n':' ')+i.str;y=yy})}catch(e){}
  const v1=page.getViewport({scale:1}),k=Math.min(5,Math.max(1,2600/v1.width)),vp=page.getViewport({scale:k}),c=document.createElement('canvas');
  c.width=Math.round(vp.width);c.height=Math.round(vp.height);
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:x,viewport:vp}).promise;
  return {canvas:c,text}}
/* toglie i margini bianchi (una tessera stampata su un foglio A4 occupa una piccola parte della pagina) */
function cropContent(c){
  const k=Math.min(1,500/c.width),w=Math.max(1,Math.round(c.width*k)),h=Math.max(1,Math.round(c.height*k)),t=document.createElement('canvas');
  t.width=w;t.height=h;const x=t.getContext('2d');x.drawImage(c,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=-1,y1=-1;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const p=(j*w+i)*4;if(Math.min(d[p],d[p+1],d[p+2])<235){if(i<x0)x0=i;if(i>x1)x1=i;if(j<y0)y0=j;if(j>y1)y1=j}}
  if(x1<0||(x1-x0+1)*(y1-y0+1)>.9*w*h)return c;
  const px=Math.round(w*.02),py=Math.round(h*.02),X0=Math.max(0,x0-px)/w*c.width,Y0=Math.max(0,y0-py)/h*c.height,X1=Math.min(w,x1+px+1)/w*c.width,Y1=Math.min(h,y1+py+1)/h*c.height;
  const o=document.createElement('canvas');o.width=Math.round(X1-X0);o.height=Math.round(Y1-Y0);o.getContext('2d').drawImage(c,X0,Y0,o.width,o.height,0,0,o.width,o.height);return o}
export async function ocrFile(file,say=()=>{}){
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  let canvas,text='';
  if(isPdf){say('Apertura del PDF…');({canvas,text}=await pdfCanvas(file));if(text.replace(/\s/g,'').length>40)return text}
  else{say('Preparazione dell’immagine…');canvas=await imgCanvas(file)}
  const T=await loadTess(),img=await new Promise(r=>cropContent(canvas).toBlob(r,'image/png'));
  say('Lettura del testo (la prima volta scarica il dizionario italiano, può servire un minuto)…');
  const w=await T.createWorker('ita',1,{logger:m=>{if(m.status==='recognizing text')say('Lettura in corso '+Math.round(m.progress*100)+'%')}});
  try{await w.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});return (await w.recognize(img)).data.text||''}finally{await w.terminate()}}
