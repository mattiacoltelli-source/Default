import { readJson, fileExists } from "./lib/fs-utils.js";

const MIN_PLAYERS = 450;
const MAX_PLAYERS = 650;
const TOLERANCE = 0.001;
const NUMERIC_FIELDS = ["appearances", "minutes", "goals", "assists", "xg", "xa", "npxg", "xg_chain", "xg_buildup", "yellow_cards", "red_cards"];
const FANTAVOTO_FIELDS = ["presenze", "voto_oggettivo", "voto_gazzetta", "voto_corriere", "voto_tuttosport", "fantamedia"];

const errors = [];
const warnings = [];

function err(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

function isNumberOrNull(v) {
  return v === null || typeof v === "number";
}

async function main() {
  console.log("=== validate-data: validazione data/serie-a-master.json ===\n");

  if (!fileExists("data/serie-a-master.json")) {
    err("data/serie-a-master.json non esiste — eseguire prima 'npm run build-data'.");
    return finish();
  }

  let master;
  try {
    master = await readJson("data/serie-a-master.json");
  } catch (e) {
    err(`JSON non valido in data/serie-a-master.json: ${e.message}`);
    return finish();
  }

  if (!master.metadata || typeof master.metadata !== "object") err("metadata mancante o non valido");
  if (!Array.isArray(master.players)) {
    err("players deve essere un array — impossibile proseguire con altri controlli");
    return finish();
  }

  const m = master.metadata ?? {};
  if (m.league !== "Serie A") err(`metadata.league atteso "Serie A", trovato ${JSON.stringify(m.league)}`);
  if (!m.historical_season) err("metadata.historical_season mancante");
  if (!m.current_season) err("metadata.current_season mancante");
  if (!m.generated_at || Number.isNaN(Date.parse(m.generated_at))) err("metadata.generated_at mancante o non e' una data ISO valida");
  if (!m.current_date) err("metadata.current_date mancante");
  if (typeof m.current_season_matches_available !== "number") err("metadata.current_season_matches_available mancante o non numerico");
  if (!Array.isArray(m.sources) || m.sources.length === 0) {
    err("metadata.sources mancante o vuoto");
  } else {
    for (const s of m.sources) {
      if (!s.name || !s.url || !s.purpose) err(`metadata.sources con voce incompleta: ${JSON.stringify(s)}`);
    }
  }

  const players = master.players;
  console.log(`Giocatori: ${players.length}`);
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    err(`Numero giocatori fuori range plausibile: ${players.length} (atteso ${MIN_PLAYERS}-${MAX_PLAYERS})`);
  }

  let currentTeams = null;
  if (fileExists("config/teams-aliases.json")) {
    const cfg = await readJson("config/teams-aliases.json");
    currentTeams = new Set(cfg.teams.map((t) => t.official_name));
  }

  let rosterByTeam = null;
  if (fileExists("config/teams-aliases.json") && fileExists("data/raw/transfermarkt/league-teams.json")) {
    try {
      const cfg = await readJson("config/teams-aliases.json");
      rosterByTeam = {};
      for (const team of cfg.teams) {
        const path = `data/raw/transfermarkt/rosters/${team.transfermarkt_club_id}.json`;
        if (fileExists(path)) {
          const roster = await readJson(path);
          rosterByTeam[team.official_name] = new Set(roster.map((p) => p.transfermarkt_id));
        }
      }
    } catch {
      rosterByTeam = null;
    }
  }
  if (!rosterByTeam) warn("Cache raw Transfermarkt non disponibile: salto il cross-check roster (non bloccante).");

  const seenIds = new Set();
  const seenIdentity = new Set(); // name+team, per rilevare duplicati "logici"

  for (const [i, p] of players.entries()) {
    const ctx = `player[${i}] (${p?.name ?? "?"})`;

    if (!p.player_id || typeof p.player_id !== "string") {
      err(`${ctx}: player_id mancante o non stringa`);
    } else {
      if (seenIds.has(p.player_id)) err(`Duplicato player_id: ${p.player_id}`);
      seenIds.add(p.player_id);
    }

    if (!p.name) err(`${ctx}: name mancante`);
    if (!p.team_current) err(`${ctx}: team_current mancante`);
    if (!p.position) warn(`${ctx}: position mancante`);
    if (p.name && p.team_current) {
      const identity = `${p.name.toLowerCase()}|${p.team_current}`;
      if (seenIdentity.has(identity)) err(`Possibile duplicato giocatore (stesso nome+squadra): ${identity}`);
      seenIdentity.add(identity);
    }

    if (currentTeams && p.team_current && !currentTeams.has(p.team_current)) {
      err(`${ctx}: team_current "${p.team_current}" non e' tra le 20 squadre canoniche attuali`);
    }
    if (rosterByTeam && p.team_current && p.transfermarkt_id) {
      const set = rosterByTeam[p.team_current];
      if (set && !set.has(p.transfermarkt_id)) {
        err(`${ctx}: transfermarkt_id ${p.transfermarkt_id} non trovato nella rosa raw di "${p.team_current}"`);
      }
    }

    if (!p.seasons || typeof p.seasons !== "object") {
      err(`${ctx}: seasons mancante`);
      continue;
    }
    const seasonKeys = Object.keys(p.seasons);
    if (seasonKeys.length === 0) err(`${ctx}: nessuna stagione presente`);

    for (const seasonKey of seasonKeys) {
      const s = p.seasons[seasonKey];
      const sctx = `${ctx} stagione ${seasonKey}`;
      if (!s.team) err(`${sctx}: team mancante`);

      for (const field of NUMERIC_FIELDS) {
        const v = s[field];
        if (!isNumberOrNull(v)) {
          err(`${sctx}: campo "${field}" non e' numero ne' null (${JSON.stringify(v)})`);
        } else if (typeof v === "number" && v < 0) {
          err(`${sctx}: campo "${field}" negativo (${v})`);
        }
      }

      const minutes = s.minutes;
      for (const [baseField, perField] of [
        ["xg", "xg90"],
        ["xa", "xa90"],
        ["npxg", "npxg90"],
      ]) {
        const base = s[baseField];
        const per = s[perField];
        if (!isNumberOrNull(per)) {
          err(`${sctx}: campo "${perField}" non e' numero ne' null`);
          continue;
        }
        if (minutes === null || minutes <= 0 || base === null) {
          if (per !== null) err(`${sctx}: "${perField}" dovrebbe essere null quando minuti<=0 o ${baseField} assente, trovato ${per}`);
        } else {
          const expected = Math.round(((base / minutes) * 90) * 1000) / 1000;
          if (Math.abs(expected - per) > TOLERANCE) {
            err(`${sctx}: incoerenza ${perField}: atteso ~${expected}, trovato ${per}`);
          }
        }
      }

      if (p.understat_player_id === null && seasonKey !== undefined) {
        for (const field of NUMERIC_FIELDS) {
          if (s[field] !== null) {
            err(`${sctx}: giocatore senza match Understat ma campo "${field}" non e' null (${s[field]}) — dato non deve essere inventato`);
          }
        }
      }

      if ("fantavoto" in s && s.fantavoto !== null) {
        for (const field of FANTAVOTO_FIELDS) {
          const v = s.fantavoto[field];
          const max = field === "presenze" ? 40 : 20;
          if (!isNumberOrNull(v)) err(`${sctx}: fantavoto.${field} non e' numero ne' null (${JSON.stringify(v)})`);
          else if (typeof v === "number" && (v < 0 || v > max)) err(`${sctx}: fantavoto.${field} fuori range plausibile (${v})`);
        }
      }
    }

    if ("price" in p && p.price !== null) {
      for (const field of ["qt_i", "qt_a", "fvm"]) {
        const v = p.price[field];
        if (!isNumberOrNull(v)) err(`${ctx}: price.${field} non e' numero ne' null (${JSON.stringify(v)})`);
        else if (typeof v === "number" && v < 0) err(`${ctx}: price.${field} negativo (${v})`);
      }
    }
    if ("auction" in p && p.auction !== null) {
      if (!isNumberOrNull(p.auction.avg_price_credits) || p.auction.avg_price_credits < 0) {
        err(`${ctx}: auction.avg_price_credits non valido (${JSON.stringify(p.auction.avg_price_credits)})`);
      }
      if (!p.auction.season) err(`${ctx}: auction.season mancante`);
    }
  }

  if (fileExists("data/serie-a-matches.json")) {
    try {
      const matchesFile = await readJson("data/serie-a-matches.json");
      const matchPlayerIds = Object.keys(matchesFile.matches ?? {});
      for (const pid of matchPlayerIds) {
        if (!seenIds.has(pid)) err(`serie-a-matches.json referenzia player_id "${pid}" assente dal master`);
      }
      console.log(`Giocatori con dati partita-per-partita: ${matchPlayerIds.length}`);
    } catch (e) {
      err(`JSON non valido in data/serie-a-matches.json: ${e.message}`);
    }
  } else {
    warn("data/serie-a-matches.json non trovato (non bloccante per la validazione del master).");
  }

  return finish();
}

function finish() {
  console.log(`\nValidati: ${errors.length === 0 ? "OK" : "con errori"}`);
  console.log(`Warning: ${warnings.length}`);
  for (const w of warnings) console.log(`  [WARN] ${w}`);
  console.log(`Errori: ${errors.length}`);
  for (const e of errors.slice(0, 100)) console.error(`  [ERROR] ${e}`);
  if (errors.length > 100) console.error(`  ... e altri ${errors.length - 100} errori`);

  console.log(`\n=== validate-data: ${errors.length === 0 ? "PASS" : "FAIL"} ===`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
