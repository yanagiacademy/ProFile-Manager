/* gruppi-atleti.js – gruppi di atleti: selezione negli elenchi (destinatari di Eventi e Calendario, presenti in Lezioni) e REGOLE di gruppo (Calendario).
   Criteri (si combinano: l'atleta deve rispettarli tutti):
     • Tipologia: Pre-agonista, Dilettante, Agonista (campo «tipo» della scheda Atleti: preagonista | dilettante | agonista)
     • Grado: da – a (categorie di gradi.js, dal 6 kyu al 10 dan; senza grado in scheda non rientra se si indica un grado)
     • Corso: Kata, Judo kids, Judo (campo «corsi» della scheda Atleti: un atleta può seguirne più d'uno)
   «Aggiungi il gruppo» spunta tutti gli atleti che corrispondono, senza togliere quelli già spuntati; «Togli il gruppo» li toglie (scorciatoia: salva i singoli atleti).
   REGOLA (Calendario): la voce salva i criteri {tipo,da,a,corso} in «regola» con perRegola:true; l'atleta la vede da solo se la sua scheda li rispetta, anche se entra dopo.
   La scheda dell'atleta arriva all'account tramite atletiEmail/<email>.profili = [{tipo,grado,corsi}] (scritto da atleti.js, vedi profiliOf). */
import {GRADI,gradoLabel,livDaGrado} from "./gradi.js";
export const TIPI=[['preagonista','Pre-agonista'],['dilettante','Dilettante'],['agonista','Agonista']];
export const TIPO_LAB=Object.fromEntries(TIPI);
export const CORSI=['Kata','Judo kids','Judo'];
export const corsiDi=a=>Array.isArray(a&&a.corsi)?a.corsi:[];
export const filtroVuoto=f=>!f||(!f.tipo&&!f.da&&!f.a&&!f.corso);
export function corrisponde(a,f){
  if(!a||!f)return false;
  if(f.tipo&&a.tipo!==f.tipo)return false;
  if(f.da||f.a){const l=livDaGrado(a.grado);if(!l||(f.da&&l<f.da)||(f.a&&l>f.a))return false}
  if(f.corso&&!corsiDi(a).includes(f.corso))return false;
  return true}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gradi=()=>GRADI.map(g=>`<option value="${g.liv}">${esc(gradoLabel(g))}</option>`).join('');
const nomeGrado=l=>{const g=GRADI.find(x=>x.liv===+l);return g?gradoLabel(g):''};
/* «Agonista · grado 4° kyu – 1° dan · corso Judo» */
export function regolaTxt(f){
  f=f||{};const p=[];
  if(f.tipo)p.push(TIPO_LAB[f.tipo]||f.tipo);
  if(f.da||f.a)p.push('grado '+(f.da&&f.a?nomeGrado(f.da)+' – '+nomeGrado(f.a):f.da?'da '+nomeGrado(f.da):'fino a '+nomeGrado(f.a)));
  if(f.corso)p.push('corso '+f.corso);
  return p.join(' · ')}
/* i quattro criteri; attr = nome dell'attributo che li identifica (data-g per «Seleziona per gruppo», data-r per la regola) */
export const criteriHtml=(attr='data-g')=>`<label>Tipologia</label><select ${attr}="tipo"><option value="">Qualsiasi</option>${TIPI.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div style="min-width:0"><label>Grado da</label><select ${attr}="da"><option value="">Qualsiasi</option>${gradi()}</select></div><div style="min-width:0"><label>Grado a</label><select ${attr}="a"><option value="">Qualsiasi</option>${gradi()}</select></div></div>
  <label>Corso</label><select ${attr}="corso"><option value="">Qualsiasi</option>${CORSI.map(c=>`<option>${c}</option>`).join('')}</select>`;
export const leggiCriteri=(root,attr='data-g')=>{const v=k=>root.querySelector('['+attr+'='+k+']').value;return {tipo:v('tipo'),da:+v('da')||0,a:+v('a')||0,corso:v('corso')}};
export const scriviCriteri=(root,f,attr='data-g')=>{f=f||{};const s=(k,v)=>{root.querySelector('['+attr+'='+k+']').value=v||''};s('tipo',f.tipo);s('da',f.da);s('a',f.a);s('corso',f.corso)};
/* messaggio se i criteri non vanno bene, altrimenti '' */
export const erroreCriteri=f=>filtroVuoto(f)?'Scegli almeno un criterio.':(f.da&&f.a&&f.da>f.a?'Il grado «da» deve essere uguale o inferiore al grado «a».':'');
/* dati da salvare nella voce: solo i criteri usati */
export const pulisciCriteri=f=>{const o={};if(f.tipo)o.tipo=f.tipo;if(f.da)o.da=f.da;if(f.a)o.a=f.a;if(f.corso)o.corso=f.corso;return o};

export const gruppiHtml=()=>`<details class="gx" style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;min-height:40px;display:flex;align-items:center">Seleziona per gruppo</summary>
  <div style="padding-bottom:6px"><div class="mu" style="margin:2px 0 6px">Scegli uno o più criteri e premi «Aggiungi»: si spuntano tutti gli atleti che li rispettano.</div>
  ${criteriHtml('data-g')}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn ghost sm" data-g="add">Aggiungi il gruppo</button><button type="button" class="btn ghost sm" data-g="del">Togli il gruppo</button></div>
  <div class="mu" data-g="esito" role="status" style="margin-top:6px"></div></div></details>`;
/* root = contenitore con gruppiHtml(); atleti() = elenco delle schede atleta; getSel() = Set degli id spuntati; dopo(corrispondenti, aggiunti) = ridisegna l'elenco */
export function gruppiBind(root,{atleti,getSel,dopo}){
  const esito=t=>{root.querySelector('[data-g=esito]').textContent=t};
  const applica=agg=>{
    const f=leggiCriteri(root,'data-g'),er=erroreCriteri(f);
    if(er){esito(er);return}
    const m=atleti().filter(a=>corrisponde(a,f)),sel=getSel();
    if(!m.length){esito('Nessun atleta corrisponde. Controlla che nelle schede Atleti siano compilati tipologia, grado e corsi.');return}
    m.forEach(a=>agg?sel.add(a.id):sel.delete(a.id));
    const n=m.length;dopo(m,agg);esito(n+(n===1?' atleta ':' atleti ')+(agg?(n===1?'aggiunto alla selezione.':'aggiunti alla selezione.'):(n===1?'tolto dalla selezione.':'tolti dalla selezione.')))};
  root.querySelector('[data-g=add]').onclick=()=>applica(true);root.querySelector('[data-g=del]').onclick=()=>applica(false)}
