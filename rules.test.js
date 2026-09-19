// Test del motore di stato. Gira con `npm test` (node --test, nessuna
// dipendenza da installare, nessuna rete).
//
// Il caso che conta più di tutti: "PASS vecchio non è verde". Se questo
// test smette di passare, la dashboard ha ricominciato a mentire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_BY_ID, APP_BY_ID, H, PREDICT, QA_BRANCH } from "./config.js";
import { FAIL, OK, UNKNOWN, WARN, appMetrics, collectProblems, describeAge, describeAgo, evaluateApp, evaluateSignal, isAutomatico, overallLevel, recentChanges, worst } from "./rules.js";

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

test("Scale e Security tollerano più ritardo: cambiano lentamente", () => {
  const scale = evaluateSignal({ agentId: "scale", entry: { result: "PASS", runAt: hoursAgo(48) }, now: NOW });
  assert.equal(scale.level, OK);
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

test("Scale riguarda solo CineFighi: altrove non compare nemmeno come dubbio", () => {
  const statusByAgent = { scale: { data: { apps: { cinefighi: { result: "PASS", runAt: hoursAgo(5) } } } } };

  const cinefighi = evaluateApp({ app: APP_BY_ID.cinefighi, statusByAgent, now: NOW });
  const spot = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });

  assert.ok(cinefighi.signals.some((s) => s.agentId === "scale"));
  assert.ok(!spot.signals.some((s) => s.agentId === "scale"));
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
  const state = evaluateApp({ app: APP_BY_ID.cinefighi, statusByAgent: {}, now: NOW });
  assert.ok(state.signals.some((s) => s.agentId === "data-health" && s.level === UNKNOWN));
  assert.equal(state.level, UNKNOWN);
});

test("Security non finisce dentro le card delle app: riguarda la toolchain", () => {
  const statusByAgent = { security: { data: { apps: { "qa-agent": { result: "FAIL", runAt: hoursAgo(1) } } } } };
  const state = evaluateApp({ app: APP_BY_ID.cinefighi, statusByAgent, now: NOW });
  assert.ok(!state.signals.some((s) => s.agentId === "security"));
});

test("i segnali esterni entrano nel giudizio della app", () => {
  const extra = [{ agentId: "predict-slot", label: "Previsioni", level: FAIL, problems: [{ severity: "HIGH", message: "non generate" }] }];
  const state = evaluateApp({ app: APP_BY_ID.prova, statusByAgent: {}, extraSignals: extra, now: NOW });
  assert.equal(state.level, FAIL);
  assert.equal(state.problems[0].appLabel, "Predict");
});

test("le metriche di prodotto arrivano dall'agente che le produce", () => {
  const statusByAgent = { "data-health": { data: { apps: { cinefighi: { metrics: { users: 7, titles: 565, votes: 961 } } } } } };
  assert.deepEqual(appMetrics(APP_BY_ID.cinefighi, statusByAgent), [
    { label: "utenti", value: 7 },
    { label: "titoli", value: 565 },
    { label: "voti", value: 961 },
  ]);
});

test("una metrica assente non diventa zero", () => {
  const statusByAgent = { "data-health": { data: { apps: { cinefighi: { metrics: {} } } } } };
  assert.deepEqual(appMetrics(APP_BY_ID.cinefighi, statusByAgent), []);
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
    cinefighi: { data: { commits: [
      { sha: "aaa", message: "fix: voto su iOS", at: new Date(NOW - 2 * H).toISOString(), url: "u1" },
      { sha: "bbb", message: "chore: bump versione [skip ci]", at: new Date(NOW - 1 * H).toISOString(), url: "u2" },
    ] } },
    spot: { data: { commits: [{ sha: "ccc", message: "Aggiunge Sentry", at: new Date(NOW - 5 * H).toISOString(), url: "u3" }] } },
  };
  const repos = [{ id: "cinefighi", label: "CineFighi" }, { id: "spot", label: "Spot" }];

  const changes = recentChanges(activity, repos);
  assert.deepEqual(changes.map((c) => c.message), ["fix: voto su iOS", "Aggiunge Sentry"]);
  assert.equal(changes[0].appLabel, "CineFighi");
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
    sentry: { data: { apps: { cinefighi: { result: "PASS", runAt: hoursAgo(3) } } } },
  };

  const state = evaluateApp({ app: APP_BY_ID.spot, statusByAgent, now: NOW });
  const sentry = state.signals.find((s) => s.agentId === "sentry");

  assert.notEqual(sentry.attivo, false);
  assert.equal(sentry.level, UNKNOWN);
  assert.equal(state.level, UNKNOWN);
});
