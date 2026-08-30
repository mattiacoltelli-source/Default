import { round3 } from "./metrics.js";

/**
 * Risolve, per un giocatore in una data stagione, la squadra "giusta" da
 * riportare e la scomposizione partita-per-partita, a partire dalla riga
 * aggregata di getPlayersStats (che puo' avere team_title comma-separated se
 * il giocatore ha cambiato squadra) e dallo storico partite di carriera
 * (getPlayerMatches), gia' filtrato alla sola stagione e a squadre Serie A valide.
 *
 * @param {string} teamTitle es. "Genoa" oppure "Genoa,Roma"
 * @param {object[]} seasonMatches partite di QUESTA stagione, gia' filtrate
 * @returns {{ team: string, teamHistory: Array|null, matches: Array, ambiguousCount: number }}
 */
export function resolveSeasonTeam(teamTitle, seasonMatches) {
  const candidateTeams = teamTitle.split(",").map((s) => s.trim()).filter(Boolean);
  const minutesByTeam = new Map();
  const appearancesByTeam = new Map();
  let ambiguousCount = 0;

  const annotated = seasonMatches.map((m) => {
    const hIn = candidateTeams.includes(m.h_team);
    const aIn = candidateTeams.includes(m.a_team);
    let ownTeam = null;
    let opponent = null;
    let homeAway = null;
    if (hIn && !aIn) {
      ownTeam = m.h_team;
      opponent = m.a_team;
      homeAway = "h";
    } else if (aIn && !hIn) {
      ownTeam = m.a_team;
      opponent = m.h_team;
      homeAway = "a";
    } else {
      ambiguousCount++;
    }

    const minutes = Number(m.time);
    if (ownTeam) {
      minutesByTeam.set(ownTeam, (minutesByTeam.get(ownTeam) ?? 0) + minutes);
      if (minutes > 0) appearancesByTeam.set(ownTeam, (appearancesByTeam.get(ownTeam) ?? 0) + 1);
    }

    return {
      date: m.date,
      match_id: m.id,
      opponent,
      home_away: homeAway,
      minutes,
      goals: Number(m.goals),
      assists: Number(m.assists),
      xg: round3(Number(m.xG)),
      xa: round3(Number(m.xA)),
      _ownTeam: ownTeam,
    };
  });

  let team = candidateTeams[0];
  let teamHistory = null;
  if (candidateTeams.length > 1) {
    let maxMinutes = -1;
    for (const [t, minutes] of minutesByTeam) {
      if (minutes > maxMinutes) {
        maxMinutes = minutes;
        team = t;
      }
    }
    teamHistory = candidateTeams.map((t) => ({
      team: t,
      minutes: minutesByTeam.get(t) ?? 0,
      appearances: appearancesByTeam.get(t) ?? 0,
    }));
  }

  return { team, teamHistory, matches: annotated, ambiguousCount };
}
