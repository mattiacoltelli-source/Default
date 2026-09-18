// Segnali che riguardano solo Predict (repo `Prova`).
//
// È l'unica delle quattro app che pubblica i propri dati come file
// committati — previsioni, esiti, stato degli slot — e quindi l'unica che
// può dire da sola se sta facendo il suo lavoro, non solo se la pagina si
// apre. Le altre tre hanno bisogno di un agente che le guardi da fuori.
//
// Il segnale più importante di tutta la dashboard nasce qui, ed è
// un'assenza: se il file dello slot di oggi non c'è, la previsione non è
// stata generata. GitHub mostra i run avvenuti; nessuno strumento mostra
// quelli mancati. Funzioni pure, testate in predict.test.js.

import { OWNER, PREDICT, H } from "./config.js";
import { FAIL, OK, UNKNOWN, WARN, describeAge } from "./rules.js";

const PREDICT_WORKFLOW = `https://github.com/${OWNER}/${PREDICT.repo}/actions/workflows/predict.yml`;
const EVALUATE_WORKFLOW = `https://github.com/${OWNER}/${PREDICT.repo}/actions/workflows/evaluate.yml`;

/**
 * Data e ora correnti nel fuso di New York, che è quello in cui Predict
 * ragiona (gli slot sono in ET, non in ora italiana). Calcolarlo con
 * Intl invece che con un offset fisso evita di sbagliare nelle settimane in
 * cui Italia e Stati Uniti non hanno ancora fatto entrambi il cambio d'ora.
 */
export function easternNow(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

/**
 * I segnali di Predict, nella stessa forma di quelli prodotti da
 * `evaluateSignal` in rules.js, così la card non deve distinguerli.
 */
export function predictSignals({ data, now }) {
  const et = easternNow(now);
  return [predictionSignal(data, et), evaluationSignal(data, now)];
}

function predictionSignal(data, et) {
  const base = { agentId: "predict-slot", label: "Previsioni", short: "Slot giornaliero 7:00 ET", runAt: null, ageMs: null, runUrl: PREDICT_WORKFLOW, problems: [] };

  // predict.yml gira solo dal lunedì al venerdì e predict_run.py salta
  // comunque il fine settimana: un file mancante di sabato non è un guasto.
  if (et.weekend) return { ...base, level: OK, headline: "Mercati chiusi" };

  if (!data) return { ...base, level: UNKNOWN, headline: "Stato non leggibile" };
  if (data.slotsToday) return { ...base, level: OK, headline: "Generate oggi" };

  // Prima che la finestra di recupero si chiuda, l'assenza del file non è
  // un problema: è solo lavoro non ancora dovuto. Segnalarlo alle 9 del
  // mattino italiane sarebbe il classico falso allarme che insegna a
  // ignorare gli allarmi veri.
  if (et.hour < PREDICT.slotDeadlineHourET) return { ...base, level: OK, headline: "Slot non ancora dovuto" };

  return {
    ...base,
    level: FAIL,
    headline: "Non generate oggi",
    problems: [
      {
        severity: "HIGH",
        kind: "missing-run",
        // Il titolo del problema, non le istruzioni per risolverlo: il
        // link della riga porta già dove si rilancia il workflow.
        message: "Previsioni di oggi non generate (slot delle 7:00 ET passato)",
        url: PREDICT_WORKFLOW,
      },
    ],
  };
}

function evaluationSignal(data, now) {
  const base = { agentId: "predict-eval", label: "Valutazioni", short: "Esiti degli orizzonti scaduti", runAt: null, ageMs: null, runUrl: EVALUATE_WORKFLOW, problems: [] };

  if (!data?.pending) return { ...base, level: UNKNOWN, headline: "Elenco non leggibile" };

  // Una previsione il cui orizzonte è scaduto da giorni e che è ancora in
  // `pending.json` significa che evaluate.yml non l'ha processata: è il
  // modo in cui quel workflow fallisce in silenzio, senza che niente
  // diventi rosso da nessuna parte.
  const cutoff = now - PREDICT.overdueH * H;
  const overdue = data.pending.filter((p) => {
    const target = Date.parse(p.target_at ?? "");
    return Number.isFinite(target) && target < cutoff;
  });

  const reportAge = data.report?.updatedAt ? now - Date.parse(data.report.updatedAt) : null;
  const headline = overdue.length
    ? `${overdue.length} in ritardo`
    : `${data.pending.length} in attesa${Number.isFinite(reportAge) ? ` · valutate ${describeAge(reportAge)} fa` : ""}`;

  if (overdue.length === 0) return { ...base, level: OK, headline };

  return {
    ...base,
    level: overdue.length > 3 ? FAIL : WARN,
    headline,
    problems: [
      {
        severity: overdue.length > 3 ? "HIGH" : "MEDIUM",
        kind: "missing-run",
        message: `${overdue.length} previsioni con orizzonte scaduto da oltre ${PREDICT.overdueH / 24} giorni non ancora valutate (${overdue
          .slice(0, 3)
          .map((p) => `${p.asset} ${p.horizon}`)
          .join(", ")}${overdue.length > 3 ? "…" : ""}).`,
        url: EVALUATE_WORKFLOW,
      },
    ],
  };
}

/**
 * Le metriche di prodotto di Predict.
 *
 * L'accuratezza è affiancata alla baseline "classe più frequente" perché da
 * sola non significa nulla: il progetto misura se un'AI batte il caso, e
 * senza il termine di paragone un 35% sembra un voto scolastico invece che
 * il risultato dell'esperimento. Non è un allarme: un'AI che perde contro
 * la baseline è un esito dell'esperimento, non un guasto da riparare.
 */
export function predictMetrics(data) {
  const report = data?.report;
  if (!report) return [];

  const metrics = [];
  if (report.evaluated != null) metrics.push({ label: "valutate", value: report.evaluated });
  if (report.accuracy != null) metrics.push({ label: "accuratezza", value: `${report.accuracy}%` });
  if (report.baseline != null) metrics.push({ label: "baseline", value: `${report.baseline}%`, muted: true });
  return metrics;
}
