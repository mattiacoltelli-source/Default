import { matchTeamPlayers, normalizeName } from "./match-players.js";

/**
 * Determina, per ciascuna delle 20 squadre correnti, quali giocatori Understat
 * corrispondono a quali giocatori Transfermarkt (roster attuale).
 *
 * Passi (in ordine, ciascuno lavora solo su chi non e' ancora stato assegnato):
 *  A. match ristretto alla stessa squadra, stagione corrente (2026-27) —
 *     il segnale piu' forte, copre chi ha gia' giocato quest'anno.
 *  B. match ristretto alla stessa squadra, stagione storica (2025-26) —
 *     copre chi era gia' in questa squadra l'anno scorso ma non ha ancora
 *     giocato quest'anno (es. infortunato, panchinaro).
 *  C. match GLOBALE (tutte le squadre) sulla stagione storica 2025-26, solo
 *     nome esatto o token-subset (mai fuzzy) — copre i trasferimenti Serie A
 *     -> Serie A dell'estate in cui il giocatore non ha ancora esordito con la
 *     nuova squadra (es. Andrea Pinamonti Sassuolo 2025/26 -> Lazio 2026/27):
 *     senza questo passo lo storico esisterebbe su Understat ma non verrebbe
 *     mai trovato, perche' nella stagione 2025-26 il suo team_title era
 *     un'altra squadra e nella 2026-27 non compare ancora (0 presenze).
 *     Restrizione a exact/token-subset (niente dice fuzzy) perche' qui non
 *     c'e' piu' la squadra a fare da riscontro incrociato contro gli omonimi.
 *
 * Una volta trovato un player_id Understat stabile, le statistiche storiche
 * 2025-26 vengono recuperate per QUEL id direttamente (join per id), quindi
 * riflettono correttamente la squadra dell'anno scorso anche se diversa da
 * quella attuale.
 *
 * @param {object[]} teams config/teams-aliases.json .teams
 * @param {object[]} understat2025 output di getPlayersStats per la stagione storica
 * @param {object[]} understat2026 output di getPlayersStats per la stagione corrente
 * @param {Record<string, object[]>} rostersByClubId rose Transfermarkt per club_id
 */
export function linkPlayers({ teams, understat2025, understat2026, rostersByClubId }) {
  const links = [];
  const unmatchedByTeam = [];
  const usedUnderstatIds = new Set();

  const toUnderstatEntries = (players) => players.map((p) => ({ understat_id: String(p.id), name: p.player_name }));
  const poolForTeam = (understatPlayers, understatTeamTitle) =>
    toUnderstatEntries(
      understatPlayers.filter((p) => p.team_title.split(",").map((s) => s.trim()).includes(understatTeamTitle)),
    );

  const perTeamState = [];

  // Passi A + B: match ristretto alla squadra (2026 poi 2025), squadra per squadra.
  for (const team of teams) {
    const roster = rostersByClubId[team.transfermarkt_club_id] ?? [];
    const tmPlayers = roster.map((p) => ({ transfermarkt_id: p.transfermarkt_id, name: p.name }));

    const pool2026 = poolForTeam(understat2026, team.understat_team_title).filter(
      (u) => !usedUnderstatIds.has(u.understat_id),
    );
    const r1 = matchTeamPlayers(pool2026, tmPlayers);
    const matchedThisTeam = r1.matches.map((m) => ({ ...m, matched_via_season: "2026-27", matched_via: "same-team" }));
    r1.matches.forEach((m) => usedUnderstatIds.add(m.understat_id));

    let remainingTm = tmPlayers.filter((t) =>
      r1.unmatchedTransfermarkt.some((u) => u.transfermarkt_id === t.transfermarkt_id),
    );
    const pool2025 = poolForTeam(understat2025, team.understat_team_title).filter(
      (u) => !usedUnderstatIds.has(u.understat_id),
    );
    const r2 = matchTeamPlayers(pool2025, remainingTm);
    matchedThisTeam.push(...r2.matches.map((m) => ({ ...m, matched_via_season: "2025-26", matched_via: "same-team" })));
    r2.matches.forEach((m) => usedUnderstatIds.add(m.understat_id));

    perTeamState.push({
      team,
      roster,
      matchedThisTeam,
      unmatchedTm: r2.unmatchedTransfermarkt,
      understatOrphans: [...r1.unmatchedUnderstat, ...r2.unmatchedUnderstat],
    });
  }

  // Passo C: match globale (tutte le squadre) sulla stagione storica 2025-26,
  // solo per chi e' rimasto senza identita' dopo A+B — solo exact/token-subset.
  const allUnderstat2025 = toUnderstatEntries(understat2025).filter((u) => !usedUnderstatIds.has(u.understat_id));
  for (const state of perTeamState) {
    if (state.unmatchedTm.length === 0) continue;
    const tmRemaining = state.unmatchedTm
      .map((u) => state.roster.find((r) => r.transfermarkt_id === u.transfermarkt_id))
      .filter(Boolean)
      .map((p) => ({ transfermarkt_id: p.transfermarkt_id, name: p.name }));

    const pool = allUnderstat2025.filter((u) => !usedUnderstatIds.has(u.understat_id));
    const stillUnmatched = [];
    for (const t of tmRemaining) {
      const tNorm = normalizeName(t.name);
      const exact = pool.filter((u) => !usedUnderstatIds.has(u.understat_id) && normalizeName(u.name) === tNorm);
      const candidate = exact.length === 1 ? exact[0] : undefined;
      if (candidate) {
        state.matchedThisTeam.push({
          transfermarkt_id: t.transfermarkt_id,
          understat_id: candidate.understat_id,
          confidence: "medium",
          matched_via_season: "2025-26",
          matched_via: "cross-team",
        });
        usedUnderstatIds.add(candidate.understat_id);
      } else {
        stillUnmatched.push({ transfermarkt_id: t.transfermarkt_id, name: t.name });
      }
    }
    state.unmatchedTm = stillUnmatched;
  }

  for (const state of perTeamState) {
    for (const tm of state.roster) {
      const m = state.matchedThisTeam.find((x) => x.transfermarkt_id === tm.transfermarkt_id);
      links.push({
        team: state.team,
        tm_player: tm,
        understat_id: m ? m.understat_id : null,
        match_confidence: m ? m.confidence : "none",
        matched_via_season: m ? m.matched_via_season : null,
        matched_via: m ? m.matched_via : null,
      });
    }

    unmatchedByTeam.push({
      team: state.team.key,
      understat_players_not_in_current_roster: state.understatOrphans,
      transfermarkt_players_without_understat_id: state.unmatchedTm,
    });
  }

  return { links, unmatchedByTeam };
}
