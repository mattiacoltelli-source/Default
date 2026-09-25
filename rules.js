// Il motore della dashboard: da "cosa dicono gli agenti" a "devo
// preoccuparmi?".
//
// Funzioni pure, nessuna I/O e nessun DOM: si possono eseguire con
// `node --test` (vedi rules.test.js) senza browser né rete.
//
// L'idea attorno a cui gira tutto: **un esito vecchio non è un esito**.
// Un PASS di dieci giorni fa non dice che l'app funziona oggi, dice che
// funzionava dieci giorni fa. Mostrarlo verde sarebbe la bugia più
// pericolosa che una dashboard di monitoraggio possa raccontare, perché
// somiglia esattamente a una buona notizia. Per questo la scadenza di un
// segnale pesa quanto il suo esito, e il peggiore dei due vince.

import { AGENTS, AGENT_BY_ID, H } from "./config.js";

export const OK = "ok";
export const WARN = "warn";
export const FAIL = "fail";
export const UNKNOWN = "unknown";

// Ordine di gravità per il riassunto: il primo trovato vince. `warn` viene
// prima di `unknown` perché un problema noto è più azionabile di
// un'informazione mancante, pur meritando entrambi attenzione.
const BY_SEVERITY = [FAIL, WARN, UNKNOWN, OK];

export function worst(levels) {
  return BY_SEVERITY.find((level) => levels.includes(level)) ?? UNKNOWN;
}

const RESULT_LEVEL = {
  PASS: OK,
  WARN: WARN,
  // La richiesta non è mai arrivata a destinazione: non dice nulla sull'app,
  // ma nemmeno permette di dichiararla sana.
  INFRA_ERROR: WARN,
  FAIL: FAIL,
};

/**
 * Valuta un singolo segnale (un agente su una app).
 *
 * Restituisce sempre un oggetto, anche quando non c'è niente da valutare:
 * "sconosciuto" è un risultato legittimo e va mostrato, non nascosto.
 * Un segnale che manca in silenzio è come un segnale verde, ed è il modo
 * più comune in cui una dashboard smette di dire la verità.
 */
export function evaluateSignal({ agentId, entry, now }) {
  const agent = AGENT_BY_ID[agentId];
  const base = { agentId, label: agent?.label ?? agentId, short: agent?.short ?? "", problems: [] };

  if (!entry) {
    return { ...base, level: UNKNOWN, headline: "Mai eseguito", runAt: null, ageMs: null, runUrl: null };
  }

  const runAt = Date.parse(entry.runAt ?? "");
  if (!Number.isFinite(runAt)) {
    return { ...base, level: UNKNOWN, headline: "Data sconosciuta", runAt: null, ageMs: null, runUrl: entry.runUrl ?? null };
  }

  const ageMs = now - runAt;
  const staleLevel = ageMs > agent.failH * H ? FAIL : ageMs > agent.warnH * H ? WARN : OK;
  const resultLevel = RESULT_LEVEL[entry.result] ?? UNKNOWN;
  const level = worst([staleLevel, resultLevel]);

  const problems = [];
  if (staleLevel !== OK) {
    problems.push({
      severity: staleLevel === FAIL ? "HIGH" : "MEDIUM",
      kind: "stale",
      // Senza prefisso dell'agente: chi legge ha già "CINEFIGHI · DATI"
      // sopra la riga, ripeterlo raddoppia il testo senza aggiungere nulla.
      message: `Nessun controllo da ${describeAge(ageMs)}${entry.result === "PASS" ? " — l'ultimo esito era PASS, ma non vale più" : ""}`,
    });
  }
  if (resultLevel !== OK && resultLevel !== UNKNOWN) {
    for (const p of entry.problems ?? []) problems.push({ ...p, kind: "result" });
    // Un agente può dire FAIL senza allegare dettagli: meglio una riga
    // generica che un problema che sparisce dall'elenco.
    if ((entry.problems ?? []).length === 0) {
      problems.push({ severity: resultLevel === FAIL ? "HIGH" : "MEDIUM", kind: "result", message: `Esito ${entry.result}, senza dettagli nel report` });
    }
  }

  return {
    ...base,
    level,
    headline: entry.summary || entry.result || "",
    result: entry.result,
    runAt,
    ageMs,
    runUrl: entry.runUrl ?? null,
    metrics: entry.metrics ?? {},
    problems,
  };
}

/**
 * Riunisce i segnali di una app in un unico stato.
 *
 * `extraSignals` sono segnali già valutati che non vengono dagli agenti
 * (oggi: quelli che Predict produce da sé, vedi predict.js).
 */
export function evaluateApp({ app, statusByAgent, extraSignals = [], now }) {
  // Un agente compare sulla card solo se quell'app rientra nel suo raggio
  // d'azione (vedi `covers` in config.js). Data Health e Performance non
  // guardano Predict, il Security Agent non guarda nessuna app: mostrarli
  // come "sconosciuti" sarebbe un dubbio che non si risolverà mai, e i
  // dubbi permanenti sono il modo più veloce per insegnare a ignorarli.
  const signals = AGENTS
    .filter((agent) => agent.covers.includes(app.id))
    .map((agent) => {
      const pubblicato = statusByAgent[agent.id]?.data != null;
      const signal = evaluateSignal({ agentId: agent.id, entry: statusByAgent[agent.id]?.data?.apps?.[app.id], now });
      // Opzionale e mai pubblicato = non ancora configurato: si mostra, ma
      // non giudica. Appena pubblica una volta torna un segnale come tutti
      // gli altri, scadenza compresa.
      return agent.optional && !pubblicato ? { ...signal, attivo: false, headline: "Non attivo" } : signal;
    });

  const all = [...signals, ...extraSignals];
  const problems = all.flatMap((s) =>
    s.problems.map((p) => ({ ...p, appId: app.id, appLabel: app.label, signal: s.label, url: p.url ?? s.runUrl ?? null }))
  );

  const giudicanti = all.filter((s) => s.attivo !== false);

  return { id: app.id, label: app.label, tagline: app.tagline, site: app.site, level: worst(giudicanti.map((s) => s.level)), signals: all, problems };
}

/** Metriche di prodotto di una app, prese dallo stato dell'agente che le produce. */
export function appMetrics(app, statusByAgent) {
  return app.metrics
    .map(({ agent, key, label }) => ({ label, value: statusByAgent[agent]?.data?.apps?.[app.id]?.metrics?.[key] }))
    .filter((m) => m.value != null);
}

/**
 * L'elenco che risponde alla domanda della home, ordinato per urgenza:
 * prima i rossi, poi i gialli, e dentro ciascuno prima le severità alte.
 */
export function collectProblems(appStates, extra = []) {
  const weight = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return [...appStates.flatMap((a) => a.problems), ...extra].sort(
    (a, b) => (weight[a.severity] ?? 3) - (weight[b.severity] ?? 3)
  );
}

/** Il verdetto unico in cima alla pagina. */
export function overallLevel(appStates, extraLevels = []) {
  return worst([...appStates.map((a) => a.level), ...extraLevels]);
}

// ─── Formattazione ───────────────────────────────────────────────────────
// Sta qui e non in un modulo a parte perché è parte del giudizio: "3 giorni"
// e "72 ore" sono lo stesso numero ma non la stessa informazione.

export function describeAge(ms) {
  if (!Number.isFinite(ms)) return "data sconosciuta";
  // Il confronto va fatto prima dell'arrotondamento: 30 secondi
  // arrotondati sono "1 minuto", che è un'ora di nascita sbagliata per un
  // dato appena arrivato.
  if (ms < 60000) return "pochi istanti";

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minuti"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "ora" : "ore"}`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "giorno" : "giorni"}`;

  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "mese" : "mesi"}`;
}

export function describeAgo(ms) {
  const age = describeAge(ms);
  return age === "pochi istanti" ? "adesso" : `${age} fa`;
}

export function clockTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

// "14 ore fa" dice se un dato è vecchio, non se il giro di stanotte è
// partito: per quello serve l'ora, e l'ora da sola non dice se è di oggi.
// Vanno dette tutte e due, ed è per questo che questa funzione esiste
// accanto a describeAgo invece che al posto suo.
//
// Il giorno si confronta in ora locale, non UTC: chi legge sta guardando
// il suo orologio, e un controllo delle 02:00 UTC in Italia è "oggi alle
// 03:00" o "alle 04:00" a seconda del periodo dell'anno, mai "ieri".
// `prep` esiste per una ragione sola: un orario misurato ("oggi ALLE
// 08:52") e un orario stimato ("domani VERSO LE 09:00") non vanno detti
// con la stessa parola, o la stima si legge come una promessa.
export function describeWhen(timestamp, now, prep = "alle") {
  if (!Number.isFinite(timestamp)) return "—";

  const giorno = (t) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const scarto = Math.round((giorno(timestamp) - giorno(now)) / (24 * H));
  const ora = clockTime(timestamp);

  if (scarto === 0) return `oggi ${prep} ${ora}`;
  if (scarto === -1) return `ieri ${prep} ${ora}`;
  if (scarto === 1) return `domani ${prep} ${ora}`;

  const data = new Date(timestamp).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return `${data} ${prep} ${ora}`;
}

/**
 * Quando è stato fatto l'ultimo controllo davvero.
 *
 * Non è la stessa cosa della riga in cima alla pagina, che dice da quanto
 * la dashboard ha SCARICATO i file: quella può dire "adesso" mentre
 * l'ultimo giro è di stanotte. Sono due domande diverse e la seconda è
 * quella che conta, quindi ha una voce sua.
 *
 * Si prende il run più recente fra tutti gli agenti e tutte le app, non il
 * più vecchio: la domanda è "quando è stata l'ultima volta che qualcosa ha
 * controllato", non "quanto è indietro il più pigro" — quello lo dicono
 * già le età dentro le card, segnale per segnale, che è il posto dove
 * serve saperlo.
 */
export function lastCheck(statusByAgent, now) {
  let migliore = null;

  for (const [agentId, res] of Object.entries(statusByAgent ?? {})) {
    for (const entry of Object.values(res?.data?.apps ?? {})) {
      const runAt = Date.parse(entry?.runAt ?? "");
      if (!Number.isFinite(runAt)) continue;
      if (migliore && migliore.runAt >= runAt) continue;
      migliore = { runAt, runUrl: entry.runUrl ?? null, agentId, label: AGENT_BY_ID[agentId]?.label ?? agentId };
    }
  }

  return migliore && { ...migliore, ageMs: now - migliore.runAt };
}

/**
 * Quando aspettarsi il prossimo giro notturno.
 *
 * Serve a dare un senso al numero qui sopra: "14 ore fa" da solo sembra un
 * ritardo, con accanto il prossimo giro diventa un'attesa normale — o, se
 * il prossimo è fra poco, un buon motivo per non lanciare niente a mano.
 *
 * `utcHour` è l'ora ATTESA, non quella del cron: vedi FULL_CHECK in
 * config.js per la differenza (e per quanto vale). Può superare 23 —
 * cron a mezzanotte più qualche ora di ritardo — e Date.UTC normalizza da
 * sé nel giorno dopo, che è esattamente il comportamento giusto.
 *
 * Resta una stima. Le soglie di scadenza in config.js esistono proprio
 * perché i giri saltano, e restano loro a decidere quando un ritardo
 * diventa un problema: questa riga informa, non giudica.
 */
export function nextFullCheck(now, utcHour) {
  const d = new Date(now);
  const oggi = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utcHour);
  return oggi > now ? oggi : oggi + 24 * H;
}

// ─── Cambiamenti recenti ─────────────────────────────────────────────────

// Commit che le macchine scrivono a se stesse: bump di versione, storico
// salvato, previsioni valutate, snapshot di prezzo. Sono il segno che
// l'automazione funziona, non una risposta a "cosa ho cambiato io?" —
// e sono così frequenti (Predict ne produce diversi al giorno) che
// lasciarli seppellirebbe ogni modifica vera sotto una colonna di rumore.
const AUTOMATICI = [
  /\[skip ci\]/i,
  /^chore\(/i,
  /^Valutazione automatica/i,
  /^Analisi trend/i,
  /^Snapshot/i,
  /^Merge branch/i,
  /^Merge pull request/i,
  /bump (della )?versione/i,
  /bump asset version/i,
];

export function isAutomatico(messaggio) {
  return AUTOMATICI.some((re) => re.test(messaggio ?? ""));
}

/**
 * La cronologia unificata delle tre app: cosa è cambiato, dove, quando.
 *
 * Serve a una domanda sola, ma è la prima che ci si fa quando qualcosa
 * diventa rosso: "cosa ho toccato?". Per questo i commit automatici
 * vengono tolti — la risposta utile è una modifica fatta da una persona.
 */
export function recentChanges(activity, repos, limite = 6) {
  if (!activity) return [];

  return repos
    .flatMap((r) =>
      (activity[r.id]?.data?.commits ?? [])
        .filter((c) => c.at && !isAutomatico(c.message))
        .map((c) => ({ ...c, appId: r.id, appLabel: r.label, at: Date.parse(c.at) }))
    )
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, limite);
}
