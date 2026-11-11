/* gradi.js – le 16 categorie di grado (6 kyu … 10 dan) con il colore della cintura.
   Usato da Esami (esami.js) e da Atleti (campo Grado): il grado dell'atleta deve corrispondere a una di queste categorie.
   liv = posizione nella scala: 1 = 6 kyu bianca … 6 = 1 kyu marrone, 7 = 1 dan … 16 = 10 dan. */
const BIANCA_ROSSA='repeating-linear-gradient(90deg,#fff 0 9px,#D93025 9px 18px)';
export const GRADI=[
  {liv:1,nome:'6 kyu',cint:'bianca',bg:'#FFFFFF'},
  {liv:2,nome:'5 kyu',cint:'gialla',bg:'#F2C94C'},
  {liv:3,nome:'4 kyu',cint:'arancione',bg:'#F2994A'},
  {liv:4,nome:'3 kyu',cint:'verde',bg:'#27AE60'},
  {liv:5,nome:'2 kyu',cint:'blu',bg:'#2F80ED'},
  {liv:6,nome:'1 kyu',cint:'marrone',bg:'#8B5A2B'},
  ...[1,2,3,4,5].map((n,i)=>({liv:7+i,nome:n+' dan',cint:'nera',bg:'#111111'})),
  ...[6,7,8,9,10].map((n,i)=>({liv:12+i,nome:n+' dan',cint:'bianco rossa',bg:BIANCA_ROSSA}))
];
export const gradoLabel=g=>g.nome+' - '+g.cint;
export const GRADI_LAB=GRADI.map(gradoLabel);
export const gradoByLiv=n=>GRADI.find(g=>g.liv===n)||null;
/* livello (1–16) ricavato dal testo del grado: accetta "3 kyu - verde", "3° kyu", "1 Dan"… ; 0 se non riconosciuto */
export function livDaGrado(s){
  const m=String(s||'').toLowerCase().match(/(\d{1,2})\s*[°º^]?\s*(kyu|dan)/);
  if(!m)return 0;const n=+m[1];
  if(m[2]==='kyu')return n>=1&&n<=6?7-n:0;
  return n>=1&&n<=10?6+n:0}
/* testo canonico (es. "3 kyu - verde") se il grado è riconosciuto, altrimenti il testo com'è */
export function gradoCanon(s){const g=gradoByLiv(livDaGrado(s));return g?gradoLabel(g):String(s||'').trim()}
