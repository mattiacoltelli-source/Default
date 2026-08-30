import { readJson, writeJson, fileExists } from "./lib/fs-utils.js";
import { getPlayersStats, getLeagueData, getPlayerMatches } from "./lib/understat.js";
import { getLeagueTeams, getTeamRoster } from "./lib/transfermarkt.js";
import { linkPlayers } from "./lib/link-players.js";

const LEAGUE_UNDERSTAT = "Serie_A";
const LEAGUE_TM_SLUG = "serie-a";
const FORCE = process.argv.includes("--force");
const MAX_MATCH_FETCH_FAILURE_RATE = 0.15;
const MIN_ROSTER_SIZE = 15;
const MAX_ROSTER_SIZE = 40;

function fail(message) {
  console.error(`\n[FAIL] ${message}\n`);
  process.exit(1);
}

async function cachedFetch(path, fetcher, { minLength } = {}) {
  if (!FORCE && fileExists(path)) {
    console.log(`  (cache) ${path}`);
    return readJson(path);
  }
  const data = await fetcher();
  if (minLength !== undefined) {
    const len = Array.isArray(data) ? data.length : Object.keys(data).length;
    if (len < minLength) {
      fail(`Risposta troppo piccola (${len} elementi, atteso >= ${minLength}) per ${path}`);
    }
  }
  await writeJson(path, data);
  console.log(`  ok: ${path}`);
  return data;
}

async function main() {
  console.log("=== fetch-data: raccolta dati grezzi Understat + Transfermarkt ===\n");

  const seasonsConfig = await readJson("config/seasons.json");
  const teamsConfig = await readJson("config/teams-aliases.json");
  const teams = teamsConfig.teams;
  const seasons = seasonsConfig.seasons;

  // 1) Understat: dati stagionali giocatori + squadre, bloccante per entrambe le stagioni.
  console.log("[1/4] Understat — statistiche giocatori e dati lega per stagione");
  const understatPlayersBySeason = {};
  const understatLeagueBySeason = {};
  for (const [seasonKey, seasonCfg] of Object.entries(seasons)) {
    const s = seasonCfg.understat_season;
    console.log(` - stagione ${seasonKey} (understat season=${s})`);
    const players = await cachedFetch(
      `data/raw/understat/players-${s}.json`,
      () => getPlayersStats(LEAGUE_UNDERSTAT, s),
      { minLength: 1 },
    );
    if (players.length === 0) fail(`Understat ha restituito 0 giocatori per la stagione ${seasonKey}`);
    understatPlayersBySeason[s] = players;

    const league = await cachedFetch(
      `data/raw/understat/league-${s}.json`,
      () => getLeagueData(LEAGUE_UNDERSTAT, s),
      { minLength: 1 },
    );
    understatLeagueBySeason[s] = league;
    console.log(`   -> ${players.length} giocatori, ${Object.keys(league).length} squadre`);
  }

  // 2) Transfermarkt: lista squadre correnti, deve combaciare con la config.
  console.log("\n[2/4] Transfermarkt — elenco squadre Serie A correnti");
  const currentSeasonCfg = seasons[seasonsConfig.current_season];
  const tmLeagueTeams = await cachedFetch(
    "data/raw/transfermarkt/league-teams.json",
    () => getLeagueTeams(LEAGUE_TM_SLUG, currentSeasonCfg.transfermarkt_saison_id),
    { minLength: 1 },
  );
  if (tmLeagueTeams.length !== 20) {
    fail(`Transfermarkt ha restituito ${tmLeagueTeams.length} squadre invece di 20 — verificare il parsing.`);
  }
  const tmClubIds = new Set(tmLeagueTeams.map((t) => t.club_id));
  const configClubIds = new Set(teams.map((t) => t.transfermarkt_club_id));
  const missingFromConfig = [...tmClubIds].filter((id) => !configClubIds.has(id));
  const missingFromLive = [...configClubIds].filter((id) => !tmClubIds.has(id));
  if (missingFromConfig.length || missingFromLive.length) {
    fail(
      `Le squadre correnti su Transfermarkt non combaciano con config/teams-aliases.json. ` +
        `Nuove non in config: ${JSON.stringify(missingFromConfig)}. ` +
        `In config ma non piu' attuali: ${JSON.stringify(missingFromLive)}. ` +
        `Aggiornare config/teams-aliases.json e rilanciare.`,
    );
  }
  console.log(`   -> 20 squadre confermate, combaciano con config/teams-aliases.json`);

  // 3) Transfermarkt: rosa per ciascuna delle 20 squadre.
  console.log("\n[3/4] Transfermarkt — rose per squadra");
  const rostersByClubId = {};
  for (const team of teams) {
    const roster = await cachedFetch(
      `data/raw/transfermarkt/rosters/${team.transfermarkt_club_id}.json`,
      () => getTeamRoster(team.transfermarkt_slug, team.transfermarkt_club_id, currentSeasonCfg.transfermarkt_saison_id),
      { minLength: 1 },
    );
    if (roster.length < MIN_ROSTER_SIZE || roster.length > MAX_ROSTER_SIZE) {
      fail(
        `Rosa di ${team.official_name} anomala: ${roster.length} giocatori (atteso ${MIN_ROSTER_SIZE}-${MAX_ROSTER_SIZE}). ` +
          `Possibile cambio di struttura della pagina Transfermarkt: verificare il selettore in lib/transfermarkt.js.`,
      );
    }
    rostersByClubId[team.transfermarkt_club_id] = roster;
    console.log(`   -> ${team.official_name}: ${roster.length} giocatori`);
  }

  // 4) Determina quali giocatori Understat servono davvero (matchati al roster attuale)
  //    e scarica il loro storico partite (getPlayerMatches), con cache incrementale.
  console.log("\n[4/4] Understat — storico partite per giocatore (solo per giocatori rilevanti)");
  const { links } = linkPlayers({
    teams,
    understat2025: understatPlayersBySeason[seasons["2025-26"].understat_season],
    understat2026: understatPlayersBySeason[seasons["2026-27"].understat_season],
    rostersByClubId,
  });

  const relevantUnderstatIds = [...new Set(links.filter((l) => l.understat_id).map((l) => l.understat_id))];
  console.log(`   -> ${relevantUnderstatIds.length} giocatori da recuperare (storico partite)`);

  let failures = 0;
  for (let i = 0; i < relevantUnderstatIds.length; i++) {
    const id = relevantUnderstatIds[i];
    const path = `data/raw/understat/player-matches/${id}.json`;
    if (!FORCE && fileExists(path)) continue;
    try {
      const matches = await getPlayerMatches(id);
      await writeJson(path, matches);
    } catch (err) {
      failures++;
      console.warn(`   ! fallito getPlayerMatches(${id}): ${err.message}`);
    }
    if ((i + 1) % 50 === 0) console.log(`   ... ${i + 1}/${relevantUnderstatIds.length}`);
  }
  const failureRate = relevantUnderstatIds.length === 0 ? 0 : failures / relevantUnderstatIds.length;
  console.log(`   -> completato: ${failures} fallimenti su ${relevantUnderstatIds.length} (${(failureRate * 100).toFixed(1)}%)`);
  if (failureRate > MAX_MATCH_FETCH_FAILURE_RATE) {
    fail(
      `Tasso di fallimento getPlayerMatches troppo alto (${(failureRate * 100).toFixed(1)}% > ${MAX_MATCH_FETCH_FAILURE_RATE * 100}%): ` +
        `probabile blocco sistemico della fonte, non un fallimento isolato.`,
    );
  }

  console.log("\n=== fetch-data completato ===");
}

main().catch((err) => {
  console.error(err);
  fail(`Errore non gestito: ${err.message}`);
});
