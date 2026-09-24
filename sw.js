// Service worker minimo, con una regola sola: il guscio dell'app può stare
// in cache, i dati no.
//
// Mettere in cache anche i dati sarebbe l'errore peggiore possibile qui:
// una dashboard di monitoraggio che mostra allegramente lo stato di ieri
// pescandolo da una cache è esattamente il guasto che deve prevenire. La
// copia offline esiste (in localStorage, gestita da sources.js) ma è
// dichiarata a schermo come tale, con la sua età.

const VERSION = "v11";
const SHELL = `acc-shell-${VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=3",
  "./app.js?v=3",
  "./config.js",
  "./sources.js",
  "./rules.js",
  "./predict.js",
  "./sentry.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)));
  // Non chiamiamo più skipWaiting() qui: il nuovo service worker resta "in
  // attesa" finché l'utente non preme "Aggiorna" nel banner (vedi il
  // messaggio SKIP_WAITING sotto, e initUpdateCheck() in app.js) — così un
  // aggiornamento non sostituisce mai la pagina sotto i piedi di chi la sta
  // guardando in quel momento.
});

// Prendiamo il controllo dei tab già aperti (clients.claim) SOLO quando
// questa attivazione arriva da un aggiornamento scelto dall'utente
// (messaggio SKIP_WAITING). Alla primissima installazione non c'è nulla da
// aggiornare: reclamare comunque il tab appena caricato farebbe scattare
// "controllerchange" in app.js, che ricaricherebbe la pagina da sola un
// attimo dopo la primissima apertura, senza preavviso.
let claimOnActivate = false;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => claimOnActivate && self.clients.claim())
  );
});

// Quando l'app manda il messaggio "SKIP_WAITING" (dopo che l'utente ha
// premuto "Aggiorna" nel banner), passiamo subito alla versione nuova.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    claimOnActivate = true;
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Tutto ciò che non è di questa origine è un dato (GitHub, raw): passa
  // sempre dalla rete, senza cache e senza ripieghi silenziosi.
  if (url.origin !== self.location.origin) return;

  // Il guscio: prima la cache (avvio istantaneo, funziona offline), con un
  // aggiornamento in sottofondo per la volta successiva.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
