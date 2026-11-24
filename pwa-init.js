/* PWA: registra il service worker e tiene l'app aggiornata.
   - controlla se c'è una versione nuova ogni volta che l'app torna in primo piano e ogni 30 minuti;
   - quando una versione nuova prende il controllo, ricarica la pagina una sola volta, ma solo se è appena stata aperta
     (così non si perde ciò che l'utente sta scrivendo). */
if ("serviceWorker" in navigator) {
  const aveva = !!navigator.serviceWorker.controller;
  let ricaricata = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!aveva || ricaricata || performance.now() > 15000) return;
    ricaricata = true; location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(reg => {
      const controlla = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controlla(); });
      setInterval(controlla, 30 * 60 * 1000);
    }).catch(() => {});
  });
}
