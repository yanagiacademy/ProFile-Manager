/* Telegram condiviso da Chat, Documenti e pagina di test. */
import {TG_API_ID,TG_API_HASH,TG_GROUP,TG_FILES} from "./telegram-config.js";
const ok=v=>typeof v==="string"||typeof v==="number"?String(v).trim()!==""&&String(v).trim()!=="INSERISCI":false;
export const credsOk=()=>ok(TG_API_ID)&&ok(TG_API_HASH)&&!isNaN(Number(String(TG_API_ID).trim()));
export const chatConfigured=()=>credsOk()&&ok(TG_GROUP);
export const tgConfigured=()=>credsOk()&&ok(TG_FILES);
export const hasSession=()=>{try{return !!localStorage.getItem('tg_session')}catch(e){return false}};
export const clearSession=()=>{try{localStorage.removeItem('tg_session')}catch(e){}};
const saveSession=s=>{try{localStorage.setItem('tg_session',s)}catch(e){}};
const getSession=()=>{try{return localStorage.getItem('tg_session')||''}catch(e){return ''}};
export const withTimeout=(p,ms,msg)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg||'TIMEOUT')),ms))]);

/* La libreria viene caricata da esm.sh, provando più indirizzi in ordine. */
export const SOURCES=[
  "https://esm.sh/telegram@2.26.22?bundle",
  "https://esm.sh/telegram@2.26.22",
  "https://esm.sh/telegram?bundle",
  "https://esm.sh/telegram"
];
export let libSource='';
let libP=null;
export function loadTg(log=()=>{}){
  if(libP)return libP;
  libP=(async()=>{
    const errs=[];
    for(const u of SOURCES){
      try{
        log('Carico la libreria: '+u);
        const m=await withTimeout(import(u),30000,'timeout caricamento libreria');
        const tg=m.TelegramClient?m:(m.default&&m.default.TelegramClient?m.default:null);
        if(!tg)throw new Error('modulo senza TelegramClient (chiavi: '+Object.keys(m).slice(0,8).join(',')+')');
        if(!tg.sessions||!tg.sessions.StringSession)throw new Error('modulo senza sessions.StringSession');
        libSource=u;log('Libreria caricata da '+u);return tg;
      }catch(e){errs.push(u+' → '+(e&&e.message||e));log('Non riuscito: '+(e&&e.message||e))}
    }
    const e=new Error('LIB_LOAD');e.details=errs;throw e;
  })();
  libP.catch(()=>{libP=null});
  return libP;
}
export function newClient(tg,saved){
  return new tg.TelegramClient(new tg.sessions.StringSession(saved||''),Number(String(TG_API_ID).trim()),String(TG_API_HASH).trim(),
    {connectionRetries:3,useWSS:true,deviceModel:'ProFile Manager',appVersion:'1.0'});
}
/* Accesso: ui = {phone(), code(), password()} che restituiscono una Promise<string>. */
export async function tgLogin(client,ui){
  let last=null;
  try{
    await withTimeout(client.start({phoneNumber:ui.phone,phoneCode:ui.code,password:ui.password,onError:async e=>{last=e;return true}}),600000,'TIMEOUT_LOGIN');
  }catch(e){throw last||e}
  saveSession(client.session.save());
}
let cache=null;
export function tgClient(){
  if(cache)return cache;
  cache=(async()=>{
    if(!credsOk())throw new Error('NO_CONFIG');
    if(!hasSession())throw new Error('NO_SESSION');
    const tg=await loadTg();
    const client=newClient(tg,getSession());
    await withTimeout(client.connect(),30000,'TIMEOUT_CONNECT');
    if(!(await withTimeout(client.checkAuthorization(),20000,'TIMEOUT_AUTH'))){clearSession();throw new Error('NO_SESSION')}
    return {client,tg};
  })();
  cache.catch(()=>{cache=null});
  return cache;
}
const norm=s=>String(s||'').trim().toLowerCase();
export async function findDialog(client,name){
  const g=norm(name).replace(/^@/,'');
  const ds=await withTimeout(client.getDialogs({limit:300}),30000,'TIMEOUT_DIALOGS');
  const d=ds.find(x=>norm(x.title)===norm(name)||(x.entity&&x.entity.username&&norm(x.entity.username)===g));
  return {dialog:d||null,titles:ds.map(x=>x.title).filter(Boolean)};
}
const ents={};
export function tgEntity(name){
  if(!ents[name]){
    ents[name]=(async()=>{
      const {client}=await tgClient();
      const {dialog,titles}=await findDialog(client,name);
      if(!dialog){const e=new Error('NO_CHAT');e.titles=titles;throw e}
      return dialog.entity;
    })();
    ents[name].catch(()=>{delete ents[name]});
  }
  return ents[name];
}
/* Testo leggibile per un errore Telegram. */
export function tgErrText(e){
  const m=(e&&e.message)||String(e);
  if(m==='NO_CONFIG')return 'Configurazione Telegram incompleta: controlla api_id e api_hash in telegram-config.js.';
  if(m==='NO_SESSION')return 'Non hai effettuato l’accesso a Telegram: aprilo dalla pagina Chat.';
  if(m==='NO_CHAT')return 'Gruppo non trovato: il nome deve coincidere esattamente e l’account deve far parte del gruppo.';
  if(m==='LIB_LOAD')return 'Impossibile caricare la libreria Telegram (esm.sh). '+((e.details||[]).join(' | '));
  if(/^TIMEOUT/.test(m))return 'Telegram non risponde (timeout). Controlla la connessione, o che la rete non blocchi i WebSocket verso Telegram.';
  if(/API_ID_INVALID/.test(m))return 'api_id o api_hash non validi: ricontrolla i valori su my.telegram.org.';
  if(/API_ID_PUBLISHED_FLOOD/.test(m))return 'Telegram ha bloccato queste credenziali API perché pubbliche: serve registrarne di nuove su my.telegram.org.';
  if(/PHONE_NUMBER_INVALID/.test(m))return 'Numero di telefono non valido: usa il prefisso internazionale (es. +39…).';
  if(/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(m))return 'Codice non valido.';
  if(/PHONE_CODE_EXPIRED/.test(m))return 'Codice scaduto: riprova l’accesso.';
  if(/PASSWORD_HASH_INVALID/.test(m))return 'Password a due fattori errata.';
  if(/FLOOD/.test(m))return 'Troppi tentativi: Telegram chiede di attendere ('+m+').';
  if(/AUTH_USER_CANCEL/.test(m))return 'Accesso annullato.';
  return m;
}
/* Invio di un file nel gruppo: prova prima il File del browser, poi CustomFile. */
export async function tgSendFile(tg,client,ent,file,onProgress,mode='auto'){
  const base={caption:file.name,forceDocument:true,workers:3,progressCallback:onProgress};
  const viaCustom=async()=>{
    const CF=tg.client&&tg.client.uploads&&tg.client.uploads.CustomFile;
    if(!CF)throw new Error('CustomFile non disponibile nella libreria');
    const {Buffer}=await import("https://esm.sh/buffer");
    return client.sendFile(ent,{...base,file:new CF(file.name,file.size,'',Buffer.from(await file.arrayBuffer()))});
  };
  const viaFile=()=>client.sendFile(ent,{...base,file});
  if(mode==='custom')return viaCustom();
  if(mode==='file')return viaFile();
  try{return await viaFile()}catch(e1){
    try{return await viaCustom()}catch(e2){e2.message=(e1&&e1.message||e1)+' / '+(e2&&e2.message||e2);throw e2}}
}
