// Tutto ciò che va cambiato quando cambia il mondo esterno sta qui: nomi
// repo, URL delle app, quali segnali esistono e ogni quanto ci si aspetta
// che arrivino. Il resto del codice non contiene costanti.

export const OWNER = "mattiacoltelli-source";
export const QA_REPO = "qa-agent";
export const QA_BRANCH = "main";

export const H = 60 * 60 * 1000;

// ─── Agenti ──────────────────────────────────────────────────────────────
// `warnH`/`failH`: dopo quante ore un esito smette di valere.
//
// Non sono numeri decorativi: sono il cuore della dashboard. Un PASS di
// dieci giorni fa non dice che l'app funziona, dice che dieci giorni fa
// funzionava — e mostrarlo verde sarebbe una bugia. Le soglie vengono dalla
// cadenza reale dei workflow in qa-agent:
//
// - "Controllo Completo" (full-check.yml) gira lunedì e giovedì alle 06:00
//   UTC e lancia tutti e sei gli agenti: l'intervallo normale più lungo è
//   quindi 4 giorni (giovedì → lunedì). 5 giorni = qualcosa non è partito.
// - Data Health ha in più un suo giro ogni 6 giorni, ma la soglia qui è
//   un'altra: Supabase free tier sospende un progetto dopo 7 giorni senza
//   richieste API. Oltre quel limite CineFighi e CineTracker si spengono da
//   soli. È l'unica soglia dettata da una conseguenza reale, non da un cron.
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
  { id: "qa", label: "QA", short: "Test end-to-end", warnH: 120, failH: 240, covers: ALL },
  { id: "data-health", label: "Dati", short: "Uptime e integrità", warnH: 150, failH: 168, covers: CON_BACKEND },
  { id: "api-doctor", label: "API", short: "API esterne", warnH: 120, failH: 240, covers: ALL },
  { id: "performance", label: "Perf", short: "Lighthouse", warnH: 120, failH: 240, covers: CON_BACKEND },
  { id: "scale", label: "Scala", short: "Tenuta a molti dati", warnH: 240, failH: 480, covers: ["cinefighi"] },
  { id: "security", label: "Dipendenze", short: "npm audit di qa-agent", warnH: 240, failH: 480, covers: [] },
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
  branch: "main",
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

// ─── Comportamento ───────────────────────────────────────────────────────
// La cache non è un'ottimizzazione: l'API GitHub non autenticata concede 60
// richieste l'ora per indirizzo IP, e un refresh ne consuma una decina.
// Senza cache, aprire la dashboard cinque volte di seguito la romperebbe.
export const CACHE_TTL = { raw: 5 * 60 * 1000, api: 10 * 60 * 1000 };
export const CACHE_PREFIX = "acc:v1:";
