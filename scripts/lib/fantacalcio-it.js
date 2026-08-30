import * as cheerio from "cheerio";
import { fetchWithRetry } from "./http.js";

const URL = "https://www.fantacalcio.it/quotazioni-fantacalcio";
const ROLE_MAP = { p: "P", d: "D", c: "C", a: "A" };

function toInt(text) {
  const t = text.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

export async function fetchQuotazioniHtml() {
  const res = await fetchWithRetry(URL, { retries: 3, baseDelayMs: 1000 });
  return res.text();
}

/**
 * Quotazioni ufficiali Classic: nome (di solito solo cognome), squadra (abbr.
 * a 3 lettere), ruolo classic, quotazione iniziale/attuale ed FVM (Fantavalore
 * di Mercato, indicatore fantacalcio.it di "quanto dovrebbe valere in base al
 * rendimento").
 */
export function parseQuotazioni(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("tr.player-row").each((_, tr) => {
    const $tr = $(tr);
    const name = $tr.find("th.player-name a span").first().text().trim();
    const teamAbbr = $tr.find('td.player-team[data-col-key="sq"]').text().trim();
    const roleCode = $tr.find("th.player-role-classic span.role").attr("data-value");
    if (!name || !teamAbbr) return;
    rows.push({
      name,
      team_abbr: teamAbbr,
      role: ROLE_MAP[roleCode] ?? null,
      qt_i: toInt($tr.find('td[data-col-key="c_qi"]').text()),
      qt_a: toInt($tr.find('td[data-col-key="c_qa"]').text()),
      fvm: toInt($tr.find('td[data-col-key="c_fvm"]').text()),
    });
  });
  return rows;
}
