// Service worker minimo, con una regola sola: il guscio dell'app può stare
// in cache, i dati no.
//
// Mettere in cache anche i dati sarebbe l'errore peggiore possibile qui:
// una dashboard di monitoraggio che mostra allegramente lo stato di ieri
// pescandolo da una cache è esattamente il guasto che deve prevenire. La
// copia offline esiste (in localStorage, gestita da sources.js) ma è
// dichiarata a schermo come tale, con la sua età.

const VERSION = "v1";
const SHELL = `acc-shell-${VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1",
  "./app.js?v=1",
  "./config.js",
  "./sources.js",
  "./rules.js",
  "./predict.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
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
