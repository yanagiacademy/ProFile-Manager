/* Tema grafico della suite (script classico, incluso in <head> di OGNI pagina, dopo gli stili).
   - Il tema installato dall'admin (pagina Tema) sta in Firestore: app/tema = {json, nome, at, by}. Lettura pubblica (colori e logo non sono dati riservati),
     così si applica anche alla schermata di accesso. Scrittura solo admin (regole).
   - Si applica subito dalla copia in localStorage (nessun lampeggio) e si ricontrolla su Firestore (REST, 1 lettura, al massimo ogni 10 minuti).
   - Formato file: vedi esempio() qui sotto o il pulsante «Scarica modello» nella pagina Tema.
   Sicurezza: il file è validato; colori solo #hex/rgb()/hsl(); il CSS extra non può contenere @import, url() esterni, script. */
(function(){
  var CH='pfm_tema',CK='pfm_tema_ck',ID_ST='pfm-tema-stile',ID_FN='pfm-tema-font',FORMATO='pfm-tema-1';
  var VARS=['bg','sf','tx','mu','ac','ac2','ln','er'];
  var NOMI_VAR={bg:'Sfondo',sf:'Riquadri',tx:'Testo',mu:'Testo secondario',ac:'Colore principale',ac2:'Colore secondario',ln:'Linee e bordi',er:'Errore'};
  var PRED={
    chiaro:{bg:'#EEF1F4',sf:'#FFFFFF',tx:'#14213D',mu:'#5B6780',ac:'#1B2A4A',ac2:'#B8A24A',ln:'#D3D9E3',er:'#B3261E'},
    scuro:{bg:'#0E1626',sf:'#17233A',tx:'#E8ECF4',mu:'#9AA7C0',ac:'#8FA8DC',ac2:'#D6C26A',ln:'#2A3A58',er:'#FF8A80'}};
  var RE_COL=/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9 ,.%\/-]+\))$/i;
  var RE_LOGO=/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+\/=]+$/;
  var MAX_LOGO=280000,MAX_CSS=20000,MAX_TOT=700000;
  var forzato=false,logoOsserv=null,corrente=null;

  function valida(t){
    var err=[],o={formato:FORMATO};
    if(!t||typeof t!=='object'||Array.isArray(t))return {ok:false,errori:['Il file non contiene un tema valido (serve un oggetto JSON).']};
    if(t.formato!==FORMATO)err.push('Campo «formato» mancante o sbagliato: deve essere "'+FORMATO+'".');
    if(typeof t.nome!=='string'||!t.nome.trim()||t.nome.length>60)err.push('Campo «nome» obbligatorio (testo, massimo 60 caratteri).');
    else o.nome=t.nome.trim();
    ['autore','descrizione'].forEach(function(k){if(t[k]==null)return;if(typeof t[k]!=='string'||t[k].length>300)err.push('Campo «'+k+'» non valido (testo, massimo 300 caratteri).');else o[k]=t[k].trim()});
    ['chiaro','scuro'].forEach(function(m){
      if(t[m]==null)return;
      if(typeof t[m]!=='object'||Array.isArray(t[m])){err.push('«'+m+'» deve essere un oggetto di colori.');return}
      var c={};
      Object.keys(t[m]).forEach(function(k){
        if(VARS.indexOf(k)<0){err.push('«'+m+'»: colore sconosciuto «'+k+'» (ammessi: '+VARS.join(', ')+').');return}
        if(typeof t[m][k]!=='string'||!RE_COL.test(t[m][k].trim()))err.push('«'+m+'.'+k+'»: colore non valido (usa #RRGGBB, rgb() o hsl()).');
        else c[k]=t[m][k].trim()});
      o[m]=c});
    if(t.modo!=null){if(['auto','chiaro','scuro'].indexOf(t.modo)<0)err.push('«modo» deve essere "auto", "chiaro" o "scuro".');else o.modo=t.modo}
    if(t.font!=null){if(typeof t.font!=='string'||!/^[A-Za-z0-9 ]{2,40}$/.test(t.font.trim()))err.push('«font»: indica il nome di un font di Google Fonts (lettere, numeri e spazi).');else o.font=t.font.trim()}
    if(t.raggio!=null){if(typeof t.raggio!=='number'||!(t.raggio>=0&&t.raggio<=24))err.push('«raggio»: numero da 0 a 24 (angoli dei riquadri, in pixel).');else o.raggio=Math.round(t.raggio)}
    if(t.logo!=null){if(typeof t.logo!=='string'||!RE_LOGO.test(t.logo)||t.logo.length>MAX_LOGO)err.push('«logo»: immagine PNG, JPEG, WebP o SVG in formato data URL (base64), massimo circa 200 KB.');else o.logo=t.logo}
    if(t.logoSfondo!=null){if(typeof t.logoSfondo!=='string'||!RE_COL.test(t.logoSfondo.trim()))err.push('«logoSfondo»: colore non valido.');else o.logoSfondo=t.logoSfondo.trim()}
    if(t.css!=null){
      var e=erroreCss(t.css);if(e)err.push('«css»: '+e);else o.css=t.css}
    if(!err.length&&!o.chiaro&&!o.scuro&&!o.font&&o.raggio==null&&!o.logo&&!o.css&&!o.modo)err.push('Il tema non cambia nulla: indica almeno colori, font, raggio, logo o css.');
    if(!err.length&&JSON.stringify(o).length>MAX_TOT)err.push('Il tema è troppo grande (massimo circa 700 KB).');
    return err.length?{ok:false,errori:err}:{ok:true,tema:o,errori:[]}}
  function erroreCss(s){
    if(typeof s!=='string')return 'deve essere un testo.';
    if(s.length>MAX_CSS)return 'troppo lungo (massimo '+MAX_CSS+' caratteri).';
    var p=s.replace(/\/\*[\s\S]*?\*\//g,'');
    if(/</.test(p))return 'il carattere < non è ammesso.';
    if(/@import|@charset|@namespace|expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\0*[0-9a-f]{1,6}\s*\(/i.test(p))return 'contiene istruzioni non ammesse (@import, expression, javascript:).';
    var re=/url\(\s*([^)]*)\)/gi,m;
    while((m=re.exec(p))){if(!/^["']?data:(image|font)\//i.test(m[1].trim()))return 'url() ammesso solo con dati incorporati (data:image o data:font): niente indirizzi esterni.'}
    return ''}

  function blocco(sel,c){var d=VARS.filter(function(k){return c&&c[k]}).map(function(k){return '--'+k+':'+c[k]}).join(';');return d?sel+'{'+d+'}':''}
  function costruisciCss(t){
    var s='',r=t.raggio;
    s+=blocco(':root',t.chiaro);
    if(t.scuro)s+='@media (prefers-color-scheme:dark){'+blocco(':root:not([data-theme="light"])',t.scuro)+'}'+blocco(':root[data-theme="dark"]',t.scuro);
    if(t.chiaro)s+=blocco(':root[data-theme="light"]',t.chiaro);
    if(t.font)s+='body{font-family:"'+t.font+'",system-ui,sans-serif}';
    if(r!=null)s+='.card,.tile,.acc,.dlg,.ib,.alert{border-radius:'+r+'px}.btn,input[type=text],input[type=password],input[type=search],input[type=date],input[type=number],input[type=email],select,textarea{border-radius:'+Math.max(0,r-2)+'px}';
    if(t.logoSfondo)s+='.lgbox,.brand .lg,.lgb{background:'+t.logoSfondo+'}';
    if(t.css)s+=t.css.replace(/<\/?style/gi,'');
    return s}

  function rimuovi(){
    var a=document.getElementById(ID_ST);if(a)a.remove();
    var f=document.getElementById(ID_FN);if(f)f.remove();
    if(logoOsserv){logoOsserv.disconnect();logoOsserv=null}
    document.querySelectorAll('img[data-pfm-logo]').forEach(function(i){i.src=i.getAttribute('data-pfm-logo');i.removeAttribute('data-pfm-logo')});
    if(forzato){document.documentElement.removeAttribute('data-theme');forzato=false}
    corrente=null}
  function logoIn(radice,src){
    var l=radice.querySelectorAll?radice.querySelectorAll('img[src$="logo-yanagi.png"]'):[];
    for(var i=0;i<l.length;i++){if(!l[i].getAttribute('data-pfm-logo'))l[i].setAttribute('data-pfm-logo',l[i].getAttribute('src'));if(l[i].src!==src)l[i].src=src}
    if(radice.matches&&radice.matches('img[src$="logo-yanagi.png"]')){if(!radice.getAttribute('data-pfm-logo'))radice.setAttribute('data-pfm-logo',radice.getAttribute('src'));radice.src=src}}
  function applica(t){
    rimuovi();
    if(!t)return;
    var v=valida(t);if(!v.ok)return;t=v.tema;corrente=t;
    var st=document.createElement('style');st.id=ID_ST;st.textContent=costruisciCss(t);(document.head||document.documentElement).appendChild(st);
    if(t.font){var l=document.createElement('link');l.id=ID_FN;l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(t.font).replace(/%20/g,'+')+':wght@400;500;700&display=swap';(document.head||document.documentElement).appendChild(l)}
    if(t.modo&&t.modo!=='auto'){document.documentElement.setAttribute('data-theme',t.modo==='scuro'?'dark':'light');forzato=true}
    if(t.logo){
      var avvia=function(){logoIn(document,t.logo);logoOsserv=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1)logoIn(n,t.logo)})})});logoOsserv.observe(document.documentElement,{childList:true,subtree:true})};
      if(document.body)avvia();else document.addEventListener('DOMContentLoaded',avvia)}}

  function dalCache(){try{var c=JSON.parse(localStorage.getItem(CH)||'null');return c&&c.t?c:null}catch(e){return null}}
  function salvaCache(t,at){try{if(t)localStorage.setItem(CH,JSON.stringify({t:t,at:at||0}));else localStorage.removeItem(CH)}catch(e){}}
  function aggiorna(forza){
    var ora=Date.now(),ultimo=0;try{ultimo=+localStorage.getItem(CK)||0}catch(e){}
    if(!forza&&ora-ultimo<600000)return Promise.resolve();
    return import('./firebase-config.js').then(function(m){
      var c=m.firebaseConfig;if(!c||!c.apiKey||c.apiKey==='INSERISCI')return;
      return fetch('https://firestore.googleapis.com/v1/projects/'+c.projectId+'/databases/(default)/documents/app/tema?key='+c.apiKey).then(function(r){
        try{localStorage.setItem(CK,String(Date.now()))}catch(e){}
        if(r.status===404){if(dalCache()){salvaCache(null);applica(null)}return}
        if(!r.ok)return;
        return r.json().then(function(d){
          var js=d&&d.fields&&d.fields.json&&d.fields.json.stringValue,v;
          try{v=valida(JSON.parse(js))}catch(e){return}
          if(!v.ok)return;
          var c0=dalCache();
          if(!c0||JSON.stringify(c0.t)!==JSON.stringify(v.tema)){salvaCache(v.tema,Date.now());applica(v.tema)}})})
    }).catch(function(){})}

  function esempio(){
    return {formato:FORMATO,nome:'Il mio tema',autore:'Yanagi Academy',descrizione:'Modello: cambia i valori e installalo dalla pagina Tema.',
      modo:'auto',chiaro:PRED.chiaro,scuro:PRED.scuro,font:'Zen Kaku Gothic New',raggio:10,logoSfondo:'#1B2A4A',
      css:'/* CSS facoltativo: niente @import né indirizzi esterni */\n.tile{border-left-width:4px}'}}

  window.PFM_TEMA={valida:valida,applica:applica,aggiorna:aggiorna,esempio:esempio,predefinito:PRED,nomiVar:NOMI_VAR,vars:VARS,formato:FORMATO,
    corrente:function(){return corrente},cache:dalCache,svuotaCache:function(){salvaCache(null);try{localStorage.removeItem(CK)}catch(e){}}};

  var c=dalCache();if(c)applica(c.t);
  aggiorna(false);
})();
