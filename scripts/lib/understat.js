import { fetchWithRetry, RateLimiter } from "./http.js";

const BASE_URL = "https://understat.com";
const rateLimiter = new RateLimiter(350);

async function limitedFetch(url, options) {
  await rateLimiter.wait();
  return fetchWithRetry(url, options);
}

/**
 * Statistiche stagionali aggregate di tutti i giocatori di una lega/stagione.
 * POST https://understat.com/main/getPlayersStats/  body: league=<league>&season=<season>
 */
export async function getPlayersStats(league, season) {
  const res = await limitedFetch(`${BASE_URL}/main/getPlayersStats/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE_URL}/league/${league}/${season}`,
    },
    body: new URLSearchParams({ league, season }).toString(),
  });
  const data = await res.json();
  if (!data || data.success !== true || !Array.isArray(data.players)) {
    throw new Error(
      `Risposta inattesa da getPlayersStats(${league}, ${season}): ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return data.players;
}

/**
 * Dati squadra/partite per stagione.
 * GET https://understat.com/getLeagueData/<league>/<season>
 */
export async function getLeagueData(league, season) {
  const res = await limitedFetch(`${BASE_URL}/getLeagueData/${league}/${season}`, {
    headers: { Referer: `${BASE_URL}/league/${league}/${season}` },
  });
  const data = await res.json();
  if (!data || typeof data.teams !== "object" || data.teams === null) {
    throw new Error(
      `Risposta inattesa da getLeagueData(${league}, ${season}): ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return data.teams;
}

/**
 * Storico partite di carriera di un giocatore.
 * POST https://understat.com/main/getPlayerMatches/<playerId>
 */
export async function getPlayerMatches(playerId) {
  const res = await limitedFetch(`${BASE_URL}/main/getPlayerMatches/${playerId}`, {
    method: "POST",
    headers: { Referer: `${BASE_URL}/player/${playerId}` },
  });
  const data = await res.json();
  if (!data || !data.response || data.response.success !== true || !Array.isArray(data.response.matches)) {
    throw new Error(
      `Risposta inattesa da getPlayerMatches(${playerId}): ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return data.response.matches;
}
