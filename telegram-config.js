/* === CONFIGURAZIONE TELEGRAM – ProFile Manager (Yanagi Academy) ===
   Un solo gruppo Telegram, con gli ARGOMENTI attivi, usato da tutta la suite:
     • Chat                  (ex General)  → pagina Chat
     • Documenti, File importanti, Lezioni, Atleti, Tecnici, Eventi, Video, Foto,
       Commercialista, Mail, Archivio     → un argomento per sezione (dati e file)
   I nomi degli argomenti devono coincidere con quelli delle sezioni; se uno manca viene creato da solo. */

/* 1) Credenziali API: my.telegram.org → "API development tools".
      Copia qui gli stessi valori che hai già nel tuo telegram-config.js. */
export const TG_API_ID="33867853";      // numero
export const TG_API_HASH="4ba920adeaeb3b538669bbefb8cbc893";    // stringa di 32 caratteri

/* 2) Nome ESATTO del gruppo (maiuscole, spazi e accenti compresi). L'account Telegram usato nell'app deve farne parte. */
export const TG_GROUP="YA ProFile Maker";   // Chat
export const TG_FILES="YA ProFile Maker";   // file e dati delle sezioni

/* 3) Facoltativo: gruppo separato solo per i dati (schede, elenchi, note). Lascia commentato per usare TG_FILES. */
// export const TG_DATI="Dati ProFile Maker";
