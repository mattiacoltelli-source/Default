// Segnalazione errori lato client.
//
// Serve a sapere che la dashboard si è rotta senza doverlo scoprire
// aprendola: una pagina di monitoraggio che fallisce in silenzio è
// peggio che inutile, perché continua a sembrare rassicurante.
//
// Tre scelte deliberate:
//
// 1. **Loader script, non bundle.** ~1,5 KB che scaricano l'SDK vero solo
//    quando c'è davvero un errore. In un giorno senza errori — cioè quasi
//    tutti — non costa niente, il che conta su un telefono di fascia media.
// 2. **Niente replay né tracing.** Disattivati anche lato progetto Sentry.
//    Servono a un prodotto con utenti veri; qui brucerebbero solo quota.
// 3. **Un tetto per sessione.** Un ciclo di errori impazzito manderebbe
//    migliaia di eventi identici da una pagina pubblica. Dopo N eventi
//    questa sessione smette di parlare.
//
// La DSN sta in chiaro in config.js: è una chiave pubblica di sola
// scrittura, progettata per i bundle browser, e non dà accesso in lettura
// a nulla. È l'unica credenziale che può stare in questa pagina.

import { SENTRY } from "./config.js";

let inviati = 0;

export function initSentry({ release }) {
  // Prima dell'SDK: il loader la legge quando è pronto.
  window.sentryOnLoad = () => {
    window.Sentry?.init({
      dsn: SENTRY.dsn,
      release,
      environment: location.hostname === "localhost" ? "development" : "production",
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,

      // Rumore che non è mai un bug di questa pagina: estensioni del
      // browser, script iniettati, richieste interrotte dall'utente che
      // cambia pagina. Mandarli significa imparare a ignorare la casella.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        /^AbortError/,
        /extension\//i,
      ],
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],

      beforeSend(event) {
        if (inviati >= SENTRY.maxEventiPerSessione) return null;
        inviati++;
        return event;
      },
    });
  };

  const s = document.createElement("script");
  s.src = `https://js.sentry-cdn.com/${SENTRY.key}.min.js`;
  s.crossOrigin = "anonymous";
  s.async = true;
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
  window.Sentry?.captureException(error, { tags: { kind: "data-contract" }, extra: contesto });
}
