/* Telegram condiviso da Chat, Documenti e pagina di test. */
import {TG_API_ID,TG_API_HASH,TG_GROUP,TG_FILES} from "./telegram-config.js";
export const TG_BUILD="2026-10-29-f";
export const consoleLog=[];
for(const k of ['log','info','warn','error','debug']){const o=console[k];console[k]=(...a)=>{try{consoleLog.push(k+': '+a.map(x=>x&&x.message?x.message:typeof x==='object'?JSON.stringify(x):String(x)).join(' ').slice(0,300));if(consoleLog.length>60)consoleLog.shift()}catch(e){}return o.apply(console,a)}}
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
  "./telegram-lib.js",
  "https://cdn.jsdelivr.net/npm/telegram@2.26.22/+esm",
  "https://esm.sh/telegram@2.26.22?bundle",
  "https://esm.sh/telegram@2.26.22",
  "https://cdn.jsdelivr.net/npm/telegram/+esm",
  "https://esm.sh/telegram?bundle"
];
export let libSource='';
let libP=null;
async function ensureShims(log){
  if(typeof globalThis.Buffer==='undefined'){
    let err=null;
    for(const u of ["https://esm.sh/buffer@6.0.3","https://esm.sh/buffer"]){
      try{const m=await withTimeout(import(u),20000,'timeout');globalThis.Buffer=m.Buffer||(m.default&&m.default.Buffer);if(globalThis.Buffer){log('Buffer disponibile ('+u+')');break}}
      catch(e){err=e}
    }
    if(typeof globalThis.Buffer==='undefined')throw new Error('Impossibile preparare Buffer: '+(err&&err.message||''));
  }
  if(typeof globalThis.process==='undefined')globalThis.process={env:{},browser:true,version:'',versions:{},argv:[],nextTick:(f,...a)=>queueMicrotask(()=>f(...a))};
  if(typeof globalThis.global==='undefined')globalThis.global=globalThis;
}
export let shimError='';
try{await ensureShims(()=>{})}catch(e){shimError=(e&&e.message)||String(e)}
async function selfTest(tg,log){
  const B=globalThis.Buffer,h=tg.helpers;
  if(!h||typeof h.sha1!=='function'){log('Autotest crittografia saltato (helpers.sha1 assente)');return}
  const r=await withTimeout(Promise.resolve(h.sha1(B.from('abc'))),10000,'timeout autotest');
  const hex=B.from(r).toString('hex');
  if(hex!=='a9993e364706816aba3e25717850c26c9cd0d89d')throw new Error('autotest sha1 errato: '+hex);
  log('Autotest crittografia superato');
}
export function loadTg(log=()=>{}){
  if(libP)return libP;
  libP=(async()=>{
    await ensureShims(log);
    const errs=[];
    for(const u of SOURCES){
      try{
        log('Carico la libreria: '+u);
        const m=await withTimeout(import(u),60000,'timeout caricamento libreria');
        const tg=m.TelegramClient?m:(m.default&&m.default.TelegramClient?m.default:null);
        if(!tg)throw new Error('modulo senza TelegramClient (chiavi: '+Object.keys(m).slice(0,8).join(',')+')');
        if(!tg.sessions||!tg.sessions.StringSession)throw new Error('modulo senza sessions.StringSession');
        await selfTest(tg,log);
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
/* Accesso manuale (senza client.start, che si bloccava nel controllo iniziale).
   ui = {phone(), code(), password()} che restituiscono una Promise<string>. */
export async function tgLogin(tg,client,ui,log=()=>{}){
  const creds={apiId:Number(String(TG_API_ID).trim()),apiHash:String(TG_API_HASH).trim()};
  const phone=(await ui.phone()).replace(/[\s\-()]/g,'');
  log('Invio del numero a Telegram');
  const sent=await withTimeout(client.sendCode(creds,phone,false),40000,'TIMEOUT_SENDCODE');
  log('Codice inviato'+(sent.isCodeViaApp?' (nell’app Telegram)':' (via SMS o chiamata)'));
  let done=false,tries=0;
  while(!done&&tries<3){
    const code=await ui.code();
    if(code==='__SMS__'){   /* "Non arriva? Invia via SMS": chiede a Telegram il metodo successivo (SMS o chiamata) */
      try{
        const r=await withTimeout(client.invoke(new tg.Api.auth.ResendCode({phoneNumber:phone,phoneCodeHash:sent.phoneCodeHash})),40000,'TIMEOUT_SENDCODE');
        if(r&&r.phoneCodeHash)sent.phoneCodeHash=r.phoneCodeHash;
        const t=(r&&r.type&&r.type.className)||'',via=/Sms/.test(t)?'SMS':/Call/.test(t)?'chiamata':'app Telegram';
        log('Codice reinviato ('+via+')');if(ui.info)ui.info('Richiesta inviata: attendi il codice ('+via+').')
      }catch(e){
        const m=(e&&(e.errorMessage||e.message))||'';log('Reinvio non riuscito: '+m);
        if(ui.info)ui.info(/SEND_CODE_UNAVAILABLE/.test(m)?'Telegram non permette altri invii per ora: aspetta qualche minuto.':/FLOOD/.test(m)?'Troppi tentativi: aspetta qualche minuto.':'Reinvio non riuscito ('+m+').')}
      continue}
    tries++;
    try{
      const r=await withTimeout(client.invoke(new tg.Api.auth.SignIn({phoneNumber:phone,phoneCodeHash:sent.phoneCodeHash,phoneCode:code})),40000,'TIMEOUT_SIGNIN');
      if(tg.Api.auth.AuthorizationSignUpRequired&&r instanceof tg.Api.auth.AuthorizationSignUpRequired)throw new Error('ACCOUNT_NOT_REGISTERED');
      done=true;
    }catch(e){
      const m=(e&&(e.errorMessage||e.message))||'';
      if(/SESSION_PASSWORD_NEEDED/.test(m)){
        log('Serve la password a due fattori');
        let last=null;
        try{await withTimeout(client.signInWithPassword(creds,{password:ui.password,onError:async er=>{last=er;return true}}),600000,'TIMEOUT_PASSWORD')}
        catch(e2){throw last||e2}
        done=true;
      }else if(/PHONE_CODE_INVALID/.test(m)&&tries<3){log('Codice non valido, riprova')}
      else throw e;
    }
  }
  saveSession(client.session.save());
}
/* Accesso SENZA codice: si conferma dall'app Telegram già collegata (come "Collega dispositivo" / codice QR).
   ui = {link(url), password()}. link() riceve un indirizzo tg://login?token=… che si rinnova ogni 30 secondi. */
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function tgLoginQr(tg,client,ui,log=()=>{}){
  const creds={apiId:Number(String(TG_API_ID).trim()),apiHash:String(TG_API_HASH).trim()};
  if(typeof client.signInUserWithQrCode!=='function')throw new Error('QR_NON_SUPPORTATO');
  log('In attesa della conferma dall’app Telegram');
  let last=null;
  await withTimeout(client.signInUserWithQrCode(creds,{
    qrCode:async({token})=>{ui.link('tg://login?token='+b64u(token))},
    password:ui.password,
    onError:async er=>{last=er;return true}
  }),300000,'TIMEOUT_QR').catch(e=>{throw last||e});
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
    if(!(await checkAuth(client,true))){clearSession();throw new Error('NO_SESSION')}
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
  if(m==='TIMEOUT_QR')return 'Accesso non confermato entro 5 minuti: riprova.';
  if(m==='QR_NON_SUPPORTATO')return 'Questa versione della libreria non supporta l’accesso senza codice.';
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
export async function tgSendFile(tg,client,ent,file,onProgress,mode='auto',caption,topic){
  const base={caption:caption||file.name,forceDocument:true,workers:3,progressCallback:onProgress,...(caption?{silent:true}:{}),...(topic?{replyTo:topic}:{})};
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

/* Argomenti (topic) del gruppo: ogni sezione della suite scrive nel proprio argomento.
   Se l'argomento non esiste viene creato; se il gruppo non ha gli argomenti attivi (o la creazione non è permessa) si scrive nel gruppo come prima. */
const TOPIC_TITOLI={documenti:'Documenti','file-importanti':'File importanti','documenti-in-scadenza':'Documenti in scadenza',archivio:'Archivio',lezioni:'Lezioni',tecnici:'Tecnici',atleti:'Atleti',eventi:'Eventi',video:'Video',foto:'Foto',mail:'Mail'};
export const topicTitle=k=>{k=String(k).replace(/^meta-/,'');return TOPIC_TITOLI[k]||(k.charAt(0).toUpperCase()+k.slice(1).replace(/-/g,' '))};
const topics={};
export function tgTopic(group,secKey){
  const title=topicTitle(secKey),id=group+'|'+title;
  if(!topics[id])topics[id]=(async()=>{
    try{
      const {client,tg}=await tgClient(),ent=await tgEntity(group),A=tg.Api;
      const r=await client.invoke(new A.channels.GetForumTopics({channel:ent,q:title,offsetDate:0,offsetId:0,offsetTopic:0,limit:100}));
      const t=(r.topics||[]).find(x=>norm(x.title)===norm(title));if(t)return t.id;
      const h=tg.helpers||{},rnd=h.generateRandomBigInt||h.generateRandomLong;
      const u=await client.invoke(new A.channels.CreateForumTopic({channel:ent,title,randomId:rnd?rnd():undefined}));
      for(const x of (u.updates||[])){const m=x.message;if(m&&m.action&&m.action.className==='MessageActionTopicCreate')return m.id}
      return null;
    }catch(e){
      console.warn('Argomenti non disponibili per "'+title+'":',e&&e.message);
      if(/FORUM_MISSING|CHANNEL_INVALID|CHAT_ADMIN_REQUIRED|TOPIC/.test((e&&e.message)||''))return null;   /* definitivo: si scrive nel gruppo */
      delete topics[id];return null}
  })();
  return topics[id]}

/* Senza sessione salvata non c'è nulla da controllare: si passa direttamente all'accesso. */
export async function checkAuth(client,hadSession){
  if(!hadSession)return false;
  try{await withTimeout(client.getMe(),30000,'TIMEOUT_AUTH');return true}catch(e){return false}
}
