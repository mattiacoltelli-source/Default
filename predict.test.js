// Test dei segnali di Predict. Il più importante è il fuso orario: gli slot
// sono in ora di New York e il confine tra "non ancora dovuto" e "non
// generato" cade in mezzo alla giornata italiana. Sbagliarlo significa
// allarmi rossi ogni mattina — e un allarme che grida al lupo tutti i
// giorni è peggio di nessun allarme.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H } from "./config.js";
import { FAIL, OK, UNKNOWN, WARN } from "./rules.js";
import { easternNow, predictMetrics, predictSignals } from "./predict.js";

const at = (iso) => Date.parse(iso);
const signalsOf = (data, iso) => Object.fromEntries(predictSignals({ data, now: at(iso) }).map((s) => [s.agentId, s]));

test("easternNow converte davvero in ora di New York", () => {
  // 2026-09-18T02:00Z è ancora il 17 settembre a New York (EDT, -4).
  const et = easternNow(at("2026-09-18T02:00:00Z"));
  assert.equal(et.date, "2026-09-17");
  assert.equal(et.hour, 22);
  assert.equal(et.weekend, false);
});

test("easternNow riconosce il fine settimana", () => {
  assert.equal(easternNow(at("2026-09-19T15:00:00Z")).weekend, true); // sabato
  assert.equal(easternNow(at("2026-09-21T15:00:00Z")).weekend, false); // lunedì
});

test("slot generato: verde", () => {
  const s = signalsOf({ slotsToday: { date: "2026-09-18", done_slots: ["07:00"] }, pending: [] }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-slot"].level, OK);
  assert.equal(s["predict-slot"].headline, "Generate oggi");
});

test("slot mancante ma finestra ancora aperta: non è un problema", () => {
  // 12:00Z = 08:00 ET, prima della chiusura della finestra di recupero.
  const s = signalsOf({ slotsToday: null, pending: [] }, "2026-09-18T12:00:00Z");
  assert.equal(s["predict-slot"].level, OK);
  assert.equal(s["predict-slot"].headline, "Slot non ancora dovuto");
});

test("slot mancante a finestra chiusa: è IL problema", () => {
  // 18:00Z = 14:00 ET, la finestra si è chiusa da un pezzo.
  const s = signalsOf({ slotsToday: null, pending: [] }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-slot"].level, FAIL);
  assert.equal(s["predict-slot"].problems[0].severity, "HIGH");
  assert.match(s["predict-slot"].problems[0].message, /non generate/i);
  assert.match(s["predict-slot"].problems[0].url, /predict\.yml$/);
});

test("nel fine settimana lo slot mancante non allarma", () => {
  const s = signalsOf({ slotsToday: null, pending: [] }, "2026-09-19T18:00:00Z");
  assert.equal(s["predict-slot"].level, OK);
  assert.equal(s["predict-slot"].headline, "Mercati chiusi");
});

test("dati non leggibili: sconosciuto, non verde", () => {
  const s = signalsOf(null, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-slot"].level, UNKNOWN);
  assert.equal(s["predict-eval"].level, UNKNOWN);
});

test("valutazioni: nessun orizzonte scaduto è verde", () => {
  const pending = [{ asset: "AAPL", horizon: "1m", target_at: "2026-10-15T00:00:00+00:00" }];
  const s = signalsOf({ slotsToday: {}, pending, report: null }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-eval"].level, OK);
  assert.match(s["predict-eval"].headline, /1 in attesa/);
});

test("valutazioni: un orizzonte scaduto da giorni è giallo", () => {
  const stale = new Date(at("2026-09-18T18:00:00Z") - 100 * H).toISOString();
  const s = signalsOf({ slotsToday: {}, pending: [{ asset: "NVDA", horizon: "1d", target_at: stale }] }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-eval"].level, WARN);
  assert.match(s["predict-eval"].problems[0].message, /NVDA 1d/);
});

test("valutazioni: molti orizzonti scaduti sono rossi", () => {
  const stale = new Date(at("2026-09-18T18:00:00Z") - 100 * H).toISOString();
  const pending = ["NVDA", "AAPL", "MSFT", "SPY"].map((asset) => ({ asset, horizon: "1d", target_at: stale }));
  const s = signalsOf({ slotsToday: {}, pending }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-eval"].level, FAIL);
  assert.match(s["predict-eval"].problems[0].message, /…/);
});

test("un orizzonte scaduto ieri non allarma: la valutazione aspetta la chiusura", () => {
  const yesterday = new Date(at("2026-09-18T18:00:00Z") - 20 * H).toISOString();
  const s = signalsOf({ slotsToday: {}, pending: [{ asset: "NVDA", horizon: "1d", target_at: yesterday }] }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-eval"].level, OK);
});

test("una data illeggibile in pending non viene contata come ritardo", () => {
  const s = signalsOf({ slotsToday: {}, pending: [{ asset: "NVDA", horizon: "1d", target_at: "presto" }] }, "2026-09-18T18:00:00Z");
  assert.equal(s["predict-eval"].level, OK);
});

test("l'accuratezza viaggia sempre insieme alla sua baseline", () => {
  const metrics = predictMetrics({ report: { evaluated: 51, accuracy: 35.3, baseline: 46 } });
  assert.deepEqual(metrics.map((m) => m.label), ["valutate", "accuratezza", "baseline"]);
  assert.equal(metrics[1].value, "35.3%");
  assert.equal(metrics[2].muted, true);
});

test("senza report non si inventano metriche", () => {
  assert.deepEqual(predictMetrics(null), []);
  assert.deepEqual(predictMetrics({ report: null }), []);
});
