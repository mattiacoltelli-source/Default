import { matchTeamPlayers } from "./match-players.js";

/**
 * Determina, per ciascuna delle 20 squadre correnti, quali giocatori Understat
 * corrispondono a quali giocatori Transfermarkt (roster attuale), usando prima
 * la stagione corrente (2026) e poi, per chi non ha ancora giocato quest'anno,
 * la stagione storica (2025) come fallback — sempre ristretto alla stessa squadra.
 *
 * Una volta trovato un player_id Understat stabile, le statistiche storiche
 * 2025-26 vengono recuperate per QUEL id direttamente (join per id, non per
 * nome/squadra): questo gestisce correttamente i trasferimenti Serie A -> Serie A
 * nell'estate 2026 (es. Inter 2025/26 -> Napoli 2026/27), perche' l'identita' del
 * giocatore viene stabilita sulla squadra ATTUALE, e lo storico si "aggancia" di
 * conseguenza indipendentemente da quale fosse la squadra l'anno scorso.
 *
 * @param {object[]} teams config/teams-aliases.json .teams
 * @param {object[]} understat2025 output di getPlayersStats per la stagione storica
 * @param {object[]} understat2026 output di getPlayersStats per la stagione corrente
 * @param {Record<string, object[]>} rostersByClubId rose Transfermarkt per club_id
 */
export function linkPlayers({ teams, understat2025, understat2026, rostersByClubId }) {
  const links = [];
  const unmatchedByTeam = [];

  const poolForTeam = (understatPlayers, understatTeamTitle) =>
    understatPlayers
      .filter((p) => p.team_title.split(",").map((s) => s.trim()).includes(understatTeamTitle))
      .map((p) => ({ understat_id: String(p.id), name: p.player_name }));

  for (const team of teams) {
    const roster = rostersByClubId[team.transfermarkt_club_id] ?? [];
    const tmPlayers = roster.map((p) => ({ transfermarkt_id: p.transfermarkt_id, name: p.name }));

    const pool2026 = poolForTeam(understat2026, team.understat_team_title);
    const pool2025 = poolForTeam(understat2025, team.understat_team_title);

    const r1 = matchTeamPlayers(pool2026, tmPlayers);
    const matchedThisTeam = r1.matches.map((m) => ({ ...m, matched_via_season: "2026-27" }));

    let remainingTm = tmPlayers.filter((t) =>
      r1.unmatchedTransfermarkt.some((u) => u.transfermarkt_id === t.transfermarkt_id),
    );
    const r2 = matchTeamPlayers(pool2025, remainingTm);
    matchedThisTeam.push(...r2.matches.map((m) => ({ ...m, matched_via_season: "2025-26" })));

    const unmatchedTm = r2.unmatchedTransfermarkt;

    for (const tm of roster) {
      const m = matchedThisTeam.find((x) => x.transfermarkt_id === tm.transfermarkt_id);
      links.push({
        team,
        tm_player: tm,
        understat_id: m ? m.understat_id : null,
        match_confidence: m ? m.confidence : "none",
        matched_via_season: m ? m.matched_via_season : null,
      });
    }

    unmatchedByTeam.push({
      team: team.key,
      understat_players_not_in_current_roster: [...r1.unmatchedUnderstat, ...r2.unmatchedUnderstat],
      transfermarkt_players_without_understat_id: unmatchedTm,
    });
  }

  return { links, unmatchedByTeam };
}
