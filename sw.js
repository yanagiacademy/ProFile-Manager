/* Service worker ProFile Manager: rete prima, cache solo come ripiego offline.
   Le richieste usano cache:"no-cache": il browser chiede sempre al server se il file è cambiato (risposta 304 se uguale),
   così pagine e script non restano vecchi nella cache HTTP di GitHub Pages (che li tiene fino a 10 minuti).
   Non tocca Firebase, Telegram o altre richieste verso altri domini. */
const CACHE = "pfm-shell";
const SHELL = ["./", "./index.html", "./stile.css", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(r, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || (r.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
