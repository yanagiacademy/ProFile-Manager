/* Ponte Mail di ProFile Manager (Google Apps Script) — da incollare in script.google.com con l'account Gmail dell'ASD.
   Fa tre cose per la pagina Mail e per le notifiche della suite:
   • legge e risponde alla posta (list / get / att / send / reply), per chi ha il permesso Mail;
   • invia subito le notifiche (n-invia) e le mette in coda per l'ora giusta (n-programma / n-annulla), solo per l'admin;
   • un'attività pianificata (inviaCoda, ogni 30 minuti) spedisce le mail in coda quando arriva il loro momento, anche con la suite chiusa.
   Chi chiama deve avere fatto il login nella suite: il token di Firebase viene controllato qui, la password di Gmail non esce mai.
   Limite di Gmail: circa 100 destinatari al giorno per un account personale (una mail a 3 persone = 3). */

/* ---- DA COMPILARE (stessi valori di firebase-config.js) ---- */
const FIREBASE_API_KEY='INSERISCI';
const PROJECT_ID='INSERISCI';
/* ------------------------------------------------------------ */
const NOME_MITTENTE='Yanagi Academy';
const EMAIL_ASD='info.judoyanagi@gmail.com';          /* la casella da cui partono le mail: lo script va creato con QUESTO account */
const PREFISSO='Q|';
const MAX_CODA_BYTE=420000;          /* le proprietà dello script hanno 500 KB in tutto */
const MAX_RITARDO=3*864e5;           /* una mail in coda non spedita entro 3 giorni dal suo momento viene scartata */

/* Eseguire UNA volta dall'editor (▶ autorizza): chiede i permessi e installa l'attività che spedisce la coda. */
function autorizza(){
  GmailApp.getInboxUnreadCount();
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.google.com',{muteHttpExceptions:true});
  installaTrigger();
  var chi=Session.getEffectiveUser().getEmail();
  Logger.log(chi.toLowerCase()===EMAIL_ASD?'Autorizzato come '+chi+'. Quota giornaliera residua: '+MailApp.getRemainingDailyQuota():'ATTENZIONE: lo script è sull’account '+chi+', non su '+EMAIL_ASD+'. Crea il progetto con l’account dell’ASD.');
}
function installaTrigger(){
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='inviaCoda'}).forEach(function(t){ScriptApp.deleteTrigger(t)});
  ScriptApp.newTrigger('inviaCoda').timeBased().everyMinutes(30).create();
}

function doGet(){return ContentService.createTextOutput('Ponte Mail attivo')}
function doPost(e){
  var out;
  try{
    var b=JSON.parse(e.postData.contents);
    var u=utente_(b.t);
    out=azione_(b,u);out.ok=true;
  }catch(err){out={ok:false,e:String((err&&err.message)||err)}}
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- chi sta chiamando ---------- */
function utente_(t){
  if(!t)throw new Error('Accesso mancante: rifai il login nella suite.');
  var r=UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+FIREBASE_API_KEY,{method:'post',contentType:'application/json',payload:JSON.stringify({idToken:t}),muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw new Error('Accesso non valido o scaduto: rifai il login nella suite.');
  var u=JSON.parse(r.getContentText()).users[0];
  var d=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents/users/'+u.localId,{headers:{Authorization:'Bearer '+t},muteHttpExceptions:true});
  if(d.getResponseCode()!==200)throw new Error('Account non riconosciuto dalla suite.');
  var f=JSON.parse(d.getContentText()).fields||{};
  var admin=!!(f.admin&&f.admin.booleanValue===true),lv='n';
  var p=f.perms&&f.perms.mapValue&&f.perms.mapValue.fields;
  if(p&&p.mail&&p.mail.stringValue)lv=p.mail.stringValue;
  return {uid:u.localId,email:u.email,admin:admin,lv:admin?'w':lv};
}

function azione_(b,u){
  var a=String(b.a||'');
  if(a.indexOf('n-')===0){
    if(!u.admin)throw new Error('Le notifiche si gestiscono solo dall’account admin.');
    if(a==='n-invia')return nInvia_(b);
    if(a==='n-programma')return nProgramma_(b);
    if(a==='n-annulla')return nAnnulla_(b);
    if(a==='n-stato')return nStato_();
    throw new Error('Azione sconosciuta.');
  }
  if(u.lv==='n')throw new Error('Non hai il permesso di usare la Mail.');
  if(a==='list')return elenco_(b);
  if(a==='get')return leggi_(b);
  if(a==='att')return allegato_(b);
  if(u.lv!=='w')throw new Error('Hai il permesso di sola lettura sulla Mail.');
  if(a==='send')return invia_(b);
  if(a==='reply')return rispondi_(b);
  throw new Error('Azione sconosciuta.');
}

/* ---------- posta ---------- */
function elenco_(b){
  var q=String(b.q||'').trim()||'in:inbox',o=Number(b.o)||0,N=20;
  var th=GmailApp.search(q,o,N+1);
  var items=th.slice(0,N).map(function(t){
    var ms=t.getMessages(),l=ms[ms.length-1];
    return {id:t.getId(),from:l.getFrom(),n:ms.length,unread:t.isUnread(),subject:t.getFirstMessageSubject(),date:l.getDate().toISOString(),snippet:l.getPlainBody().replace(/\s+/g,' ').slice(0,110)};
  });
  return {items:items,more:th.length>N};
}
function leggi_(b){
  var t=GmailApp.getThreadById(b.id);
  if(!t)throw new Error('Conversazione non trovata.');
  var msgs=t.getMessages().map(function(m){
    return {id:m.getId(),from:m.getFrom(),to:m.getTo(),cc:m.getCc(),date:m.getDate().toISOString(),html:m.getBody(),text:m.getPlainBody(),
      att:m.getAttachments({includeInlineImages:false}).map(function(x,i){return {i:i,name:x.getName(),type:x.getContentType(),size:x.getSize()}})};
  });
  if(t.isUnread())t.markRead();
  return {subject:t.getFirstMessageSubject(),msgs:msgs};
}
function allegato_(b){
  var x=GmailApp.getMessageById(b.id).getAttachments({includeInlineImages:false})[Number(b.i)];
  if(!x)throw new Error('Allegato non trovato.');
  return {name:x.getName(),type:x.getContentType(),data:Utilities.base64Encode(x.getBytes())};
}
function blobs_(files){return (files||[]).map(function(f){return Utilities.newBlob(Utilities.base64Decode(f.data),f.type||'application/octet-stream',f.name)})}
function invia_(b){
  if(!b.to)throw new Error('Manca il destinatario.');
  var o={name:NOME_MITTENTE},at=blobs_(b.files);
  if(b.cc)o.cc=b.cc;
  if(at.length)o.attachments=at;
  GmailApp.sendEmail(b.to,b.subject||'(senza oggetto)',b.text||'',o);
  return {};
}
function rispondi_(b){
  var m=GmailApp.getMessageById(b.id),o={attachments:blobs_(b.files)};
  if(b.all)m.replyAll(b.text||'',o);else m.reply(b.text||'',o);
  return {};
}

/* ---------- notifiche: invio immediato, coda, annullamento ---------- */
function valida_(a){return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(a||''))}
function manda_(to,subject,text,allegati){
  var o={name:NOME_MITTENTE};
  if(allegati&&allegati.length)o.attachments=allegati;
  GmailApp.sendEmail(to,subject||'Yanagi Academy',text||'',o);
  Logger.log('Inviata a '+to+(allegati&&allegati.length?' con '+allegati.length+' allegati':''));
}
function chiave_(k){return PREFISSO+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,String(k)))}

/* items: [{key,to,subject,text}] (+ files: [{name,type,data}] allegati a tutte le mail della richiesta) → esiti: [{key,ok,e?}] */
function nInvia_(b){
  var items=(b.items||[]).slice(0,40),esiti=[],quota=MailApp.getRemainingDailyQuota(),at=blobs_(b.files);
  items.forEach(function(v){
    if(!valida_(v.to)){esiti.push({key:v.key,ok:false,e:'indirizzo non valido'});return}
    if(quota<1){esiti.push({key:v.key,ok:false,e:'limite giornaliero di Gmail raggiunto'});return}
    try{manda_(v.to,v.subject,v.text,at);quota--;esiti.push({key:v.key,ok:true})}
    catch(err){esiti.push({key:v.key,ok:false,e:String((err&&err.message)||err).slice(0,120)})}
  });
  return {esiti:esiti,quota:quota,mittente:Session.getEffectiveUser().getEmail()};
}
/* items: [{key,to,subject,text,at(ms)}] → messi in coda; li spedisce inviaCoda */
function nProgramma_(b){
  var p=PropertiesService.getScriptProperties(),all=p.getProperties(),tot=0,esiti=[];
  Object.keys(all).forEach(function(k){if(k.indexOf(PREFISSO)===0)tot+=k.length+all[k].length});
  (b.items||[]).slice(0,60).forEach(function(v){
    if(!valida_(v.to)||!v.at){esiti.push({key:v.key,ok:false,e:'dati non validi'});return}
    var val=JSON.stringify({to:v.to,s:v.subject||'',x:v.text||'',at:Number(v.at),n:0});
    if(val.length>8500||tot+val.length>MAX_CODA_BYTE){esiti.push({key:v.key,ok:false,e:'coda piena'});return}
    p.setProperty(chiave_(v.key),val);tot+=val.length+40;esiti.push({key:v.key,ok:true});
  });
  return {esiti:esiti};
}
function nAnnulla_(b){
  var p=PropertiesService.getScriptProperties(),n=0;
  (b.keys||[]).forEach(function(k){var c=chiave_(k);if(p.getProperty(c)!==null){p.deleteProperty(c);n++}});
  return {annullate:n};
}
function nStato_(){
  var all=PropertiesService.getScriptProperties().getProperties(),n=0,prossimo=0;
  Object.keys(all).forEach(function(k){if(k.indexOf(PREFISSO)!==0)return;n++;try{var at=JSON.parse(all[k]).at;if(!prossimo||at<prossimo)prossimo=at}catch(e){}});
  var trig=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='inviaCoda'});
  return {quota:MailApp.getRemainingDailyQuota(),inCoda:n,prossimo:prossimo,trigger:trig,mittente:Session.getEffectiveUser().getEmail()};
}

/* Attività pianificata (ogni 30 minuti): spedisce le mail in coda il cui momento è arrivato */
function inviaCoda(){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return;
  try{
    var p=PropertiesService.getScriptProperties(),all=p.getProperties(),now=Date.now(),quota=MailApp.getRemainingDailyQuota();
    var due=[];
    Object.keys(all).forEach(function(k){
      if(k.indexOf(PREFISSO)!==0)return;
      try{var v=JSON.parse(all[k]);if(v.at<=now)due.push({k:k,v:v})}catch(e){p.deleteProperty(k)}
    });
    due.sort(function(a,b){return a.v.at-b.v.at});
    for(var i=0;i<due.length;i++){
      var o=due[i];
      if(now-o.v.at>MAX_RITARDO){p.deleteProperty(o.k);continue}
      if(quota<1)break;
      try{manda_(o.v.to,o.v.s,o.v.x);quota--;p.deleteProperty(o.k)}
      catch(err){o.v.n=(o.v.n||0)+1;if(o.v.n>=3)p.deleteProperty(o.k);else p.setProperty(o.k,JSON.stringify(o.v))}
    }
  }finally{lock.releaseLock()}
}
