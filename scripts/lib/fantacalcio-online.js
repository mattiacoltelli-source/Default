import * as cheerio from "cheerio";
import { fetchWithRetry } from "./http.js";

const BASE_URL = "https://www.fantacalcio-online.com";
const ROLE_MAP = { POR: "P", DIF: "D", CEN: "C", ATT: "A" };

function toNumber(text) {
  const t = text.trim().replace(",", ".");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/** @param {string} seasonSlug es. "2026-2027" */
export async function fetchVotiHtml(seasonSlug) {
  const res = await fetchWithRetry(`${BASE_URL}/it/serie-a/${seasonSlug}/voti-fantacalcio`, {
    retries: 3,
    baseDelayMs: 1000,
  });
  return res.text();
}

/**
 * Tabella stagionale completa: ruolo, squadra, nome (in formato "COGNOME Nome"),
 * Kap. (crediti spesi in asta, aggregato da leghe reali — il "prezzo medio asta"),
 * presenze, voto oggettivo, voti delle tre testate (Gazzetta/Corriere/Tuttosport),
 * fantamedia finale (voto + bonus/malus).
 */
export function parseVoti(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table#players_list > tbody > tr").each((_, tr) => {
    const $tds = $(tr).find("> td");
    if ($tds.length < 10) return; // salta righe filtro/intestazione che non sono dati giocatore
    const roleTag = $tds.eq(0).find("span.role").text().trim();
    const role = ROLE_MAP[roleTag];
    const team = $tds.eq(1).text().trim();
    const nameCell = $tds.eq(2);
    const surname = nameCell.find("span.text-bold").text().trim();
    const fullText = nameCell.text().trim();
    const firstName = fullText.startsWith(surname) ? fullText.slice(surname.length).trim() : "";
    if (!role || !team || !surname) return;

    rows.push({
      name: firstName ? `${firstName} ${surname}` : surname,
      team,
      role,
      kap: toNumber($tds.eq(3).text()),
      presenze: toNumber($tds.eq(4).text()),
      voto_oggettivo: toNumber($tds.eq(5).text()),
      voto_gazzetta: toNumber($tds.eq(6).text()),
      voto_corriere: toNumber($tds.eq(7).text()),
      voto_tuttosport: toNumber($tds.eq(8).text()),
      fantamedia: toNumber($tds.eq(10).text()),
    });
  });
  return rows;
}
