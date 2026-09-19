// Livello di accesso ai dati: da dove arrivano i numeri e come si sopravvive
// quando non arrivano.
//
// Due sole fonti, entrambe pubbliche e senza credenziali:
//
// 1. raw.githubusercontent.com — file già committati nei repo (lo stato
//    pubblicato dagli agenti, i dati che Predict scrive da sé). Nessun
//    limite di richieste che ci riguardi, servito da CDN.
// 2. api.github.com senza token — commit e run recenti. 60 richieste l'ora
//    per indirizzo IP: è la risorsa scarsa di tutta la dashboard, per
//    questo è la sola fonte messa in cache in modo aggressivo e la sola che
//    può essere esaurita. Quando succede la pagina resta utile: i dati del
//    punto 1 bastano da soli a rispondere "devo preoccuparmi?".
//
// Nessun token, in nessuna forma: questa pagina è pubblica come i repo che
// legge, e una chiave dentro un file JS pubblico è una chiave regalata.

import { CACHE_PREFIX, CACHE_TTL, OWNER, QA_BRANCH, QA_REPO, AGENTS, PREDICT } from "./config.js";
import { segnalaContrattoRotto } from "./sentry.js";

const RAW = "https://raw.githubusercontent.com";
const API = "https://api.github.com";

// ─── Cache ───────────────────────────────────────────────────────────────
// localStorage può non esistere, essere pieno o lanciare (finestra privata,
// dati del sito bloccati): ogni accesso è protetto e un fallimento non è
// mai fatale — al massimo si perde la copia offline.

function cacheRead(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return typeof entry?.at === "number" ? entry : null;
  } catch {
    return null;
  }
}

function cacheWrite(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota piena o storage negato: la dashboard funziona lo stesso, solo senza copia offline */
  }
}

export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* niente storage: non c'è nulla da svuotare */
  }
}

/**
 * Esegue `fetcher` solo se la copia in cache è più vecchia di `ttl`.
 *
 * Se la rete fallisce (offline, DNS, quota esaurita) ritorna la copia
 * vecchia marcata `stale`, invece di un errore: una dashboard che mostra
 * dati di un'ora fa dichiarandolo è utile; una pagina bianca no.
 */
async function cached(key, ttl, fetcher) {
  const entry = cacheRead(key);
  const fresh = entry && Date.now() - entry.at < ttl;
  if (fresh) return { data: entry.data, at: entry.at, stale: false };

  try {
    const data = await fetcher();
    cacheWrite(key, data);
    return { data, at: Date.now(), stale: false };
  } catch (error) {
    if (error?.contrattoRotto) segnalaContrattoRotto(error, error.contrattoRotto);
    if (entry) return { data: entry.data, at: entry.at, stale: true, error };
    return { data: null, at: null, stale: true, error };
  }
}

// ─── Recupero grezzo ─────────────────────────────────────────────────────

// Un 404 non è un errore da propagare: per uno stato mai pubblicato è la
// risposta corretta ("non esiste ancora"), e a valle diventa "sconosciuto".
// Distinguerlo da un guasto di rete è ciò che evita di mostrare un problema
// dove c'è solo un file non ancora scritto.
async function getRaw(repo, branch, path, { json = true } = {}) {
  const res = await fetch(`${RAW}/${OWNER}/${repo}/${branch}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${repo}/${path}: HTTP ${res.status}`);
  if (!json) return res.text();

  try {
    return await res.json();
  } catch (e) {
    // Il file c'è ma non è JSON valido: non è la rete, è il contratto tra
    // due repo che si è rotto. Va distinto, perché a schermo i due casi si
    // assomigliano (entrambi finiscono in "sconosciuto") ma solo questo è
    // un bug da correggere.
    const error = new Error(`${repo}/${path}: JSON non valido (${e.message})`);
    error.contrattoRotto = { repo, path };
    throw error;
  }
}

// Stato della quota GitHub, condiviso con la UI: serve a dire "non riesco a
// leggere altro adesso" invece di far sembrare mancante ciò che è solo
// irraggiungibile.
export const apiQuota = { limited: false, resetAt: null };

async function getApi(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      apiQuota.limited = true;
      apiQuota.resetAt = Number.isFinite(reset) ? reset * 1000 : null;
      throw new Error("quota-esaurita");
    }
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);

  apiQuota.limited = false;
  return res.json();
}

// ─── Stato degli agenti ──────────────────────────────────────────────────

/**
 * Lo stato pubblicato dai sei agenti in qa-agent (`status/<agente>.json`).
 *
 * Per i quattro agenti che tengono anche uno storico esiste un ripiego su
 * `history/data/<agente>.jsonl`: finché quei workflow non girano almeno una
 * volta dopo l'introduzione di `status/`, i file di stato non esistono
 * ancora, ma l'ultima riga dello storico contiene comunque un esito reale
 * con la sua data. Non è un secondo controllo: è la stessa informazione,
 * letta da dove è disponibile oggi.
 */
export async function loadAgentStatus() {
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      const res = await cached(`status:${agent.id}`, CACHE_TTL.raw, async () => {
        const status = await getRaw(QA_REPO, QA_BRANCH, `status/${agent.id}.json`);
        if (status) return { source: "status", apps: status.apps ?? {} };

        if (!HISTORY_AGENTS.has(agent.id)) return null;
        const jsonl = await getRaw(QA_REPO, QA_BRANCH, `history/data/${agent.id}.jsonl`, { json: false });
        return jsonl ? { source: "history", apps: fromHistory(agent.id, jsonl) } : null;
      });

      return [agent.id, res];
    })
  );

  return Object.fromEntries(results);
}

// Solo questi quattro tengono uno storico: QA Agent e API Doctor non ne
// hanno mai avuto uno, quindi per loro non c'è nessun ripiego possibile —
// finché non girano una volta restano, correttamente, "sconosciuti".
const HISTORY_AGENTS = new Set(["data-health", "performance", "scale", "security"]);

// Ricostruisce lo stato per app dall'ultima riga utile dello storico JSONL.
// Le righe sono una per run e per app: si tiene, per ogni app, la più
// recente. Molto meno ricco del file di stato (niente elenco problemi), ma
// abbastanza per esito e data — cioè per il semaforo e per la scadenza.
function fromHistory(agentId, text) {
  const apps = {};

  for (const line of text.trim().split("\n")) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // riga troncata da un run interrotto: si salta, come fa qa-agent
    }

    const key = canonicalApp(row.app ?? defaultAppFor(agentId));
    if (!key || !row.runAt) continue;

    const current = apps[key];
    if (current && current.runAt >= row.runAt) continue;

    apps[key] = {
      result: row.result,
      runAt: row.runAt,
      runUrl: null,
      summary: summaryFromHistory(agentId, row),
      metrics: metricsFromHistory(agentId, row),
      problems: [],
    };
  }

  return apps;
}

// Scale riguarda solo CineFighi e Security solo la toolchain: le loro righe
// di storico non contengono un campo `app` perché non ne hanno bisogno.
function defaultAppFor(agentId) {
  if (agentId === "scale") return "cinefighi";
  if (agentId === "security") return "qa-agent";
  return null;
}

function canonicalApp(name) {
  return name === "vacanza" ? "spot" : name;
}

function summaryFromHistory(agentId, row) {
  if (agentId === "data-health") return `${row.issueCount ?? 0} anomalie`;
  if (agentId === "performance") return `Perf ${row.performance} · A11y ${row.accessibility}`;
  if (agentId === "scale") return `${row.targetCount} titoli · Home ${row.homeReadyMs}ms`;
  if (agentId === "security") return `${row.total ?? 0} vulnerabilità`;
  return "";
}

function metricsFromHistory(agentId, row) {
  const pick = (keys) => Object.fromEntries(keys.filter((k) => row[k] != null).map((k) => [k, row[k]]));
  if (agentId === "data-health") return pick(["users", "titles", "votes", "entries"]);
  if (agentId === "performance") return pick(["performance", "accessibility", "best-practices", "seo"]);
  if (agentId === "scale") return pick(["targetCount", "homeReadyMs", "libraryFirstPageMs", "statsReadyMs"]);
  if (agentId === "security") return pick(["critical", "high", "moderate", "low", "total"]);
  return {};
}

// ─── Dati propri di Predict ──────────────────────────────────────────────

/**
 * I file che Predict committa nel proprio repo a ogni run.
 *
 * Il file `predict_slots_<data>.json` esiste solo se la previsione di quel
 * giorno è stata generata: la sua ASSENZA in un giorno feriale è il segnale
 * più importante che questa dashboard produce, perché è l'unico problema
 * che nessuno strumento esistente segnala — GitHub mostra i run avvenuti,
 * non quelli mancati.
 */
export async function loadPredict(todayET) {
  return cached(`predict:${todayET}`, CACHE_TTL.raw, async () => {
    const [report, pending, slots] = await Promise.all([
      getRaw(PREDICT.repo, PREDICT.branch, "REPORT.md", { json: false }),
      getRaw(PREDICT.repo, PREDICT.branch, "data/pending.json"),
      getRaw(PREDICT.repo, PREDICT.branch, `data/_state/predict_slots_${todayET}.json`),
    ]);

    return { report: parseReport(report), pending: Array.isArray(pending) ? pending : null, slotsToday: slots };
  });
}

// REPORT.md è rigenerato da evaluate.yml a ogni valutazione. Si leggono solo
// l'intestazione e la riga di sintesi: il resto è tabelle Markdown che qui
// non servono, e un parser più ambizioso si romperebbe al primo ritocco.
function parseReport(text) {
  if (!text) return null;

  const updated = text.match(/aggiornato al\s+(\S+)/)?.[1] ?? null;
  const summary = text.match(/Previsioni valutate:\s*(\d+)\s*—\s*accuratezza complessiva:\s*([\d.]+)%/);
  const baseline = text.match(/Classe più frequente[^:]*:\s*([\d.]+)%/);

  return {
    updatedAt: updated,
    evaluated: summary ? Number(summary[1]) : null,
    accuracy: summary ? Number(summary[2]) : null,
    baseline: baseline ? Number(baseline[1]) : null,
  };
}

// ─── Attività dei repo ───────────────────────────────────────────────────

/**
 * Ultimo commit e ultimo deploy per ogni repo, dall'API GitHub.
 *
 * È l'unica parte che consuma la quota, quindi è anche l'unica facoltativa:
 * chi chiama deve saper disegnare la pagina senza. Due richieste per repo,
 * dieci in tutto, contro un tetto di sessanta l'ora — la cache a dieci
 * minuti è ciò che tiene il conto largamente sotto.
 */
export async function loadRepoActivity(repos) {
  const entries = await Promise.all(
    repos.map(async (r) => {
      const res = await cached(`repo:${r.repo}`, CACHE_TTL.api, async () => {
        const [commits, runs] = await Promise.all([
          // Cinque invece di uno: stesso costo in quota (una richiesta),
          // ma abbastanza per costruire la cronologia dei cambiamenti
          // senza una seconda chiamata per repo.
          getApi(`/repos/${OWNER}/${r.repo}/commits?per_page=5`),
          getApi(`/repos/${OWNER}/${r.repo}/actions/runs?per_page=10`),
        ]);

        const commit = commits?.[0];
        const all = runs?.workflow_runs ?? [];
        // GitHub Pages pubblica tramite un workflow che si chiama sempre
        // "pages build and deployment", anche nei repo che non hanno
        // nessun workflow proprio (Spot): è lì che si legge il deploy vero.
        const deploy = all.find((w) => /pages/i.test(w.name ?? "") && w.conclusion === "success");
        const failed = all.find((w) => w.conclusion === "failure");

        const leggi = (c) => ({
          sha: c.sha.slice(0, 7),
          message: (c.commit?.message ?? "").split("\n")[0],
          at: c.commit?.author?.date ?? c.commit?.committer?.date ?? null,
          url: c.html_url,
        });

        return {
          commit: commit && leggi(commit),
          commits: (commits ?? []).map(leggi),
          deploy: deploy && { at: deploy.updated_at, url: deploy.html_url },
          failedRun: failed && { name: failed.name, at: failed.updated_at, url: failed.html_url, branch: failed.head_branch },
        };
      });

      return [r.id, res];
    })
  );

  return Object.fromEntries(entries);
}
