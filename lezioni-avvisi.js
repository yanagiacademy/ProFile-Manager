/* Lezioni → avvisi per la «Prossima lezione» (mail dal Gmail dell'ASD, stesso ponte delle altre notifiche: ponte-mail.gs non cambia).
   • avvisaTecnici: l'admin aggiunge, modifica, accetta o modifica-e-accetta una lezione condivisa → mail a tutti i tecnici
     (tecnico = account non admin con Lezioni in «Lettura», che ha una mail).
   • avvisaUtente: esito di una proposta (accettata, modificata, rifiutata) → mail al tecnico che l'aveva fatta.
   • mailProposteAdmin: i tecnici non possono usare il ponte (è solo per l'admin), quindi le proposte nuove o modificate restano «da avvisare»
     e la mail agli indirizzi admin parte alla prima apertura della suite (Home o Lezioni) da parte dell'admin. Nell'app l'avviso è subito visibile (Home e pagina Lezioni).
   Le mail partono se la Mail è collegata (mail-config.js); se no, restano gli avvisi nell'app. */
import {collection,getDocs,getDoc,doc,query,where,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const RX=/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const fmtD=d=>String(d||'').split('-').reverse().join('/');
const GIORNO=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return '';const g=new Date(d+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long'});return g.charAt(0).toUpperCase()+g.slice(1)};
const ore=n=>n>0?String(n).replace('.',',')+' h':'';

export const testoLezione=it=>[
  GIORNO(it.date)+' '+fmtD(it.date),
  'Maestro: '+(it.master||'—'),
  'Tipologia: '+(it.type||'—'),
  ore(+it.ore)?'Durata: '+ore(+it.ore):'',
  '',
  'Programma della lezione',
  it.piano||'(nessun programma inserito)'].filter((x,i)=>x!==''||i===4).join('\n');

async function motore(){
  let m;try{m=await import('./notifiche-motore.js')}catch(e){return null}
  return (await m.mailPronta())?m:null}
const manda=async(db,m,to,subject,text,chiave)=>{try{const es=await m.inviaDiretta(db,{key:chiave+':'+to+':'+Date.now(),to,subject,text});return !!es.ok}catch(e){console.warn('Mail lezioni:',e&&e.message);return false}};

/* tecnici = account non admin con Lezioni in sola lettura (chi può scrivere è come l'admin) */
export async function elencoTecnici(db){
  const s=await getDocs(collection(db,'users'));
  return s.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!u.admin&&(u.perms||{}).lezioni==='r'&&RX.test(String(u.email||'').trim()))}

/* tipo: 'nuova' | 'modifica'; da = nome del tecnico che l'ha proposta (facoltativo) */
export async function avvisaTecnici(db,{tipo,it,da=''}){
  try{
    const m=await motore();if(!m)return {inviate:0,ko:0,nota:'Mail non collegata: i tecnici vedono l’avviso nell’app.'};
    const t=await elencoTecnici(db);if(!t.length)return {inviate:0,ko:0,nota:'Nessun tecnico con una mail da avvisare.'};
    const nuova=tipo==='nuova',sub=(nuova?'Nuova lezione in programma: ':'Lezione aggiornata: ')+fmtD(it.date)+(it.type?' – '+it.type:'');
    const text=`Buongiorno,\n\n${nuova?'è stata programmata una nuova lezione':'è stata modificata una lezione in programma'}${da?' (su proposta di '+da+')':''}.\n\n${testoLezione(it)}\n\nLa trovi in Lezioni → Prossima lezione.\n\n— Yanagi Academy`;
    let ok=0,ko=0;for(const u of t){(await manda(db,m,String(u.email).trim().toLowerCase(),sub,text,'lezt:'+it.id))?ok++:ko++}
    return {inviate:ok,ko,nota:ko?ko+' mail non partite.':''}}
  catch(e){console.warn('Avviso tecnici:',e&&e.message);return {inviate:0,ko:0,nota:'Avviso ai tecnici per mail non riuscito.'}}}

/* esito di una proposta al tecnico che l'aveva fatta (uid dell'account) */
export async function avvisaUtente(db,uid,{esito,p,motivo=''}){
  try{
    const m=await motore();if(!m)return false;
    const s=await getDoc(doc(db,'users',uid));if(!s.exists())return false;
    const e=String(s.data().email||'').trim().toLowerCase();if(!RX.test(e))return false;
    const parole={accettata:'è stata accettata',modificata:'è stata accettata con alcune modifiche',rifiutata:'non è stata accettata'}[esito]||'è stata valutata';
    const text=`Buongiorno,\n\nla tua proposta di ${p.tipo==='modifica'?'modifica della lezione':'nuova lezione'} del ${fmtD(p.date)} ${parole}.${esito==='rifiutata'&&motivo?'\n\nMotivo: '+motivo:''}\n\n${testoLezione(p)}\n\n— Yanagi Academy`;
    return await manda(db,m,e,'Proposta di lezione '+(esito==='rifiutata'?'rifiutata':'accettata')+': '+fmtD(p.date),text,'lezu:'+p.id)}
  catch(e){console.warn('Avviso proponente:',e&&e.message);return false}}

/* all'admin: proposte dei tecnici ancora «da avvisare» → una mail agli indirizzi admin (Mail → Notifiche) e segno mailAdm. Sicuro da chiamare più volte. */
let giro=false;
export async function mailProposteAdmin(db){
  if(giro)return 0;giro=true;
  try{
    const m=await motore();if(!m)return 0;
    const s=await getDocs(query(collection(db,'lezioniProposte'),where('stato','==','attesa')));
    const nuove=s.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.mailAdm).sort((a,b)=>(a.ts||0)-(b.ts||0));
    if(!nuove.length)return 0;
    const cfg=await m.leggiConfig(db),a=(cfg.indirizziAdmin||[]).filter(x=>RX.test(x));
    if(!a.length)return 0;
    const righe=nuove.map(p=>`• ${p.byName||'Un tecnico'} – ${p.tipo==='modifica'?'modifica della lezione':'nuova lezione'} del ${fmtD(p.date)}${p.type?' ('+p.type+')':''}`).join('\n');
    const text=`Buongiorno,\n\n${nuove.length===1?'c’è una proposta di lezione':'ci sono '+nuove.length+' proposte di lezione'} da valutare:\n\n${righe}\n\nApri Lezioni per accettarle, modificarle o rifiutarle.\n\n— Yanagi Academy`;
    let ok=0;for(const to of a)if(await manda(db,m,to,nuove.length===1?'Proposta di lezione da valutare':nuove.length+' proposte di lezione da valutare',text,'lezp'))ok++;
    if(ok)for(const p of nuove)await updateDoc(doc(db,'lezioniProposte',p.id),{mailAdm:true}).catch(()=>{});
    return ok}
  catch(e){console.warn('Mail proposte lezioni:',e&&e.message);return 0}
  finally{giro=false}}
