import * as cheerio from "cheerio";
import { fetchWithRetry, RateLimiter } from "./http.js";

const BASE_URL = "https://www.transfermarkt.com";
const rateLimiter = new RateLimiter(1000);

async function limitedFetch(url) {
  await rateLimiter.wait();
  const res = await fetchWithRetry(url, { retries: 3, baseDelayMs: 1000 });
  return res.text();
}

const COARSE_POSITION_MAP = {
  Goalkeeper: "P",
  Defender: "D",
  Midfield: "C",
  Attack: "A",
};

/**
 * Elenco delle squadre correnti dalla pagina di classifica della lega.
 * La tabella corretta e' la PRIMA <table class="items"> della pagina
 * (contiene i link /{slug}/startseite/verein/{id}/saison_id/{season}) —
 * verificato manualmente, altre tabelle "items" nella pagina sono widget
 * (es. livescore) e non vanno confuse con questa.
 */
export async function getLeagueTeams(leagueSlug, seasonId) {
  const html = await limitedFetch(`${BASE_URL}/${leagueSlug}/startseite/wettbewerb/IT1`);
  const $ = cheerio.load(html);
  const table = $("table.items").first();
  const teams = [];
  table.find("> tbody > tr").each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[href*="/startseite/verein/"]').first();
    const href = link.attr("href");
    if (!href) return;
    const match = href.match(/^\/([a-z0-9-]+)\/startseite\/verein\/(\d+)/);
    if (!match) return;
    const [, slug, clubId] = match;
    const crest = $tr.find("img.tiny_wappen, img.wappen").first();
    const name = (crest.attr("title") || crest.attr("alt") || link.attr("title") || link.text()).trim();
    teams.push({ slug, club_id: clubId, name });
  });
  return teams;
}

/**
 * Rosa completa di una squadra per una data stagione.
 * Selettore verificato: div#yw1 > table.items (la tabella "Kader" vera e
 * propria) — gli altri elementi table.inline-table nella pagina sono
 * sotto-tabelle interne alla singola cella nome+eta e non vanno confusi
 * con la rosa.
 */
export async function getTeamRoster(slug, clubId, seasonId) {
  const html = await limitedFetch(`${BASE_URL}/${slug}/kader/verein/${clubId}/saison_id/${seasonId}`);
  const $ = cheerio.load(html);
  const table = $("#yw1 table.items").first();
  const players = [];
  table.find("> tbody > tr").each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('td.posrela a[href*="/profil/spieler/"]').first();
    const href = link.attr("href");
    if (!href) return;
    const match = href.match(/\/profil\/spieler\/(\d+)/);
    if (!match) return;
    const transfermarktId = match[1];
    const name = (link.attr("title") || link.text()).trim();
    const coarsePosition = $tr.find("td.rueckennummer").attr("title") || "";
    const position = COARSE_POSITION_MAP[coarsePosition] ?? null;
    if (!name) return;
    players.push({ transfermarkt_id: transfermarktId, name, position });
  });
  return players;
}
