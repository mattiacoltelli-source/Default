// Segnalazione errori lato client.
//
// Serve a sapere che la dashboard si è rotta senza doverlo scoprire
// aprendola: una pagina di monitoraggio che fallisce in silenzio è
// peggio che inutile, perché continua a sembrare rassicurante.
//
// **Bundle esplicito, non il Loader Script.** Il loader
// (js.sentry-cdn.com/<chiave>.min.js) non serve mai il codice vero per le
// organizzazioni con residenza dati in Europa come questa (de.sentry.io):
// risponde 200 ma il corpo è uno stub di 567 byte che stampa "The Sentry
// loader you are trying to use isn't working anymore" e ignora ogni
// chiamata. È lo stesso motivo per cui CineFighi e CineTracker usano il
// bundle — vedi il commento nei loro index.html.
//
// Costa 90 KB caricati sempre invece di 1,5 KB caricati solo al bisogno.
// È il prezzo della residenza dati europea, e si paga in `async`: lo
// script non blocca il rendering e la pagina funziona identica se il CDN
// non risponde.
//
// Il bundle base non contiene né session replay né tracing: manda solo
// errori, che è esattamente quello che serve qui e non consuma quota.
//
// La DSN sta in chiaro in config.js: è una chiave pubblica di sola
// scrittura, progettata per i bundle browser, e non dà accesso in lettura
// a nulla. È l'unica credenziale che può stare in questa pagina.

import { SENTRY } from "./config.js";

let inviati = 0;

export function initSentry({ release }) {
  const s = document.createElement("script");
  s.src = SENTRY.bundle;
  s.crossOrigin = "anonymous";
  s.async = true;

  s.addEventListener("load", () => {
    // Se il CDN serve qualcosa di inatteso, meglio non fare niente che
    // rompere la pagina che dovrebbe sorvegliare le altre.
    if (typeof window.Sentry?.init !== "function") return;

    window.Sentry.init({
      dsn: SENTRY.dsn,
      release,
      environment: location.hostname === "localhost" ? "development" : "production",
      sendDefaultPii: false,

      // Rumore che non è mai un bug di questa pagina: estensioni del
      // browser, script iniettati, richieste interrotte dall'utente che
      // cambia pagina. Mandarli significa imparare a ignorare la casella.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        /^AbortError/,
      ],
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],

      // Tetto per sessione: una DSN pubblica su una pagina pubblica va
      // protetta da un ciclo di errori impazzito, che altrimenti
      // manderebbe migliaia di eventi identici.
      beforeSend(event) {
        if (inviati >= SENTRY.maxEventiPerSessione) return null;
        inviati++;
        return event;
      },
    });
  });

  document.head.append(s);
}

/**
 * Segnala una rottura del contratto dati: un file di stato che esiste ma
 * non è JSON valido, o che non ha la forma attesa.
 *
 * È l'unico errore che questa pagina segnala di proposito, ed è quello che
 * conta di più: un guasto di rete si vede già a schermo ("copia locale di
 * due ore fa"), mentre un `status/*.json` malformato è un contratto rotto
 * tra due repo che nessuno noterebbe mai — la dashboard mostrerebbe solo
 * uno stato "sconosciuto" in più, indistinguibile da un controllo mai
 * eseguito.
 */
export function segnalaContrattoRotto(error, contesto) {
  window.Sentry?.captureException?.(error, { tags: { kind: "data-contract" }, extra: contesto });
}
