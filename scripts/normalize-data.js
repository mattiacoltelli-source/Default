import { readJson, writeJson, fileExists } from "./lib/fs-utils.js";
import { linkPlayers } from "./lib/link-players.js";
import { resolveSeasonTeam } from "./lib/resolve-season.js";
import { round3, per90 } from "./lib/metrics.js";

const MIN_PLAYERS = 450;
const MAX_PLAYERS = 650;

function fail(message) {
  console.error(`\n[FAIL] ${message}\n`);
  process.exit(1);
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function loadRaw(seasons) {
  const understatPlayers = {};
  const understatLeague = {};
  for (const cfg of Object.values(seasons)) {
    const s = cfg.understat_season;
    understatPlayers[s] = await readJson(`data/raw/understat/players-${s}.json`);
    understatLeague[s] = await readJson(`data/raw/understat/league-${s}.json`);
  }

  const teamsConfig = await readJson("config/teams-aliases.json");
  const rostersByClubId = {};
  for (const team of teamsConfig.teams) {
    rostersByClubId[team.transfermarkt_club_id] = await readJson(
      `data/raw/transfermarkt/rosters/${team.transfermarkt_club_id}.json`,
    );
  }

  return { understatPlayers, understatLeague, rostersByClubId, teams: teamsConfig.teams };
}

async function loadPlayerMatches(understatId) {
  const path = `data/raw/understat/player-matches/${understatId}.json`;
  if (!fileExists(path)) return null;
  return readJson(path);
}

function buildSeasonStatsFromAggregate(row) {
  const appearances = num(row.games);
  const minutes = num(row.time);
  const goals = num(row.goals);
  const assists = num(row.assists);
  const xg = round3(num(row.xG));
  const xa = round3(num(row.xA));
  const npxg = round3(num(row.npxG));
  const xgChain = round3(num(row.xGChain));
  const xgBuildup = round3(num(row.xGBuildup));
  const npg = num(row.npg);
  return {
    appearances,
    minutes,
    goals,
    assists,
    xg,
    xa,
    npxg,
    xg_chain: xgChain,
    xg_buildup: xgBuildup,
    xg90: per90(xg, minutes),
    xa90: per90(xa, minutes),
    npxg90: per90(npxg, minutes),
    yellow_cards: num(row.yellow_cards),
    red_cards: num(row.red_cards),
    penalties_scored: goals != null && npg != null ? goals - npg : null,
  };
}

function emptySeasonStats() {
  return {
    appearances: null,
    minutes: null,
    goals: null,
    assists: null,
    xg: null,
    xa: null,
    npxg: null,
    xg_chain: null,
    xg_buildup: null,
    xg90: null,
    xa90: null,
    npxg90: null,
    yellow_cards: null,
    red_cards: null,
    penalties_scored: null,
  };
}

function validTeamNamesForSeason(understatLeagueSeason) {
  return new Set(Object.values(understatLeagueSeason).map((t) => t.title));
}

async function main() {
  console.log("=== normalize-data: matching, filtro roster, calcolo metriche ===\n");

  const seasonsConfig = await readJson("config/seasons.json");
  const seasons = seasonsConfig.seasons;
  const historicalKey = seasonsConfig.historical_season;
  const currentKey = seasonsConfig.current_season;
  const historicalUnderstatSeason = seasons[historicalKey].understat_season;
  const currentUnderstatSeason = seasons[currentKey].understat_season;

  const { understatPlayers, understatLeague, rostersByClubId, teams } = await loadRaw(seasons);

  const understatById = {};
  for (const seasonStr of Object.keys(understatPlayers)) {
    understatById[seasonStr] = new Map(understatPlayers[seasonStr].map((p) => [String(p.id), p]));
  }
  const validTeams = {
    [historicalUnderstatSeason]: validTeamNamesForSeason(understatLeague[historicalUnderstatSeason]),
    [currentUnderstatSeason]: validTeamNamesForSeason(understatLeague[currentUnderstatSeason]),
  };

  const { links, unmatchedByTeam } = linkPlayers({
    teams,
    understat2025: understatPlayers[historicalUnderstatSeason],
    understat2026: understatPlayers[currentUnderstatSeason],
    rostersByClubId,
  });

  const players = [];
  const matchesByPlayerId = {};
  const uncertainMappings = [];
  let ambiguousSeasonSplits = 0;

  for (const link of links) {
    const { team, tm_player, understat_id, match_confidence } = link;
    const playerId = understat_id ?? `tm_${tm_player.transfermarkt_id}`;

    if (match_confidence === "medium" || match_confidence === "low") {
      uncertainMappings.push({
        player_id: playerId,
        name: tm_player.name,
        team: team.official_name,
        confidence: match_confidence,
        understat_id,
      });
    }

    const player = {
      player_id: playerId,
      understat_player_id: understat_id,
      transfermarkt_id: tm_player.transfermarkt_id,
      name: tm_player.name,
      team_current: team.official_name,
      position: tm_player.position,
      match_confidence,
      seasons: {},
    };

    const careerMatches = understat_id ? await loadPlayerMatches(understat_id) : null;
    if (understat_id && !careerMatches) {
      player.matches_data_available = false;
    }

    for (const [seasonKey, understatSeasonStr] of [
      [currentKey, currentUnderstatSeason],
      [historicalKey, historicalUnderstatSeason],
    ]) {
      const row = understat_id ? understatById[understatSeasonStr].get(understat_id) : undefined;

      if (!row) {
        if (seasonKey === currentKey) {
          player.seasons[seasonKey] = { team: team.official_name, ...emptySeasonStats() };
        }
        continue;
      }

      const stats = buildSeasonStatsFromAggregate(row);
      let teamForSeason = row.team_title;
      let teamHistory = null;

      if (careerMatches) {
        const seasonMatches = careerMatches.filter(
          (m) =>
            m.season === understatSeasonStr &&
            validTeams[understatSeasonStr].has(m.h_team) &&
            validTeams[understatSeasonStr].has(m.a_team),
        );
        const resolved = resolveSeasonTeam(row.team_title, seasonMatches);
        teamForSeason = resolved.team;
        teamHistory = resolved.teamHistory;
        ambiguousSeasonSplits += resolved.ambiguousCount;

        if (resolved.matches.length > 0) {
          matchesByPlayerId[playerId] ??= [];
          matchesByPlayerId[playerId].push(
            ...resolved.matches.map(({ _ownTeam, ...m }) => ({ season: seasonKey, ...m })),
          );
        }
      }

      player.seasons[seasonKey] = { team: teamForSeason, ...(teamHistory ? { team_history: teamHistory } : {}), ...stats };
    }

    players.push(player);
  }

  console.log(`Giocatori nel roster attuale (20 squadre): ${players.length}`);
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    fail(
      `Numero di giocatori fuori range plausibile: ${players.length} (atteso ${MIN_PLAYERS}-${MAX_PLAYERS}). ` +
        `Possibile problema nel parsing dei roster Transfermarkt.`,
    );
  }

  const matchedCount = players.filter((p) => p.understat_player_id).length;
  console.log(`Giocatori con identita' Understat trovata: ${matchedCount}/${players.length}`);
  console.log(`Mapping incerti (medium/low confidence): ${uncertainMappings.length}`);
  console.log(`Split di squadra ambigui nelle partite (non attribuibili): ${ambiguousSeasonSplits}`);

  const currentSeasonMatchesAvailable = Math.max(
    ...Object.values(understatLeague[currentUnderstatSeason]).map((t) => t.history.length),
  );

  const master = {
    metadata: {
      generated_at: new Date().toISOString(),
      league: "Serie A",
      historical_season: seasons[historicalKey].label,
      current_season: seasons[currentKey].label,
      current_date: new Date().toISOString().slice(0, 10),
      current_season_matches_available: currentSeasonMatchesAvailable,
      sources: [
        {
          name: "Understat",
          purpose: "advanced player statistics (xG, xA, npxG, xGChain, xGBuildup, minutes, appearances, per-match data)",
          url: "https://understat.com/league/Serie_A",
        },
        {
          name: "Transfermarkt",
          purpose: "current Serie A roster (teams and squad membership)",
          url: "https://www.transfermarkt.com/serie-a/startseite/wettbewerb/IT1",
        },
      ],
    },
    players,
  };

  const matchesFile = {
    metadata: {
      generated_at: master.metadata.generated_at,
      seasons_included: [seasons[historicalKey].label, seasons[currentKey].label],
    },
    matches: matchesByPlayerId,
  };

  const report = {
    generated_at: master.metadata.generated_at,
    uncertain_mappings: uncertainMappings,
    unmatched_by_team: unmatchedByTeam,
  };

  await writeJson("data/serie-a-master.json", master);
  await writeJson("data/serie-a-matches.json", matchesFile);
  await writeJson("data/unmatched-report.json", report);

  console.log("\nScritti: data/serie-a-master.json, data/serie-a-matches.json, data/unmatched-report.json");
  console.log("\n=== normalize-data completato ===");
}

main().catch((err) => {
  console.error(err);
  fail(`Errore non gestito: ${err.message}`);
});
