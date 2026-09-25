// Test del motore di stato. Gira con `npm test` (node --test, nessuna
// dipendenza da installare, nessuna rete).
//
// Il caso che conta più di tutti: "PASS vecchio non è verde". Se questo
// test smette di passare, la dashboard ha ricominciato a mentire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_BY_ID, APP_BY_ID, H, PREDICT, QA_BRANCH } from "./config.js";
import { FAIL, OK, UNKNOWN, WARN, appMetrics, collectProblems, describeAge, describeAgo, describeWhen, evaluateApp, evaluateSignal, isAutomatico, lastCheck, nextFullCheck, overallLevel, recentChanges, worst } from "./rules.js";

const NOW = Date.parse("2026-09-18T20:00:00.000Z");
const hoursAgo = (h) => new Date(NOW - h * H).toISOString();

test("worst: il rosso vince su tutto, il giallo su sconosciuto", () => {
  assert.equal(worst([OK, WARN, FAIL]), FAIL);
  assert.equal(worst([OK, UNKNOWN, WARN]), WARN);
  assert.equal(worst([OK, UNKNOWN]), UNKNOWN);
  assert.equal(worst([OK, OK]), OK);
  assert.equal(worst([]), UNKNOWN);
});

test("un PASS recente è verde", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: hoursAgo(4), summary: "18 passati" }, now: NOW });
  assert.equal(s.level, OK);
  assert.equal(s.problems.length, 0);
});

test("un PASS scaduto NON è verde e lo dice esplicitamente", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: hoursAgo(300), summary: "18 passati" }, now: NOW });
  assert.equal(s.level, FAIL);
  assert.equal(s.problems.length, 1);
  assert.equal(s.problems[0].kind, "stale");
  assert.match(s.problems[0].message, /non vale più/);
});

test("un PASS di ieri è giallo: un giro notturno saltato va visto, non ignorato", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: hoursAgo(48), summary: "ok" }, now: NOW });
  assert.equal(s.level, WARN);
  assert.equal(s.problems[0].severity, "MEDIUM");
});

test("un PASS della notte scorsa è verde: il giro è giornaliero", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: hoursAgo(20), summary: "ok" }, now: NOW });
  assert.equal(s.level, OK);
  assert.equal(s.problems.length, 0);
});

test("Data Health diventa rosso con 4 giorni di margine sulla sospensione Supabase", () => {
  // Supabase free tier sospende un progetto dopo 7 giorni (168h) senza
  // richieste: il rosso deve arrivare ben prima, non insieme al danno.
  const SOSPENSIONE_H = 168;
  const rosso = evaluateSignal({ agentId: "data-health", entry: { result: "PASS", runAt: hoursAgo(73) }, now: NOW });

  assert.equal(rosso.level, FAIL);
  assert.ok(
    SOSPENSIONE_H - AGENT_BY_ID["data-health"].failH >= 96,
    "la soglia rossa di Data Health deve lasciare almeno 4 giorni prima della sospensione Supabase"
  );
});

test("un segnale mancante è sconosciuto, mai verde", () => {
  const s = evaluateSignal({ agentId: "qa", entry: undefined, now: NOW });
  assert.equal(s.level, UNKNOWN);
  assert.equal(s.headline, "Mai eseguito");
});

test("una data illeggibile è sconosciuta, non 'adesso'", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: "domani mattina" }, now: NOW });
  assert.equal(s.level, UNKNOWN);
});

test("un FAIL recente porta con sé i problemi dell'agente", () => {
  const s = evaluateSignal({
    agentId: "qa",
    entry: { result: "FAIL", runAt: hoursAgo(2), problems: [{ severity: "HIGH", message: "Test fallito: voto salvato" }] },
    now: NOW,
  });
  assert.equal(s.level, FAIL);
  assert.equal(s.problems.length, 1);
  assert.equal(s.problems[0].kind, "result");
});

test("un FAIL senza dettagli non sparisce dall'elenco", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "FAIL", runAt: hoursAgo(2), problems: [] }, now: NOW });
  assert.equal(s.problems.length, 1);
  assert.match(s.problems[0].message, /Esito FAIL/);
});

test("un FAIL vecchio somma i due problemi: è fallito ED è scaduto", () => {
  const s = evaluateSignal({
    agentId: "qa",
    entry: { result: "FAIL", runAt: hoursAgo(300), problems: [{ severity: "HIGH", message: "boom" }] },
    now: NOW,
  });
  assert.equal(s.level, FAIL);
  assert.deepEqual(s.problems.map((p) => p.kind), ["stale", "result"]);
});

test("INFRA_ERROR è giallo: non accusa l'app, ma non la promuove", () => {
  const s = evaluateSignal({ agentId: "api-doctor", entry: { result: "INFRA_ERROR", runAt: hoursAgo(2) }, now: NOW });
  assert.equal(s.level, WARN);
});

test("una app prende il peggiore dei suoi segnali", () => {
  const statusByAgent = {
    qa: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    "data-health": { data: { apps: { spot: { result: "FAIL", runAt: hoursAgo(3), problems: [{ severity: "HIGH", message: "giù" }] } } } },
    "api-doctor": { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    performance: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
  };

  const state = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });
  assert.equal(state.level, FAIL);
  assert.equal(state.problems.length, 1);
  assert.equal(state.problems[0].appLabel, "Spot");
});

test("un agente che non copre una app non la rende eternamente sconosciuta", () => {
  // Data Health e Performance non guardano Predict (nessun backend, nessuna
  // pagina misurata): senza il filtro di copertura la card resterebbe
  // gialla per sempre, qualunque cosa succeda davvero.
  const statusByAgent = {
    qa: { data: { apps: { prova: { result: "PASS", runAt: hoursAgo(3) } } } },
    "api-doctor": { data: { apps: { prova: { result: "PASS", runAt: hoursAgo(3) } } } },
    sentry: { data: { apps: { prova: { result: "PASS", runAt: hoursAgo(3) } } } },
  };

  const state = evaluateApp({ app: APP_BY_ID.prova, statusByAgent, now: NOW });
  assert.deepEqual(state.signals.map((s) => s.agentId).sort(), ["api-doctor", "qa", "sentry"]);
  assert.equal(state.level, OK);
});

test("gli errori Sentry sono un segnale come gli altri e pesano sulla card", () => {
  const statusByAgent = {
    qa: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    sentry: {
      data: {
        apps: {
          spot: { result: "WARN", runAt: hoursAgo(3), summary: "2 errori · 7 eventi in 24h", problems: [{ severity: "MEDIUM", message: "TypeError: x is not a function" }] },
        },
      },
    },
  };

  const state = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });
  assert.equal(state.level, WARN);
  assert.ok(state.problems.some((p) => /TypeError/.test(p.message)));
});

test("un agente che copre una app ma non l'ha mai controllata resta un dubbio vero", () => {
  const state = evaluateApp({ app: APP_BY_ID.cinetracker, statusByAgent: {}, now: NOW });
  assert.ok(state.signals.some((s) => s.agentId === "data-health" && s.level === UNKNOWN));
  assert.equal(state.level, UNKNOWN);
});

test("Security non finisce dentro le card delle app: riguarda la toolchain", () => {
  const statusByAgent = { security: { data: { apps: { "qa-agent": { result: "FAIL", runAt: hoursAgo(1) } } } } };
  const state = evaluateApp({ app: APP_BY_ID.cinetracker, statusByAgent, now: NOW });
  assert.ok(!state.signals.some((s) => s.agentId === "security"));
});

test("i segnali esterni entrano nel giudizio della app", () => {
  const extra = [{ agentId: "predict-slot", label: "Previsioni", level: FAIL, problems: [{ severity: "HIGH", message: "non generate" }] }];
  const state = evaluateApp({ app: APP_BY_ID.prova, statusByAgent: {}, extraSignals: extra, now: NOW });
  assert.equal(state.level, FAIL);
  assert.equal(state.problems[0].appLabel, "Predict");
});

// App inventata invece di una vera: appMetrics() è generica, e legare il
// test a una app reale lo romperebbe ogni volta che le sue metriche
// cambiano in config.js senza che il comportamento testato sia cambiato.
const APP_FINTA = {
  id: "finta",
  metrics: [
    { agent: "data-health", key: "users", label: "utenti" },
    { agent: "data-health", key: "titles", label: "titoli" },
    { agent: "data-health", key: "votes", label: "voti" },
  ],
};

test("le metriche di prodotto arrivano dall'agente che le produce", () => {
  const statusByAgent = { "data-health": { data: { apps: { finta: { metrics: { users: 7, titles: 565, votes: 961 } } } } } };
  assert.deepEqual(appMetrics(APP_FINTA, statusByAgent), [
    { label: "utenti", value: 7 },
    { label: "titoli", value: 565 },
    { label: "voti", value: 961 },
  ]);
});

test("una metrica assente non diventa zero", () => {
  const statusByAgent = { "data-health": { data: { apps: { finta: { metrics: {} } } } } };
  assert.deepEqual(appMetrics(APP_FINTA, statusByAgent), []);
});

test("i problemi sono ordinati per urgenza", () => {
  const states = [
    { problems: [{ severity: "LOW", message: "c" }] },
    { problems: [{ severity: "HIGH", message: "a" }] },
    { problems: [{ severity: "MEDIUM", message: "b" }] },
  ];
  assert.deepEqual(collectProblems(states).map((p) => p.message), ["a", "b", "c"]);
});

test("il verdetto generale è il peggiore delle app", () => {
  assert.equal(overallLevel([{ level: OK }, { level: WARN }]), WARN);
  assert.equal(overallLevel([{ level: OK }], [FAIL]), FAIL);
  assert.equal(overallLevel([{ level: OK }, { level: OK }]), OK);
});

test("le età si leggono in italiano, singolare e plurale", () => {
  assert.equal(describeAge(30 * 1000), "pochi istanti");
  assert.equal(describeAge(60 * 60 * 1000), "1 ora");
  assert.equal(describeAge(5 * 60 * 60 * 1000), "5 ore");
  assert.equal(describeAge(26 * 60 * 60 * 1000), "1 giorno");
  assert.equal(describeAge(72 * 60 * 60 * 1000), "3 giorni");
  assert.equal(describeAge(NaN), "data sconosciuta");
  assert.equal(describeAgo(30 * 1000), "adesso");
  assert.equal(describeAgo(5 * 60 * 60 * 1000), "5 ore fa");
});

test("i branch di default sono quelli veri: raw.githubusercontent distingue le maiuscole", () => {
  // Scoperto solo verificando il sito pubblicato: il repo di Predict ha il
  // branch "Main" con la maiuscola. Con "main" ogni fetch risponde 404 e la
  // app resta "sconosciuta" senza che niente dica perché — esattamente il
  // fallimento silenzioso che questa dashboard esiste per evitare.
  assert.equal(QA_BRANCH, "main");
  assert.equal(PREDICT.branch, "Main");
});

test("i commit automatici non sono 'cambiamenti recenti'", () => {
  // Predict ne produce diversi al giorno: senza filtro seppellirebbero
  // ogni modifica vera, che è l'unica cosa che questa sezione deve dire.
  assert.equal(isAutomatico("chore(performance): aggiorna storico run [skip ci]"), true);
  assert.equal(isAutomatico("Valutazione automatica 2026-09-18T23:27:56Z"), true);
  assert.equal(isAutomatico("chore: bump versione a 57bf0dd [skip ci]"), true);
  assert.equal(isAutomatico("Merge branch 'claude/x' into main"), true);
  assert.equal(isAutomatico("fix: il voto non si salvava su iOS"), false);
  assert.equal(isAutomatico("Aggiunge Sentry per gli errori lato client"), false);
});

test("la cronologia unisce le app e ordina dal più recente", () => {
  const activity = {
    cinetracker: { data: { commits: [
      { sha: "aaa", message: "fix: voto su iOS", at: new Date(NOW - 2 * H).toISOString(), url: "u1" },
      { sha: "bbb", message: "chore: bump versione [skip ci]", at: new Date(NOW - 1 * H).toISOString(), url: "u2" },
    ] } },
    spot: { data: { commits: [{ sha: "ccc", message: "Aggiunge Sentry", at: new Date(NOW - 5 * H).toISOString(), url: "u3" }] } },
  };
  const repos = [{ id: "cinetracker", label: "CineTracker" }, { id: "spot", label: "Spot" }];

  const changes = recentChanges(activity, repos);
  assert.deepEqual(changes.map((c) => c.message), ["fix: voto su iOS", "Aggiunge Sentry"]);
  assert.equal(changes[0].appLabel, "CineTracker");
});

test("senza dati dall'API la cronologia è vuota, non inventata", () => {
  assert.deepEqual(recentChanges(null, []), []);
  assert.deepEqual(recentChanges({ spot: { data: null } }, [{ id: "spot", label: "Spot" }]), []);
});

test("un segnale opzionale mai pubblicato non intacca il semaforo della app", () => {
  // Sentry richiede un secret che potrebbe non essere mai impostato. Finché
  // non pubblica, le altre cinque lenti guardano comunque quella app: una
  // integrazione non configurata non deve rendere gialla tutta la dashboard.
  const statusByAgent = {
    qa: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    "data-health": { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    "api-doctor": { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    performance: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    // sentry: assente del tutto, come quando il secret non c'è
  };

  const state = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });
  const sentry = state.signals.find((s) => s.agentId === "sentry");

  assert.equal(state.level, OK, "le altre lenti dicono PASS: la card resta verde");
  assert.equal(sentry.attivo, false, "ma il segnale si vede comunque, marcato come non attivo");
  assert.equal(sentry.headline, "Non attivo");
});

test("appena pubblica una volta, il segnale opzionale torna a giudicare", () => {
  const statusByAgent = {
    qa: { data: { apps: { spot: { result: "PASS", runAt: hoursAgo(3) } } } },
    // Ha pubblicato per un'altra app ma non per questa: è un dubbio vero,
    // non una integrazione mancante.
    sentry: { data: { apps: { prova: { result: "PASS", runAt: hoursAgo(3) } } } },
  };

  const state = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });
  const sentry = state.signals.find((s) => s.agentId === "sentry");

  assert.notEqual(sentry.attivo, false);
  assert.equal(sentry.level, UNKNOWN);
  assert.equal(state.level, UNKNOWN);
});

// ─── Ultimo controllo e prossimo giro ────────────────────────────────────
// La domanda a cui rispondono è diversa da quella della riga in cima alla
// pagina ("da quanto ho scaricato i file"): qui si parla di quando è
// girato davvero un controllo. Confonderle era il bug che queste funzioni
// esistono per chiudere.

// NOW è 2026-09-18T20:00:00Z. I test che riguardano il giorno usano solo
// scarti abbastanza grandi da restare dalla stessa parte della mezzanotte
// in qualunque fuso europeo, così la suite non dipende da TZ.
const statusCon = (righe) =>
  Object.fromEntries(righe.map(([agent, apps]) => [agent, { data: { apps } }]));

test("lastCheck: prende il run più recente fra tutti gli agenti e tutte le app", () => {
  const found = lastCheck(
    statusCon([
      ["qa", { cinetracker: { runAt: hoursAgo(30), runUrl: "u-vecchio" }, spot: { runAt: hoursAgo(4), runUrl: "u-nuovo" } }],
      ["api-doctor", { prova: { runAt: hoursAgo(9), runUrl: "u-medio" } }],
    ]),
    NOW
  );
  assert.equal(found.runUrl, "u-nuovo");
  assert.equal(found.ageMs, 4 * H);
});

test("lastCheck: senza nessuna data utilizzabile restituisce null", () => {
  assert.equal(lastCheck({}, NOW), null);
  assert.equal(lastCheck(statusCon([["qa", { spot: { runAt: "mai" } }]]), NOW), null);
  assert.equal(lastCheck(statusCon([["qa", {}]]), NOW), null);
  assert.equal(lastCheck({ qa: null }, NOW), null);
});

// Gli esiti ricostruiti dallo storico non hanno un runUrl (fromHistory in
// sources.js): la voce deve restare valida e diventare testo, non sparire.
test("lastCheck: un run senza url resta valido, solo senza link", () => {
  const found = lastCheck(statusCon([["performance", { spot: { runAt: hoursAgo(2), runUrl: null } }]]), NOW);
  assert.equal(found.runUrl, null);
  assert.equal(found.ageMs, 2 * H);
});

test("describeWhen: oggi, ieri e domani hanno un nome, il resto una data", () => {
  assert.match(describeWhen(NOW, NOW), /^oggi alle /);
  assert.match(describeWhen(NOW - 26 * H, NOW), /^ieri alle /);
  assert.match(describeWhen(NOW + 26 * H, NOW), /^domani alle /);
  assert.match(describeWhen(NOW - 5 * 24 * H, NOW), /^13 settembre alle /);
});

test("describeWhen: una data illeggibile non diventa 'NaN'", () => {
  assert.equal(describeWhen(Number.NaN, NOW), "—");
  assert.equal(describeWhen(Date.parse("mai"), NOW), "—");
});

test("nextFullCheck: è sempre nel futuro e sempre all'ora giusta UTC", () => {
  for (const ore of [0, 1, 2, 3, 12, 23]) {
    const adesso = Date.parse(`2026-09-18T${String(ore).padStart(2, "0")}:30:00.000Z`);
    const next = nextFullCheck(adesso, 2);
    assert.ok(next > adesso, `${ore}:30 -> il prossimo giro deve essere nel futuro`);
    assert.equal(new Date(next).getUTCHours(), 2);
    assert.ok(next - adesso <= 24 * H, `${ore}:30 -> mai oltre le 24 ore`);
  }
});

// L'ora attesa è cron + ritardo tipico, e quella somma può sforare le 24
// (un cron a mezzanotte più cinque ore). Date.UTC normalizza nel giorno
// dopo: qui si blinda che sia davvero così, perché è il caso che non si
// presenta con i numeri di oggi e si romperebbe in silenzio domani.
test("nextFullCheck: un'ora oltre le 23 finisce nel giorno dopo, non fuori scala", () => {
  const mezzanotte = Date.parse("2026-09-18T00:30:00.000Z");
  assert.equal(nextFullCheck(mezzanotte, 22 + 5), Date.parse("2026-09-19T03:00:00.000Z"));
});

test("describeWhen: la preposizione distingue un orario misurato da uno stimato", () => {
  assert.match(describeWhen(NOW, NOW, "verso le"), /^oggi verso le /);
  assert.match(describeWhen(NOW, NOW), /^oggi alle /);
});

test("nextFullCheck: a cavallo dell'ora del giro passa al giorno dopo", () => {
  const primaPer1min = Date.parse("2026-09-18T01:59:00.000Z");
  const dopoPer1min = Date.parse("2026-09-18T02:01:00.000Z");
  assert.equal(nextFullCheck(primaPer1min, 2), Date.parse("2026-09-18T02:00:00.000Z"));
  assert.equal(nextFullCheck(dopoPer1min, 2), Date.parse("2026-09-19T02:00:00.000Z"));
});
