/* === CONFIGURAZIONE TELEGRAM: una sola volta per Chat e Documenti ===
   api_id e api_hash: my.telegram.org -> API development tools
   ATTENZIONE: se nel repository hai già il tuo telegram-config.js compilato, NON sostituirlo con questo. */
export const TG_API_ID="INSERISCI";      // numero
export const TG_API_HASH="INSERISCI";    // stringa di 32 caratteri
export const TG_GROUP="YA ProFile Maker";            // nome esatto del gruppo (la Chat usa l'argomento Chat, ex General)
export const TG_FILES="YA ProFile Maker";       // stesso gruppo: file e dati, ognuno nell'argomento della sua sezione
// Facoltativo: gruppo separato solo per i dati (schede, elenchi, note). Se non lo definisci, i dati vanno nel gruppo TG_FILES, ognuno nell'argomento della sua sezione.
// export const TG_DATI="Dati ProFile Maker";
