// Test del motore di stato. Gira con `npm test` (node --test, nessuna
// dipendenza da installare, nessuna rete).
//
// Il caso che conta più di tutti: "PASS vecchio non è verde". Se questo
// test smette di passare, la dashboard ha ricominciato a mentire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_BY_ID, H } from "./config.js";
import { FAIL, OK, UNKNOWN, WARN, appMetrics, collectProblems, describeAge, describeAgo, evaluateApp, evaluateSignal, overallLevel, worst } from "./rules.js";

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

test("un PASS un po' vecchio è giallo, non ancora rosso", () => {
  const s = evaluateSignal({ agentId: "qa", entry: { result: "PASS", runAt: hoursAgo(130), summary: "ok" }, now: NOW });
  assert.equal(s.level, WARN);
  assert.equal(s.problems[0].severity, "MEDIUM");
});

test("Data Health scade a 7 giorni, la soglia della sospensione Supabase", () => {
  const appena = evaluateSignal({ agentId: "data-health", entry: { result: "PASS", runAt: hoursAgo(149) }, now: NOW });
  const oltre = evaluateSignal({ agentId: "data-health", entry: { result: "PASS", runAt: hoursAgo(169) }, now: NOW });
  assert.equal(appena.level, OK);
  assert.equal(oltre.level, FAIL);
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
  };

  const state = evaluateApp({ app: APP_BY_ID.prova, statusByAgent, now: NOW });
  assert.deepEqual(state.signals.map((s) => s.agentId).sort(), ["api-doctor", "qa"]);
  assert.equal(state.level, OK);
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
