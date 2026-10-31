# RESOCONTO – ProFile Manager (Yanagi Academy) – aggiornato al 31/10/2026

## OBIETTIVO
Suite web con login. Gli account li crea solo l'admin, che decide per ogni account (compreso il proprio) lettura/scrittura su ogni sezione e quali account sono admin.
Sezioni: Documenti, Mail, File importanti, Lezioni, Tecnici, Atleti, Eventi (ex Gare), Video, Foto. In più una Chat.
Barra di ricerca in alto che filtra tutte le sezioni. Data e ora in basso a destra. In ogni sezione c'è il Promemoria in basso.

## DECISIONI
- Hosting: GitHub Pages (https://yanagiacademy.github.io), repository separato da quello di gare.html. Nomi dei file senza prefisso.
- Backend: Firebase (Authentication email/password + Firestore). Moduli ES da CDN gstatic v10.12.2, niente npm. Permessi applicati dal server con firestore.rules. Firebase Storage NON usato (richiede Blaze).
- Chat: gruppo Telegram vero "Chat ProFile Maker", accesso col proprio numero di telefono (GramJS). Pagina chat.html.
- File (Documenti, Lezioni): gruppo Telegram privato "Documenti ProFile Maker" (TG_FILES), limite 500 MB a file; in Firestore resta solo la scheda del file. Senza Telegram: blocchi in Firestore (max 20 MB).
- Mail: Gmail dell'ASD (account personale) condiviso tramite un "ponte" Google Apps Script: le persone entrano solo col login della suite, non vedono mai la password di Gmail.
- Promemoria di 2 tipi in ogni sezione: "Questa pagina" (modificabile da chi ha la scrittura) e "Tutte le pagine" (uguale in tutta la suite, modificabile solo dall'admin).
- Preferenza: non aggiornare i numeri di versione nei file dei progetti.

## STATO VERIFICATO (31/10)
- Chat: FUNZIONA, compreso l'inserimento del numero con prefisso (+39) e il pulsante Continua.
- Firestore: regole aggiornate PUBBLICATE (compresa /app/{id} per il promemoria di tutte le pagine).

## NOVITÀ (31/10) – TUTTO SU TELEGRAM (Firebase facoltativo)
- Ogni contenuto di ogni sezione (schede Tecnici/Atleti/Eventi/Lezioni, cartelle, note, elenchi, promemoria di pagina, oltre ai file) è salvato su Telegram. Firebase resta per account/permessi (users, app, promemoria generale) e come COPIA FACOLTATIVA per singolo contenuto (campo fb:true).
- Come funziona (fsx.js): sostituisce l'import di firebase-firestore.js in tutte le pagine. I percorsi sections/<sezione>/items e …/meta vanno su Telegram, il resto su Firestore. Ogni salvataggio è un messaggio nel gruppo dati (TG_DATI in telegram-config.js; se manca si usa TG_FILES): intestazione #pfm #s_<sezione> #r_<id> + JSON (base64; file .json se grande). Le versioni si sommano in ordine; le cancellazioni sono messaggi "del"; ogni 12 versioni il record viene compattato. Cache locale (IndexedDB) e aggiornamento ogni 20 s.
- Servono: il gruppo già usato per i file (TG_FILES) con gli ARGOMENTI attivi (Telegram: modifica gruppo → Argomenti). Ogni sezione scrive nel proprio argomento (Documenti, File importanti, Lezioni, Tecnici, Atleti, Eventi, Video, Foto, Mail, Archivio, Documenti in scadenza), creato da solo se manca (migra.html li crea tutti); se gli argomenti non sono attivi si scrive nel gruppo come prima. TG_DATI è facoltativo (gruppo dati separato). Inoltre: tutti gli operatori nel gruppo e con accesso a Telegram dalla pagina Chat. Senza accesso a Telegram si vedono (sola lettura) solo i contenuti con la copia su Firebase.
- Salva anche su Firebase: casella nei moduli di Lezioni, Tecnici e sezioni generiche; in Documenti casella in alto (per i nuovi contenuti) e ⋯ → "Salva anche su Firebase"/"Togli da Firebase" (per i file copia anche il contenuto, max 20 MB). I contenuti con copia mostrano ☁.
- MIGRAZIONE: aprire migra.html (solo admin, con Telegram collegato) e premere Avvia. Porta su Telegram tutto quello che oggi è su Firebase; su Firebase non cancella nulla (i contenuti migrati restano come copia, fb:true).
- Conservazione 10 anni: il blocco dell'eliminazione ora è applicato dall'app anche sul registro Telegram (le regole Firestore proteggono solo le copie). Su Telegram chiunque sia nel gruppo può cancellare messaggi dall'app di Telegram: non è un blocco tecnico.
- Se Telegram non è configurato (api_id/api_hash) tutto continua a funzionare solo su Firebase, come prima.

## NOVITÀ (31/10) – GRUPPO UNICO "YA ProFile Maker" CON ARGOMENTI
- Un solo gruppo (TG_GROUP e TG_FILES = "YA ProFile Maker") con argomenti: Chat (ex General), Documenti, File importanti, Lezioni, Atleti, Tecnici, Eventi, Video, Foto, Commercialista, Mail, Archivio. I nomi degli argomenti devono coincidere con le sezioni (attenzione: "Vido" va corretto in "Video").
- La Chat mostra solo l'argomento Chat (esclude registri #pfm, messaggi di servizio e argomenti delle sezioni).
- Nuova sezione Commercialista (commercialista.html, scheda generica titolo+nota; gruppo Home "Amministrazione"). Da arricchire con i campi della scheda.

## NOVITÀ (31/10) – HOME RIORGANIZZATA
- Tessere divise in gruppi (variabile GROUPS in index.html): Documenti e archivio (Documenti, File importanti, Documenti in scadenza, Archivio) · Persone (Tecnici, Atleti) · Attività (Lezioni, Eventi) · Media (Video, Foto) · Comunicazione (Mail). I gruppi senza nessun accesso non compaiono. Per spostare una sezione basta cambiare GROUPS; permessi e tabella account seguono lo stesso ordine.
- In cima, riquadro rosso "Da controllare" (solo se serve): documenti in scadenza e documenti da verificare in Archivio, con link diretto.

## NOVITÀ (31/10) – ARCHIVIO (conservazione 10 anni)
- Nuova sezione Archivio (archivio.html + archivio-pagina.js + conservazione.js). Chiave permessi: archivio. Serve anche la lettura su Documenti; per eliminare/riarchiviare serve la scrittura su Documenti e su Archivio.
- Quando un documento va in archivio: (1) quando la sua scadenza è passata; (2) quando viene sostituito da "Sostituisci" (il vecchio non si elimina più, va in Archivio). Lo spostamento dei scaduti lo esegue, da solo, chi ha la scrittura su Documenti quando apre Home, Documenti, Documenti in scadenza o Archivio. Data di archiviazione = giorno in cui avviene lo spostamento.
- Zona "Da conservare": 10 anni dalla data di archiviazione, nessun tasto Elimina (solo Apri e Scarica). Finito il periodo il documento passa da solo in "Verifica" (calcolato sulle date, nessuna operazione manuale).
- Zona "Verifica": l'operatore apre il documento e sceglie Elimina (definitivo, con conferma) oppure Riarchivia per 6 mesi / 1 anno / 2 anni / 5 anni / 10 anni (torna in Da conservare fino alla nuova data, poi di nuovo in Verifica).
- Dati: i documenti archiviati restano in sections/documenti/items con i campi archiviatoIl, conservaFino (AAAA-MM-GG), conservaFinoTs (Timestamp, usato dalle regole), origine (cartella di provenienza), storico (cronologia). Documenti li nasconde; la cartella originale resta nel campo origine.
- Home: tessera Archivio con numero totale e "N da verificare".
- Firestore rules: AGGIORNATE (copiare il nuovo firestore.rules e pubblicarlo): blocca l'eliminazione e l'accorciamento della conservazione anche se qualcuno aggira l'app. Limite: non protegge dall'eliminazione diretta dalla console Firebase né dei messaggi su Telegram.

## NOVITÀ (31/10) – DOCUMENTI IN SCADENZA
- Nuova sezione (documenti-in-scadenza.html + in-scadenza.js + scadenze.js condiviso). Chiave permessi: documenti-in-scadenza. Serve anche la lettura su Documenti; per sostituire serve la scrittura su Documenti e su questa sezione.
- In Documenti: ⋯ su un file → "Imposta scadenza" (campo scadenza AAAA-MM-GG sul documento; si può rimuovere). In elenco il file mostra data e giorni mancanti.
- Un file compare nella sezione quando mancano 30 giorni o meno (anche se già scaduto). Ordine: dal più urgente. La tessera Home diventa rossa con "N in scadenza"; nella pagina titolo e riquadro in rosso e, accanto a ogni file, il countdown dei giorni.
- Archivia (senza sostituire): per documenti non più obbligatori; chiede conferma e un motivo facoltativo (finisce nello storico), poi il documento va in Archivio per 10 anni.
- Sostituisci: scegli il file nuovo, nome (preso dal file, modificabile; se manca l'estensione si aggiunge quella del file) e nuova scadenza (deve essere futura). Il nuovo file va nella stessa cartella del vecchio (stella e note mantenute); il vecchio va in Archivio solo dopo il caricamento riuscito (non viene più eliminato).
- Firestore rules: nessuna modifica. Se l'admin non ha ancora dato il permesso alla nuova sezione, va assegnato dalla tabella Utenti.

## NOVITÀ (31/10) – TECNICI
- Sezione Tecnici (tecnici.html + tecnici.js): scheda per ogni tecnico, modulo chiuso apribile con "+", campi in 4 gruppi: Anagrafica (Nome, Cognome, Data di nascita, Codice fiscale) · Qualifica tecnica (Grado, Qualifiche) · Tesseramento e idoneità (ID, Numero tessera, Tesseramento valido fino al, Certificato medico valido fino al) · Informazioni (Info, Note).
- Elenco ordinato per cognome, con grado e stato di tesseramento/certificato (valido, in scadenza entro 30 giorni, scaduto); filtro "Da rinnovare o scaduti"; ricerca su tutti i campi; scheda di dettaglio con Modifica/Elimina (solo scrittura). Controllo del codice fiscale (16 caratteri) e dei doppioni.
- Dati: sections/tecnici/items/<id>: nome, cognome, nascita, cf, grado, qualifiche, idTec, tessera, tessScad, certScad, info, annotazioni, title, note (riassunto per la ricerca della Home).
- Firestore rules: nessuna modifica necessaria.

## NOVITÀ DI QUESTA SESSIONE (30/10)
- Chat: il numero di telefono si inserisce con prefisso fisso (+39) e campo "___ __________"; accetta 9 o 10 cifre; nessun esempio precompilato.
- Documenti: stella su documenti e cartelle (sempre cliccabile; senza scrittura appare un avviso). Apertura online dei file (anteprima di immagini, PDF, video, audio, testo) con Scarica; modalità "Seleziona" con download di più elementi in un unico ZIP. Miniature di immagini, PDF e video create al caricamento e, per i file già presenti, in automatico solo per quelli rimasti visibili a schermo ~2 secondi (max 40 MB).
- File importanti: mostra i documenti con la stella (da Documenti) con ricerca, Scarica, Apri online, Rinomina, Modifica (note .txt), Note, "Togli dai file importanti", selezione e ZIP. Le voci aggiunte a mano restano in fondo ("Altri elementi"). Serve anche il permesso di lettura su Documenti.
- Lezioni: modulo "Nuova lezione" chiuso e apribile con "+" (Data, Giorno automatico, Maestro, Tipologia, Rapporto, Allega file); logo dell'academy. Ogni lezione è una riga compatta (~42 px): primo riquadro = rapporto della lezione, poi i file caricati dal più vecchio al più recente (max 3 riquadri visibili, 2 frecce se i file sono più di due), poi data, giorno e maestro; menu ⋯ con "+ File", Modifica, Elimina. Barra di ricerca (cerca anche nei nomi degli allegati).
- Mail (da provare): elenco conversazioni, lettura, risposta e risposta a tutti, nuovo messaggio, allegati in invio (max 15 MB) e in scarico con anteprima online; permessi Lettura/Scrittura dalla suite.
- Promemoria: modulo condiviso promemoria.js, presente in tutte le sezioni.
- Home: il conteggio di File importanti conta i documenti con la stella (+ voci a mano); quello di Lezioni non conta i file allegati.

## MODELLO DEI DATI (Firestore)
- users/<UID>: name, email, admin, perms{ sezione: 'n'|'r'|'w' }
- sections/<sezione>/items/<id>: elementi della sezione. Documenti: kind folder|file|text, parent, size, mime, tg o chunks, note, star, thumb, thumbTry. Lezioni: date, day, master, type, report, title, note; i file allegati sono elementi con kind:'file' e lesson:<id lezione>.
- sections/<sezione>/items/<id>/chunks/<cN>: blocchi dei file salvati in Firestore (senza Telegram).
- sections/<sezione>/meta/promemoria: promemoria della pagina.
- app/promemoria: promemoria di tutte le pagine (lettura per tutti gli account, scrittura solo admin).

## LIBRERIA TELEGRAM (problema risolto)
- GramJS da CDN (esm.sh, jsDelivr) NON funziona nel browser. Soluzione: workflow GitHub Actions "Crea libreria Telegram" (.github/workflows/build-telegram.yml, avvio a mano da Actions -> Run workflow) che compila GramJS con esbuild e salva telegram-lib.js nella cartella principale. telegram.js lo carica per primo.
- Accesso a Telegram scritto a mano (sendCode + SignIn + password 2FA). Il codice arriva come messaggio nell'app Telegram. Sessione in localStorage ('tg_session'), condivisa tra Chat, Documenti, File importanti e Lezioni.

## FILE (tutti nella cartella principale del repository)
Pagine: index, documenti, mail, file-importanti, lezioni, tecnici, atleti, eventi, video, foto, chat, telegram-test (.html)
Codice: documenti.js, importanti.js, lezioni.js, tecnici.js, in-scadenza.js, scadenze.js, conservazione.js, archivio-pagina.js, sezione.js (sezioni generiche), archivio.js (salva/leggi/elimina file), file-tools.js (anteprima, ZIP, miniature), promemoria.js, telegram.js, stile.css
Configurazione: firebase-config.js (compilato), telegram-config.js (compilato), mail-config.js (da compilare con l'indirizzo /exec di Apps Script)
Altro: ponte-mail.gs (da incollare in Apps Script), logo-yanagi.png, firestore.rules, .github/workflows/build-telegram.yml
Generato da GitHub Actions: telegram-lib.js (non incluso nello zip)

## DA FARE
1. Mail (da fare dal computer): in script.google.com con l'account Gmail dell'ASD incollare ponte-mail.gs, eseguire `autorizza`, distribuire come App web (Esegui come: me; Accesso: Chiunque), copiare l'indirizzo /exec in mail-config.js. Poi provare lettura, risposta e allegati. Limite Apps Script: circa 100 destinatari al giorno per account personali.
2. Provare dal vivo: Documenti con Telegram (upload/download), stelle, File importanti, anteprima e ZIP, miniature, Lezioni con allegati, promemoria in tutte le sezioni.
3. Configurare le altre sezioni (ora generiche: elenco titolo + nota): Atleti, Eventi, Video, Foto. (Tecnici fatto.)
4. Verificare Firebase: Authentication email/password attivo, dominio yanagiacademy.github.io autorizzato, primo admin (users/<UID> con name, email, admin:true, perms vuoto).

## LIMITI NOTI
- La sessione Telegram dà accesso a tutto l'account: avvisare gli utenti (Impostazioni -> Dispositivi per revocare). La Chat ha "Esci dalla chat".
- Se il repository è pubblico, api_hash è visibile: Telegram può bloccare credenziali pubbliche (API_ID_PUBLISHED_FLOOD).
- File su Telegram: i permessi dell'app non li proteggono (conta il gruppo); nessuna garanzia di conservazione; limite 500 MB per la memoria del browser. Cartelle intere: da computer sì, da telefono poco.
- Rimuovere un account dall'app revoca l'accesso ma non cancella il login in Firebase Authentication.
- ZIP e miniature dei PDF caricano strumenti da cdnjs (serve la connessione). L'anteprima PDF su telefono può mostrare solo la prima pagina: c'è "Apri in una scheda".
- Il promemoria di tutte le pagine lo modifica solo l'admin; File importanti richiede anche la lettura su Documenti.
- Le nuove versioni dei file possono restare in cache: dopo ogni aggiornamento aprire la pagina con ?x=N in fondo all'indirizzo.
