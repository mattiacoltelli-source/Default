// Composizione e disegno della pagina.
//
// Due passaggi, non uno: prima si disegna tutto ciò che arriva da file
// pubblici (nessun limite di richieste, quindi sempre disponibile), poi si
// arricchisce con commit e deploy dall'API GitHub, che invece ha una quota
// e può esaurirsi. Se il secondo passaggio fallisce, la pagina ha già
// risposto alla domanda che conta — "devo preoccuparmi?" — e lo dice.
//
// Tutto il testo che viene da fuori (messaggi di commit, errori dei test,
// nomi di endpoint) entra nel DOM con textContent, mai come HTML: sono
// stringhe scritte da altri, e una dashboard non è il posto dove scoprire
// che qualcuno ha messo uno <script> in un messaggio di commit.

import { AGENT_BY_ID, APPS, APP_VERSION, REPOS, TOOLCHAIN, WORKFLOWS } from "./config.js";
import { initSentry } from "./sentry.js";
import { apiQuota, clearCache, loadAgentStatus, loadPredict, loadRepoActivity } from "./sources.js";
import { appMetrics, clockTime, collectProblems, describeAgo, evaluateApp, evaluateSignal, overallLevel, recentChanges, FAIL, OK, UNKNOWN, WARN } from "./rules.js";
import { easternNow, predictMetrics, predictSignals } from "./predict.js";

const STATE_LABEL = { [OK]: "Tutto ok", [WARN]: "Da guardare", [FAIL]: "Problema", [UNKNOWN]: "Sconosciuto" };

const el = {
  freshness: document.getElementById("freshness"),
  refresh: document.getElementById("refresh"),
  verdict: document.getElementById("verdict"),
  attentionBlock: document.getElementById("attention-block"),
  problems: document.getElementById("problems"),
  showmore: document.getElementById("showmore"),
  cards: document.getElementById("cards"),
  toolchainBlock: document.getElementById("toolchain-block"),
  toolchain: document.getElementById("toolchain"),
  changesBlock: document.getElementById("changes-block"),
  changes: document.getElementById("changes"),
  sourcesNote: document.getElementById("sources-note"),
  main: document.getElementById("main"),
  launch: document.getElementById("launch"),
  launchList: document.getElementById("launch-list"),
  launchOpen: document.getElementById("launch-open"),
  launchClose: document.getElementById("launch-close"),
};

// ─── Aiuti DOM ───────────────────────────────────────────────────────────

function node(tag, { className, text, attrs } = {}, children = []) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v != null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children) if (child) n.append(child);
  return n;
}

function replace(parent, children) {
  parent.replaceChildren(...children.filter(Boolean));
}

// ─── Disegno ─────────────────────────────────────────────────────────────

function renderVerdict(level, problems, appStates) {
  el.verdict.dataset.level = level;

  const count = problems.length;
  const unknowns = appStates.filter((a) => a.level === UNKNOWN).length;

  let state;
  let detail;

  if (count === 0 && level === OK) {
    state = "Tutto a posto";
    detail = `${appStates.length} app, nessun problema aperto.`;
  } else if (count === 0) {
    state = "Niente di rotto, ma manca qualcosa";
    detail = `${unknowns} app senza controlli recenti da cui dedurre lo stato.`;
  } else {
    state = count === 1 ? "1 problema richiede attenzione" : `${count} problemi richiedono attenzione`;
    // Quante cose sono gravi conta più di quali app sono coinvolte: con
    // cinque app l'elenco dei nomi diventa una riga lunga che non dice da
    // dove cominciare.
    const gravi = problems.filter((p) => p.severity === "HIGH").length;
    detail = [gravi && `${gravi} ${gravi === 1 ? "grave" : "gravi"}`, count - gravi && `${count - gravi} da guardare`].filter(Boolean).join(" · ");
  }

  replace(el.verdict, [node("p", { className: "verdict__state", text: state }), detail && node("p", { className: "verdict__detail", text: detail })]);
}

// Oltre questo numero l'elenco smette di essere una risposta e torna a
// essere una lista di dati da leggere. I problemi sono già ordinati per
// gravità, quindi i primi sono sempre quelli da cui partire.
const PROBLEMI_VISIBILI = 5;

function renderProblems(problems) {
  el.attentionBlock.hidden = problems.length === 0;
  el.showmore.hidden = problems.length <= PROBLEMI_VISIBILI;
  el.problems.dataset.expanded = "false";
  if (!problems.length) return;

  replace(
    el.problems,
    problems.map((p, i) => {
      const body = node("div", { className: "problem__body" }, [
        node("p", { className: "problem__who", text: [p.appLabel, p.signal].filter(Boolean).join(" · ") }),
        node("p", { className: "problem__what", text: p.message }),
      ]);
      const mark = node("span", { className: "problem__mark", attrs: { "aria-hidden": "true" } });

      // Con un link, tutta la riga è il bersaglio: nessun invito ripetuto e
      // un'area di tocco larga quanto lo schermo invece che quanto una
      // scritta di dodici pixel.
      const inner = p.url
        ? node("a", { className: "problem", attrs: { href: p.url, rel: "noopener", "data-severity": p.severity ?? "MEDIUM" } }, [
            mark,
            body,
            node("span", { className: "problem__chevron", text: "›", attrs: { "aria-hidden": "true" } }),
          ])
        : node("div", { className: "problem", attrs: { "data-severity": p.severity ?? "MEDIUM" } }, [mark, body]);

      return node("li", { className: i >= PROBLEMI_VISIBILI ? "is-extra" : null }, [inner]);
    })
  );

  const nascosti = problems.length - PROBLEMI_VISIBILI;
  el.showmore.textContent = `Mostra gli altri ${nascosti}`;
}

el.showmore?.addEventListener("click", () => {
  el.problems.dataset.expanded = "true";
  el.showmore.hidden = true;
});

// Il disegno avviene due volte (prima i file, poi commit e deploy): senza
// ricordare quali dettagli erano aperti, un pannello aperto si richiuderebbe
// da solo mentre lo stai leggendo.
const aperti = new Set();

function renderCards(appStates, metricsByApp, activity) {
  replace(
    el.cards,
    appStates.map((state) => {
      const app = APPS.find((a) => a.id === state.id);
      const repo = activity?.[state.id]?.data;
      const metrics = metricsByApp[state.id] ?? [];

      return node("article", { className: "card", attrs: { "data-level": state.level } }, [
        node("div", { className: "card__head" }, [
          node("span", { className: "dot", attrs: { "aria-hidden": "true" } }),
          node("div", { className: "card__name" }, [node("strong", { text: state.label }), node("span", { text: state.tagline })]),
          node("span", { className: "state", text: STATE_LABEL[state.level] }),
        ]),

        node(
          "div",
          { className: "chips" },
          state.signals.map((s) =>
            node("span", {
              className: "chip",
              attrs: { "data-level": s.level, title: `${s.short}${s.headline ? ` — ${s.headline}` : ""}` },
              // Un chip senza età accanto a uno con l'età si legge come
              // "va bene"; la parola dice quello che il vuoto non dice.
              text: `${s.label}${s.ageMs != null ? ` · ${describeAgo(s.ageMs)}` : s.attivo === false ? " · non attivo" : s.level === UNKNOWN ? " · mai" : ""}`,
            })
          )
        ),

        metrics.length &&
          node(
            "div",
            { className: "metrics" },
            metrics.map((m) =>
              node("div", { className: "metric", attrs: { "data-muted": m.muted ? "true" : null } }, [
                node("span", { className: "metric__value", text: m.value }),
                node("span", { className: "metric__label", text: m.label }),
              ])
            )
          ),

        node("details", { className: "more", attrs: { open: aperti.has(state.id) || null, "data-app": state.id } }, [
          node("summary", { text: "Dettaglio" }),
          node("div", { className: "rows" }, [
            ...state.signals.map((s) =>
              row(s.label, [
                node("span", { text: s.headline || STATE_LABEL[s.level] }),
                s.ageMs != null && node("span", { className: "muted", text: ` · ${describeAgo(s.ageMs)}` }),
              ])
            ),
            repo?.commit && row("Commit", [node("span", { text: repo.commit.message }), node("span", { className: "muted", text: ` · ${ago(repo.commit.at)}` })]),
            repo?.deploy && row("Deploy", [node("span", { text: ago(repo.deploy.at) })]),
            repo?.failedRun && row("Run rosso", [node("span", { text: `${repo.failedRun.name} (${repo.failedRun.branch ?? "?"})` })]),
            node("a", { className: "rowlink", text: "Apri l'app ↗", attrs: { href: state.site, rel: "noopener" } }),
          ]),
        ]),
      ]);
    })
  );
}

// Una data ISO che arriva dall'API GitHub può mancare o essere illeggibile:
// meglio un trattino che un "NaN giorni fa".
function ago(iso) {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at) ? describeAgo(Date.now() - at) : "—";
}

// Delegato una volta sola sul contenitore: le card vengono ricostruite a
// ogni disegno, un listener per card si perderebbe insieme a loro.
el.cards.addEventListener("toggle", (e) => {
  const details = e.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  const id = details.dataset.app;
  if (id) details.open ? aperti.add(id) : aperti.delete(id);
}, true);

function row(key, valueChildren) {
  return node("div", { className: "row" }, [node("span", { className: "row__key", text: key }), node("span", { className: "row__val" }, valueChildren.filter(Boolean))]);
}

function renderToolchain(voci) {
  el.toolchainBlock.hidden = false;
  replace(
    el.toolchain,
    voci.map(({ def, signal }) =>
      node("article", { className: "card", attrs: { "data-level": signal.level } }, [
        node("div", { className: "card__head" }, [
          node("span", { className: "dot", attrs: { "aria-hidden": "true" } }),
          node("div", { className: "card__name" }, [
            node("strong", { text: def.label }),
            node("span", { text: signal.headline || def.detail }),
          ]),
          // "Sconosciuto" e "Non attivo" insieme si contraddicono: chi non
          // è configurato lo dice in un modo solo.
          node("span", { className: "state", text: signal.attivo === false ? "Non attivo" : STATE_LABEL[signal.level] }),
        ]),
      ])
    )
  );
}

// Resta nascosta finché l'API non risponde: una sezione "ultimi
// cambiamenti" vuota non informa, occupa solo spazio.
function renderChanges(activity) {
  const changes = recentChanges(activity, REPOS);
  el.changesBlock.hidden = changes.length === 0;
  if (!changes.length) return;

  replace(
    el.changes,
    changes.map((c) =>
      node("li", {}, [
        node("a", { className: "change", attrs: { href: c.url, rel: "noopener", target: "_blank" } }, [
          node("span", { className: "change__app", text: c.appLabel }),
          node("span", { className: "change__what", text: c.message }),
          node("span", { className: "change__when", text: describeAgo(Date.now() - c.at) }),
        ]),
      ])
    )
  );
}

function renderNotice(text) {
  document.getElementById("quota-notice")?.remove();
  if (!text) return;
  el.main.insertBefore(node("p", { className: "notice", attrs: { id: "quota-notice" }, text }), el.verdict.nextSibling);
}

// ─── Lanciare un controllo ───────────────────────────────────────────────
// Link, non chiamate API: far partire un workflow richiede un token in
// scrittura, e questa pagina è pubblica. Vedi la nota in config.js.

function renderLaunchSheet() {
  replace(
    el.launchList,
    WORKFLOWS.map((w) =>
      node("li", {}, [
        node("a", { className: `sheet__item${w.primary ? " sheet__item--primary" : ""}`, attrs: { href: w.url, rel: "noopener", target: "_blank" } }, [
          node("div", {}, [node("strong", { text: w.label }), node("span", { text: w.detail })]),
          node("span", { className: "problem__chevron", text: "›", attrs: { "aria-hidden": "true" } }),
        ]),
      ])
    )
  );
}

el.launchOpen.addEventListener("click", () => el.launch.showModal());
el.launchClose.addEventListener("click", () => el.launch.close());

// Tocco fuori dal foglio = chiudi, come ci si aspetta da un bottom sheet.
el.launch.addEventListener("click", (e) => {
  if (e.target === el.launch) el.launch.close();
});

// ─── Orchestrazione ──────────────────────────────────────────────────────

async function render({ force = false } = {}) {
  el.refresh.dataset.busy = "true";
  if (force) clearCache();

  const now = Date.now();

  // Primo passaggio: solo file pubblici. Basta a rispondere alla domanda.
  const [statusByAgent, predict] = await Promise.all([loadAgentStatus(), loadPredict(easternNow(now).date)]);

  const extraByApp = { prova: predictSignals({ data: predict.data, now }) };
  const appStates = APPS.map((app) => evaluateApp({ app, statusByAgent, extraSignals: extraByApp[app.id] ?? [], now }));

  const metricsByApp = Object.fromEntries(
    APPS.map((app) => [app.id, app.id === "prova" ? predictMetrics(predict.data) : appMetrics(app, statusByAgent)])
  );

  const toolchain = TOOLCHAIN.map((def) => {
    const pubblicato = statusByAgent[def.agent]?.data != null;
    const signal = evaluateSignal({ agentId: def.agent, entry: statusByAgent[def.agent]?.data?.apps?.[def.key], now });
    const attivo = pubblicato || !AGENT_BY_ID[def.agent]?.optional;
    return { def, signal: attivo ? signal : { ...signal, attivo: false, headline: "Non attivo" } };
  });

  const problems = collectProblems(
    appStates,
    toolchain.flatMap(({ def, signal }) => signal.problems.map((p) => ({ ...p, appLabel: def.label, signal: signal.label, url: p.url ?? signal.runUrl })))
  );

  renderVerdict(overallLevel(appStates, toolchain.filter((t) => t.signal.attivo !== false).map((t) => t.signal.level)), problems, appStates);
  renderProblems(problems);
  renderCards(appStates, metricsByApp, null);
  renderToolchain(toolchain);
  updateFreshness([...Object.entries(statusByAgent).map(([agent, r]) => ({ ...r, agent })), predict], now);

  // Secondo passaggio: commit e deploy. Facoltativo per definizione — se
  // l'API non risponde la pagina resta esattamente com'è, con una nota.
  let attivita = null;
  try {
    const activity = await loadRepoActivity(REPOS);
    if (Object.values(activity).some((r) => r?.data?.commit)) {
      attivita = activity;
      renderCards(appStates, metricsByApp, activity);
      renderChanges(activity);
      renderNotice(null);
    }
  } catch {
    /* gestito sotto */
  }

  if (apiQuota.limited) {
    const when = apiQuota.resetAt ? ` Torna disponibile verso le ${clockTime(apiQuota.resetAt)}.` : "";
    renderNotice(`Quota GitHub esaurita: commit e deploy non aggiornati.${when} Gli stati qui sopra vengono da file pubblici e sono aggiornati.`);
  } else if (!attivita) {
    // La quota non è l'unico modo in cui l'API può negarsi (rete, policy
    // di un proxy aziendale, un guasto di GitHub). Senza questo ramo il
    // secondo passaggio spariva in silenzio: le card restavano senza
    // commit né deploy e niente diceva perché — un piccolo buco della
    // stessa forma di quelli che questa dashboard esiste per chiudere.
    renderNotice("Commit e deploy non raggiungibili adesso. Gli stati qui sopra vengono da file pubblici e sono aggiornati.");
  }

  el.refresh.dataset.busy = "false";
}

// La riga sotto il titolo non dice "aggiornato adesso" se i dati non lo
// sono: offline o con la rete a pezzi, quello che si vede è una copia, e
// deve dirlo — è la stessa regola della scadenza dei controlli, applicata
// alla dashboard stessa.
function updateFreshness(results, now) {
  const withData = results.filter((r) => r?.at);
  if (!withData.length) {
    el.freshness.textContent = "nessun dato";
    el.verdict.dataset.level = UNKNOWN;
    replace(el.verdict, [
      node("p", { className: "verdict__state", text: "Non riesco a leggere lo stato" }),
      node("p", { className: "verdict__detail", text: "Né dalla rete né da una copia locale. Non vuol dire che le app stiano male: vuol dire che non lo so." }),
    ]);
    el.sourcesNote.textContent = "";
    return;
  }

  const oldest = Math.min(...withData.map((r) => r.at));
  const anyStale = results.some((r) => r?.stale);
  el.freshness.textContent = anyStale ? `copia locale di ${describeAgo(now - oldest)} — non riesco ad aggiornare` : `aggiornato ${describeAgo(now - oldest)}`;

  const sources = withData.filter((r) => r.data?.source === "history").length;
  const sentrySpento = results.some((r) => r?.agent === "sentry" && r.data == null);

  el.sourcesNote.textContent = sources
    ? `${sources} agenti letti dallo storico: non hanno ancora pubblicato uno stato. Lancia "Controllo Completo" per averli aggiornati.`
    : sentrySpento
      ? "Errori Sentry non attivi: manca il secret SENTRY_AUTH_TOKEN in qa-agent. Tutto il resto è aggiornato."
      : "Stato letto dai file pubblicati da qa-agent; commit e deploy dall'API GitHub pubblica.";
}

// Prima che arrivi qualunque dato: la forma di quello che arriverà, invece
// di una pagina vuota seguita da uno scatto.
function renderSkeleton() {
  replace(el.verdict, [node("div", { className: "skel skel--verdict", attrs: { "aria-hidden": "true" } })]);
  el.verdict.removeAttribute("data-level");
  replace(el.cards, APPS.map(() => node("div", { className: "skel", attrs: { "aria-hidden": "true" } })));
}

initSentry({ release: `app-control-center@${APP_VERSION}` });

el.refresh.addEventListener("click", () => render({ force: true }));
renderLaunchSheet();
renderSkeleton();
render();

// Ricontrolla quando la pagina torna in primo piano: è un'app che si apre,
// si guarda e si chiude, e riaprirla deve mostrare adesso, non l'ultima
// volta. La cache impedisce che questo consumi la quota a ogni sguardo.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
