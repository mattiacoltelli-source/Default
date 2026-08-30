import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeJson, fileExists, readJson } from "./lib/fs-utils.js";
import { fetchQuotazioniHtml, parseQuotazioni } from "./lib/fantacalcio-it.js";
import { fetchVotiHtml, parseVoti } from "./lib/fantacalcio-online.js";

const FORCE = process.argv.includes("--force");
const MIN_QUOTAZIONI_ROWS = 400;
const MIN_VOTI_ROWS = 400;
const RAW_DIR = "data/raw/market";

function fail(message) {
  console.error(`\n[FAIL] ${message}\n`);
  process.exit(1);
}

async function cachedHtml(path, fetcher) {
  if (!FORCE && fileExists(path)) {
    console.log(`  (cache) ${path}`);
    return readFile(path, "utf-8");
  }
  const html = await fetcher();
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(path, html, "utf-8");
  console.log(`  ok: ${path}`);
  return html;
}

async function main() {
  console.log("=== fetch-market-data: quotazioni Fantacalcio.it + voti/prezzi Fantacalcio-Online ===\n");

  const seasonsConfig = await readJson("config/seasons.json");
  const seasons = seasonsConfig.seasons;

  console.log("[1/2] Fantacalcio.it — quotazioni ufficiali Classic");
  const quotazioniHtml = await cachedHtml(`${RAW_DIR}/quotazioni.html`, fetchQuotazioniHtml);
  const quotazioni = parseQuotazioni(quotazioniHtml);
  console.log(`   -> ${quotazioni.length} righe quotazioni`);
  if (quotazioni.length < MIN_QUOTAZIONI_ROWS) {
    fail(`Quotazioni Fantacalcio.it: solo ${quotazioni.length} righe (atteso >= ${MIN_QUOTAZIONI_ROWS}). Verificare il parsing/selettore.`);
  }
  await writeJson(`${RAW_DIR}/quotazioni.json`, quotazioni);

  console.log("\n[2/2] Fantacalcio-Online — voti stagionali + Kap. (prezzo medio asta reale)");
  for (const [seasonKey, cfg] of Object.entries(seasons)) {
    const slug = cfg.fantacalcio_online_season_slug;
    console.log(` - stagione ${seasonKey} (slug=${slug})`);
    const html = await cachedHtml(`${RAW_DIR}/voti-${seasonKey}.html`, () => fetchVotiHtml(slug));
    const rows = parseVoti(html);
    console.log(`   -> ${rows.length} righe voti`);
    if (rows.length < MIN_VOTI_ROWS) {
      fail(`Voti Fantacalcio-Online stagione ${seasonKey}: solo ${rows.length} righe (atteso >= ${MIN_VOTI_ROWS}). Verificare il parsing/selettore.`);
    }
    await writeJson(`${RAW_DIR}/voti-${seasonKey}.json`, rows);
  }

  console.log("\n=== fetch-market-data completato ===");
}

main().catch((err) => {
  console.error(err);
  fail(`Errore non gestito: ${err.message}`);
});
