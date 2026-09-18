// Tutto ciò che va cambiato quando cambia il mondo esterno sta qui: nomi
// repo, URL delle app, quali segnali esistono e ogni quanto ci si aspetta
// che arrivino. Il resto del codice non contiene costanti.

export const OWNER = "mattiacoltelli-source";
export const QA_REPO = "qa-agent";
export const QA_BRANCH = "main";

export const H = 60 * 60 * 1000;

// Usata come "release" per Sentry: serve a capire da quale versione della
// pagina arriva un errore. Va alzata quando si cambia qualcosa di
// sostanziale, insieme a VERSION in sw.js.
export const APP_VERSION = "1.1.1";

// ─── Agenti ──────────────────────────────────────────────────────────────
// `warnH`/`failH`: dopo quante ore un esito smette di valere.
//
// Non sono numeri decorativi: sono il cuore della dashboard. Un PASS di tre
// giorni fa non dice che l'app funziona, dice che tre giorni fa funzionava
// — e mostrarlo verde sarebbe una bugia.
//
// Le soglie seguono la cadenza reale: "Controllo Completo" (full-check.yml)
// gira ogni notte alle 02:00 UTC e lancia tutti e sei gli agenti. Quindi:
//
// - giallo a 36 ore: un giro saltato può succedere (i cron di GitHub
//   Actions arrivano in ritardo o non partono affatto sotto carico), ma
//   va visto;
// - rosso a 72 ore: tre notti di fila senza un giro non è un ritardo, è
//   qualcosa che si è rotto — il workflow disattivato, i secret scaduti,
//   il repo fermo da troppo tempo.
//
// Prima del giro giornaliero queste soglie erano 5 e 10 giorni, e con un
// controllo ogni 3-4 giorni la dashboard viveva quasi sempre al limite del
// giallo: una soglia che sta sempre per scattare non segnala più niente.
//
// Scale e Security restano più larghi: cambiano lentamente e un loro
// ritardo non è mai un'emergenza.
//
// Nota su Data Health: Supabase free tier sospende un progetto dopo 7
// giorni senza richieste API, e il giro notturno è ciò che tiene svegli i
// database di CineFighi e CineTracker. Col rosso a 72 ore il problema si
// vede con quattro giorni di margine sulla sospensione.
//
// `covers`: quali app quell'agente guarda davvero, letto dai `PROJECTS` dei
// rispettivi engine in qa-agent. Serve a distinguere due silenzi che si
// somigliano ma non sono la stessa cosa: "l'agente non ha ancora
// controllato questa app" (segnale scaduto, va mostrato) e "l'agente non
// controlla questa app, per costruzione" (nessun segnale, non va mostrato).
// Senza questa distinzione Predict resterebbe eternamente "sconosciuta" per
// Dati e Performance — che non la coprono perché non ha un backend né una
// pagina da misurare come le altre — e un dubbio permanente insegna in
// fretta a ignorare tutti i dubbi.
const ALL = ["cinefighi", "cinetracker", "spot", "prova"];
const CON_BACKEND = ["cinefighi", "cinetracker", "spot"];

export const AGENTS = [
  { id: "qa", label: "QA", short: "Test end-to-end", warnH: 36, failH: 72, covers: ALL },
  { id: "data-health", label: "Dati", short: "Uptime e integrità", warnH: 36, failH: 72, covers: CON_BACKEND },
  { id: "api-doctor", label: "API", short: "API esterne", warnH: 36, failH: 72, covers: ALL },
  { id: "performance", label: "Perf", short: "Lighthouse", warnH: 36, failH: 72, covers: CON_BACKEND },
  { id: "scale", label: "Scala", short: "Tenuta a molti dati", warnH: 72, failH: 168, covers: ["cinefighi"] },
  { id: "security", label: "Dipendenze", short: "npm audit di qa-agent", warnH: 72, failH: 168, covers: [] },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

// Il Security Agent guarda le dipendenze di qa-agent, non una delle quattro
// app: vive in fondo alla pagina, non dentro una card.
export const TOOLCHAIN_KEY = "qa-agent";

// ─── Le quattro app ──────────────────────────────────────────────────────
// `metrics`: solo numeri che dicono qualcosa sul prodotto. Nessuna metrica
// è qui perché "sta bene in una dashboard" — Spot infatti non ne ha
// nessuna, perché non ha un backend da cui leggerle e inventarle sarebbe
// peggio che lasciarle fuori.
export const APPS = [
  {
    id: "cinefighi",
    label: "CineFighi",
    tagline: "Cinema di gruppo",
    repo: "CineFighi",
    site: `https://${OWNER}.github.io/CineFighi/`,
    metrics: [
      { agent: "data-health", key: "users", label: "utenti" },
      { agent: "data-health", key: "titles", label: "titoli" },
      { agent: "data-health", key: "votes", label: "voti" },
    ],
  },
  {
    id: "cinetracker",
    label: "CineTracker",
    tagline: "Cinema personale",
    repo: "Cos90",
    site: `https://${OWNER}.github.io/Cos90/`,
    metrics: [{ agent: "data-health", key: "entries", label: "titoli" }],
  },
  {
    id: "spot",
    label: "Spot",
    tagline: "Guida Ionio in barca",
    repo: "Spot",
    site: `https://${OWNER}.github.io/Spot/`,
    // Nessun backend, solo localStorage sul dispositivo di chi la usa:
    // non esiste nessun numero d'uso leggibile da qui. Meglio una card
    // senza metriche che una metrica inventata.
    metrics: [],
  },
  {
    id: "prova",
    label: "Predict",
    tagline: "Previsioni AI sui mercati",
    repo: "Prova",
    site: `https://${OWNER}.github.io/Prova/`,
    // Le metriche di Predict non vengono dagli agenti ma dai dati che l'app
    // stessa committa nel suo repo: vedi predict.js.
    metrics: [],
  },
];

export const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));

// Repo interrogati per commit e deploy. qa-agent è incluso: se smette di
// funzionare, tutti i segnali qui sopra smettono di aggiornarsi.
export const REPOS = [...APPS.map((a) => ({ id: a.id, label: a.label, repo: a.repo })), { id: TOOLCHAIN_KEY, label: "QA Agent", repo: QA_REPO }];

// ─── Predict: segnali suoi ───────────────────────────────────────────────
// L'unica app che pubblica dati propri leggibili (previsioni ed esiti sono
// file committati nel suo repo), quindi l'unica che può dire da sola se sta
// facendo il suo lavoro — non solo se la pagina si apre.
export const PREDICT = {
  repo: "Prova",
  // "Main" con la maiuscola: è davvero così che si chiama il branch di
  // default di quel repo, e raw.githubusercontent distingue le maiuscole
  // (con "main" risponde 404 e Predict resterebbe "sconosciuta" per
  // sempre, senza che niente segnali il perché).
  branch: "Main",
  // Lo slot giornaliero è alle 7:00 ET e la finestra di recupero si chiude
  // entro le ~10:00 ET (vedi predict.yml). Prima di quell'ora un file
  // mancante non è un problema, è solo un lavoro non ancora dovuto.
  slotDeadlineHourET: 11,
  // Una previsione il cui orizzonte è scaduto da più di questo e che è
  // ancora in `pending.json` significa che `evaluate.yml` non l'ha
  // processata. Tre giorni coprono un fine settimana lungo senza falsi
  // allarmi: la valutazione aspetta comunque la chiusura dei mercati.
  overdueH: 72,
};

// ─── Lanciare un controllo a mano ────────────────────────────────────────
//
// Deep link alla pagina del workflow, NON una chiamata all'API.
//
// Far partire un workflow via API richiede un token con permesso
// `actions: write`. Questa pagina è statica e pubblica: un token qui dentro
// sarebbe leggibile da chiunque apra il sorgente, e sarebbe un token in
// SCRITTURA — chiunque potrebbe lanciare i workflow, consumare i minuti di
// Actions e, con lo stesso token, toccare i repo. Non esiste un modo di
// nasconderlo in una pagina statica: l'unica alternativa vera sarebbe una
// Edge Function che tiene il token lato server e fa da proxy, cioè un
// componente in più da mantenere e proteggere per risparmiare un tap.
//
// Il deep link costa un tocco in più ("Run workflow" sulla pagina GitHub) e
// zero credenziali. È lo scambio giusto per un'app personale.
const WF = (repo, file) => `https://github.com/${OWNER}/${repo}/actions/workflows/${file}`;

export const WORKFLOWS = [
  { id: "full-check", label: "Controllo Completo", detail: "Tutti e sei gli agenti, in sequenza", url: WF(QA_REPO, "full-check.yml"), primary: true },
  { id: "tests", label: "QA Agent", detail: "Test end-to-end sulle quattro app", url: WF(QA_REPO, "tests.yml") },
  { id: "data-health", label: "Data Health", detail: "Uptime e integrità dei dati", url: WF(QA_REPO, "data-health.yml") },
  { id: "api-doctor", label: "API Doctor", detail: "API esterne da cui dipendono le app", url: WF(QA_REPO, "api-doctor.yml") },
  { id: "performance", label: "Performance", detail: "Punteggi Lighthouse", url: WF(QA_REPO, "performance.yml") },
  { id: "scale", label: "Scale", detail: "CineFighi con molti più titoli", url: WF(QA_REPO, "scale.yml") },
  { id: "security", label: "Security", detail: "npm audit delle dipendenze", url: WF(QA_REPO, "security.yml") },
];

// ─── Sentry ──────────────────────────────────────────────────────────────
//
// La DSN è una chiave PUBBLICA di sola scrittura, pensata per stare in un
// bundle browser: non dà accesso in lettura a niente e non è un segreto.
// È l'unica credenziale che può stare qui dentro, e solo per questo motivo.
//
// Caricata col loader script (~1.5 KB) invece del bundle intero: scarica
// l'SDK vero solo quando c'è davvero un errore da mandare, quindi in un
// giorno normale non costa nulla. Replay e performance monitoring sono
// disattivati lato progetto — servono a un prodotto con utenti veri, qui
// brucerebbero soltanto quota.
export const SENTRY = {
  key: "e844e6a55fcc8378014c079674522711",
  dsn: "https://e844e6a55fcc8378014c079674522711@o4511991055450112.ingest.de.sentry.io/4512109896335440",
  // Tetto per sessione: una DSN pubblica su una pagina pubblica va protetta
  // da un ciclo di errori impazzito, che altrimenti manderebbe migliaia di
  // eventi identici. Il limite lato progetto esiste già, questo è la rete
  // di sicurezza che sta nel codice e si verifica leggendolo.
  maxEventiPerSessione: 10,
};

// ─── Comportamento ───────────────────────────────────────────────────────
// La cache non è un'ottimizzazione: l'API GitHub non autenticata concede 60
// richieste l'ora per indirizzo IP, e un refresh ne consuma una decina.
// Senza cache, aprire la dashboard cinque volte di seguito la romperebbe.
export const CACHE_TTL = { raw: 5 * 60 * 1000, api: 10 * 60 * 1000 };
export const CACHE_PREFIX = "acc:v1:";
