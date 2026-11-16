/* gruppi-atleti.js – selezione di GRUPPI di atleti negli elenchi (destinatari di Eventi e Calendario, presenti in Lezioni).
   Criteri (si combinano: l'atleta deve rispettarli tutti):
     • Tipologia: Pre-agonista, Dilettante, Agonista (campo «tipo» della scheda Atleti: preagonista | dilettante | agonista)
     • Grado: da – a (categorie di gradi.js, dal 6 kyu al 10 dan; senza grado in scheda non rientra se si indica un grado)
     • Corso: Kata, Judo kids, Judo (campo «corsi» della scheda Atleti: un atleta può seguirne più d'uno)
   «Aggiungi» spunta tutti gli atleti che corrispondono, senza togliere quelli già spuntati; «Togli» li toglie dalla selezione. */
import {GRADI,gradoLabel,livDaGrado} from "./gradi.js";
export const TIPI=[['preagonista','Pre-agonista'],['dilettante','Dilettante'],['agonista','Agonista']];
export const TIPO_LAB=Object.fromEntries(TIPI);
export const CORSI=['Kata','Judo kids','Judo'];
export const corsiDi=a=>Array.isArray(a&&a.corsi)?a.corsi:[];
export const filtroVuoto=f=>!f.tipo&&!f.da&&!f.a&&!f.corso;
export function corrisponde(a,f){
  if(f.tipo&&a.tipo!==f.tipo)return false;
  if(f.da||f.a){const l=livDaGrado(a.grado);if(!l||(f.da&&l<f.da)||(f.a&&l>f.a))return false}
  if(f.corso&&!corsiDi(a).includes(f.corso))return false;
  return true}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gradi=()=>GRADI.map(g=>`<option value="${g.liv}">${esc(gradoLabel(g))}</option>`).join('');
export const gruppiHtml=()=>`<details class="gx" style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;min-height:40px;display:flex;align-items:center">Seleziona per gruppo</summary>
  <div style="padding-bottom:6px"><div class="mu" style="margin:2px 0 6px">Scegli uno o più criteri e premi «Aggiungi»: si spuntano tutti gli atleti che li rispettano.</div>
  <label>Tipologia</label><select data-g="tipo"><option value="">Qualsiasi</option>${TIPI.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div style="min-width:0"><label>Grado da</label><select data-g="da"><option value="">Qualsiasi</option>${gradi()}</select></div><div style="min-width:0"><label>Grado a</label><select data-g="a"><option value="">Qualsiasi</option>${gradi()}</select></div></div>
  <label>Corso</label><select data-g="corso"><option value="">Qualsiasi</option>${CORSI.map(c=>`<option>${c}</option>`).join('')}</select>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn ghost sm" data-g="add">Aggiungi il gruppo</button><button type="button" class="btn ghost sm" data-g="del">Togli il gruppo</button></div>
  <div class="mu" data-g="esito" role="status" style="margin-top:6px"></div></div></details>`;
/* root = contenitore con gruppiHtml(); atleti() = elenco delle schede atleta; getSel() = Set degli id spuntati; dopo(corrispondenti, aggiunti) = ridisegna l'elenco */
export function gruppiBind(root,{atleti,getSel,dopo}){
  const $=k=>root.querySelector('[data-g='+k+']'),esito=t=>{$('esito').textContent=t};
  const leggi=()=>({tipo:$('tipo').value,da:+$('da').value||0,a:+$('a').value||0,corso:$('corso').value});
  const applica=agg=>{
    const f=leggi();
    if(filtroVuoto(f)){esito('Scegli almeno un criterio.');return}
    if(f.da&&f.a&&f.da>f.a){esito('Il grado «da» deve essere uguale o inferiore al grado «a».');return}
    const m=atleti().filter(a=>corrisponde(a,f)),sel=getSel();
    if(!m.length){esito('Nessun atleta corrisponde. Controlla che nelle schede Atleti siano compilati tipologia, grado e corsi.');return}
    m.forEach(a=>agg?sel.add(a.id):sel.delete(a.id));
    const n=m.length;dopo(m,agg);esito(n+(n===1?' atleta ':' atleti ')+(agg?(n===1?'aggiunto alla selezione.':'aggiunti alla selezione.'):(n===1?'tolto dalla selezione.':'tolti dalla selezione.')))};
  $('add').onclick=()=>applica(true);$('del').onclick=()=>applica(false)}
