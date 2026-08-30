import { readJson, writeJson } from "./lib/fs-utils.js";
import { normalizeName, matchTeamPlayers } from "./lib/match-players.js";

function fail(message) {
  console.error(`\n[FAIL] ${message}\n`);
  process.exit(1);
}

/**
 * Match dedicato per le quotazioni Fantacalcio.it: il nome e' quasi sempre
 * il solo cognome (es. "Locatelli"), a volte con iniziale di disambiguazione
 * quando due compagni condividono il cognome (es. "Martinez L." vs "Martinez J."
 * a Inter, per distinguere Lautaro Martinez da Josep Martinez).
 * @param {string} rowName
 * @param {{id:string,name:string}[]} candidates
 */
function matchQuotazioneName(rowName, candidates) {
  const norm = normalizeName(rowName);
  const tokens = norm.split(" ").filter(Boolean);
  let initial = null;
  let surnameTokens = tokens;
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && last.length === 1) {
    initial = last;
    surnameTokens = tokens.slice(0, -1);
  }
  const surname = surnameTokens.join(" ");

  let matches = candidates.filter((c) => {
    const cTokens = normalizeName(c.name).split(" ").filter(Boolean);
    return cTokens.slice(-surnameTokens.length).join(" ") === surname;
  });
  if (initial) {
    matches = matches.filter((c) => normalizeName(c.name).split(" ")[0]?.[0] === initial);
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Applica le righe di voti di UNA stagione ai giocatori del master, squadra per squadra. */
function matchVotiForSeason(votiRows, players, byTeamCurrent, teamNameOnlineToOfficial) {
  const matchedPlayerIds = new Set();
  const unmatchedRows = [];

  const votiByTeam = new Map();
  for (const row of votiRows) {
    const teamName = teamNameOnlineToOfficial.get(row.team);
    if (!teamName) {
      // Estero / Serie Minori: non era una squadra di Serie A in quella stagione,
      // ma il giocatore potrebbe esserlo ORA (es. arrivato dall'estero questa
      // estate) — va comunque nel pool del fallback globale, non scartato.
      unmatchedRows.push(row);
      continue;
    }
    if (!votiByTeam.has(teamName)) votiByTeam.set(teamName, []);
    votiByTeam.get(teamName).push(row);
  }

  const applied = [];
  for (const [teamName, rows] of votiByTeam) {
    const candidates = (byTeamCurrent.get(teamName) ?? [])
      .filter((p) => !matchedPlayerIds.has(p.player_id))
      .map((p) => ({ transfermarkt_id: p.player_id, name: p.name }));
    const voRows = rows.map((r, i) => ({ understat_id: String(i), name: r.name }));
    const { matches } = matchTeamPlayers(voRows, candidates);
    const matchedIdx = new Set();
    for (const m of matches) {
      const row = rows[Number(m.understat_id)];
      applied.push({ playerId: m.transfermarkt_id, row });
      matchedPlayerIds.add(m.transfermarkt_id);
      matchedIdx.add(Number(m.understat_id));
    }
    rows.forEach((r, i) => {
      if (!matchedIdx.has(i)) unmatchedRows.push(r);
    });
  }

  // fallback globale (nome esatto/token-subset) per trasferimenti non ancora riflessi su una fonte
  const remainingCandidates = players
    .filter((p) => !matchedPlayerIds.has(p.player_id))
    .map((p) => ({ transfermarkt_id: p.player_id, name: p.name }));
  const globalRows = unmatchedRows.map((r, i) => ({ understat_id: String(i), name: r.name }));
  const { matches: globalMatches } = matchTeamPlayers(globalRows, remainingCandidates);
  const matchedGlobalIdx = new Set();
  for (const m of globalMatches) {
    const row = unmatchedRows[Number(m.understat_id)];
    applied.push({ playerId: m.transfermarkt_id, row });
    matchedPlayerIds.add(m.transfermarkt_id);
    matchedGlobalIdx.add(Number(m.understat_id));
  }
  const stillUnmatched = unmatchedRows.filter((_, i) => !matchedGlobalIdx.has(i));

  return { applied, stillUnmatched };
}

async function main() {
  console.log("=== enrich-market-data: quotazioni + prezzo medio asta + fantavoto ===\n");

  const master = await readJson("data/serie-a-master.json");
  const teamsConfig = await readJson("config/teams-aliases.json");
  const seasonsConfig = await readJson("config/seasons.json");
  const teams = teamsConfig.teams;
  const players = master.players;
  const currentSeasonKey = seasonsConfig.current_season;

  const byTeamCurrent = new Map();
  for (const p of players) {
    if (!byTeamCurrent.has(p.team_current)) byTeamCurrent.set(p.team_current, []);
    byTeamCurrent.get(p.team_current).push(p);
  }

  const unmatchedReport = { quotazioni: [], voti: {} };

  // --- Quotazioni Fantacalcio.it (Classic): price = { qt_i, qt_a, fvm } ---
  const quotazioni = await readJson("data/raw/market/quotazioni.json");
  const abbrToTeamName = new Map(teams.map((t) => [t.fantacalcio_it_abbr, t.official_name]));
  for (const p of players) p.price = null;

  let priceMatched = 0;
  const stillUnmatchedQuot = [];
  const matchedPriceIds = new Set();
  for (const row of quotazioni) {
    const teamName = abbrToTeamName.get(row.team_abbr);
    if (!teamName) continue;
    const candidates = (byTeamCurrent.get(teamName) ?? [])
      .filter((p) => !matchedPriceIds.has(p.player_id))
      .map((p) => ({ id: p.player_id, name: p.name }));
    const m = matchQuotazioneName(row.name, candidates);
    if (m) {
      players.find((p) => p.player_id === m.id).price = { qt_i: row.qt_i, qt_a: row.qt_a, fvm: row.fvm };
      matchedPriceIds.add(m.id);
      priceMatched++;
    } else {
      stillUnmatchedQuot.push(row);
    }
  }
  const remainingForQuot = players.filter((p) => !matchedPriceIds.has(p.player_id)).map((p) => ({ id: p.player_id, name: p.name }));
  for (const row of stillUnmatchedQuot) {
    const m = matchQuotazioneName(row.name, remainingForQuot);
    if (m) {
      players.find((p) => p.player_id === m.id).price = { qt_i: row.qt_i, qt_a: row.qt_a, fvm: row.fvm };
      matchedPriceIds.add(m.id);
      priceMatched++;
    } else {
      unmatchedReport.quotazioni.push(row);
    }
  }
  console.log(`Quotazioni Fantacalcio.it: ${priceMatched}/${quotazioni.length} righe agganciate a un giocatore`);
  if (priceMatched < players.length * 0.5) {
    fail(`Solo ${priceMatched}/${players.length} giocatori hanno una quotazione agganciata (< 50%): probabile rottura del parsing/selettore, non un limite fisiologico del matching.`);
  }

  // --- Voti + Kap. Fantacalcio-Online, per stagione ---
  const teamNameOnlineToOfficial = new Map(teams.map((t) => [t.fantacalcio_online_team_title, t.official_name]));
  for (const p of players) p.auction = null;

  for (const seasonKey of Object.keys(seasonsConfig.seasons)) {
    const cfg = seasonsConfig.seasons[seasonKey];
    const votiRows = await readJson(`data/raw/market/voti-${seasonKey}.json`);
    const { applied, stillUnmatched } = matchVotiForSeason(votiRows, players, byTeamCurrent, teamNameOnlineToOfficial);

    for (const { playerId, row } of applied) {
      const player = players.find((p) => p.player_id === playerId);
      if (player.seasons[seasonKey]) {
        player.seasons[seasonKey].fantavoto = {
          presenze: row.presenze,
          voto_oggettivo: row.voto_oggettivo,
          voto_gazzetta: row.voto_gazzetta,
          voto_corriere: row.voto_corriere,
          voto_tuttosport: row.voto_tuttosport,
          fantamedia: row.fantamedia,
        };
      }
      if (seasonKey === currentSeasonKey && row.kap !== null) {
        player.auction = { avg_price_credits: row.kap, season: cfg.label };
      }
    }
    unmatchedReport.voti[seasonKey] = stillUnmatched;
    console.log(`Voti/Kap. Fantacalcio-Online ${seasonKey}: ${applied.length}/${votiRows.length} righe agganciate a un giocatore`);
    if (seasonKey === currentSeasonKey && applied.length < players.length * 0.5) {
      fail(`Solo ${applied.length}/${players.length} giocatori hanno voti/Kap. agganciati per la stagione corrente (< 50%): probabile rottura del parsing/selettore.`);
    }
  }

  // idempotente: rimuove eventuali voci gia' presenti da un run precedente
  // di questo script prima di riaggiungerle, cosi' e' sicuro rilanciarlo
  // da solo senza dover rifare anche fetch-data/normalize-data.
  const MARKET_SOURCE_NAMES = new Set(["Fantacalcio.it", "Fantacalcio-Online"]);
  master.metadata.sources = master.metadata.sources.filter((s) => !MARKET_SOURCE_NAMES.has(s.name));
  master.metadata.sources.push(
    {
      name: "Fantacalcio.it",
      purpose: "official Classic quotations (Qt.I/Qt.A) and FVM (performance-based market value indicator)",
      url: "https://www.fantacalcio.it/quotazioni-fantacalcio",
    },
    {
      name: "Fantacalcio-Online",
      purpose: "real average auction price in credits (Kap., aggregated from thousands of real leagues) and fantavoto (Gazzetta/Corriere/Tuttosport ratings + Fantamedia) per season",
      url: "https://www.fantacalcio-online.com/it/serie-a/2026-2027/voti-fantacalcio",
    },
  );

  await writeJson("data/serie-a-master.json", master);
  await writeJson("data/market-unmatched-report.json", unmatchedReport);

  const withPrice = players.filter((p) => p.price).length;
  const withAuction = players.filter((p) => p.auction).length;
  console.log(`\nGiocatori con quotazione: ${withPrice}/${players.length}`);
  console.log(`Giocatori con prezzo medio asta (Kap. ${currentSeasonKey}): ${withAuction}/${players.length}`);
  console.log("\nScritti: data/serie-a-master.json (arricchito), data/market-unmatched-report.json");
  console.log("\n=== enrich-market-data completato ===");
}

main().catch((err) => {
  console.error(err);
  fail(`Errore non gestito: ${err.message}`);
});
