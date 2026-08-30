# Serie A stats — dataset + app

Dataset JSON pulito e verificato dei giocatori attualmente in Serie A: statistiche avanzate (xG, xA, npxG, xGChain, xGBuildup) per la stagione storica 2025/26 e per la stagione corrente 2026/27 (parziale), quotazioni ufficiali, prezzo medio reale d'asta e fantavoto multi-testata.

## App "Occasioni d'Asta"

`index.html` (+ `manifest.webmanifest`, `icon.svg`) è l'app di supporto per l'asta, pubblicata via GitHub Pages su questo stesso repo: **https://mattiacoltelli-source.github.io/Default/**. Legge i dati dal dataset qui sotto (embedded nella pagina, nessuna chiamata di rete a runtime) e mostra verdetti "consigliato/sconsigliato" motivati, ordinabili/filtrabili, più una sezione bonus difesa.

Per aggiornarla dopo un nuovo `npm run build-data`: rigenerare `index.html` incorporando il nuovo `data/serie-a-master.json` (blob JSON embedded + marker `APP_DATA_VERSION` aggiornato al `generated_at`), poi commit + push su `main` — GitHub Pages ripubblica in automatico in 1-2 minuti. Chi ha la pagina già aperta vede comparire un banner "Aggiorna" (controllo periodico in background, nessun ricaricamento automatico).

Fonti: [Understat](https://understat.com) (statistiche avanzate), [Transfermarkt](https://www.transfermarkt.com) (roster attuale delle 20 squadre di Serie A), [Fantacalcio.it](https://www.fantacalcio.it/quotazioni-fantacalcio) (quotazioni ufficiali Classic ed FVM), [Fantacalcio-Online](https://www.fantacalcio-online.com) (prezzo medio asta reale in crediti e fantavoto per stagione).

## Uso

```bash
npm install
npm run build-data      # fetch-data + normalize-data + fetch-market-data + enrich-market-data
npm run validate-data   # valida data/serie-a-master.json
```

- `npm run fetch-data` — raccoglie i dati grezzi Understat + Transfermarkt in `data/raw/` (idempotente: salta le richieste già in cache; `--force` per rifare tutto).
- `npm run normalize-data` — matching, filtro roster attuale, calcolo metriche derivate, scrittura degli output finali. Legge solo `data/raw/`, nessuna richiesta di rete.
- `npm run fetch-market-data` — raccoglie quotazioni Fantacalcio.it e voti/Kap. Fantacalcio-Online in `data/raw/market/` (idempotente come sopra).
- `npm run enrich-market-data` — arricchisce `data/serie-a-master.json` già esistente con `price`, `auction` e `fantavoto` per stagione. Rilanciabile da solo senza rifare fetch/normalize.
- `npm run validate-data` — controlli strutturali, di coerenza numerica e di appartenenza al roster attuale. Esce con codice diverso da zero se trova errori.

## Output

- `data/serie-a-master.json` — un record per giocatore attualmente in Serie A, con:
  - storico stagione 2025-26 e stagione corrente 2026-27 (xG/xA/ecc., `penalties_scored`, `clean_sheets` per i portieri (ricostruiti dal punteggio reale partita-per-partita, non stimati) + `fantavoto` per stagione quando disponibile: presenze, voto Gazzetta/Corriere/Tuttosport, voto oggettivo, Fantamedia);
  - `price`: quotazione ufficiale Classic (`qt_i`/`qt_a`) e FVM (Fantavalore di Mercato, indicatore di quanto il giocatore "dovrebbe" valere in base al rendimento);
  - `auction`: prezzo medio reale pagato all'asta quest'estate in crediti (`avg_price_credits`), aggregato da migliaia di leghe vere su Fantacalcio-Online — utile per confrontare "quanto costa di solito" con "quanto vale secondo le statistiche".
- `data/serie-a-matches.json` — dati partita-per-partita, separati per non appesantire il file principale.
- `data/unmatched-report.json` — mapping incerti tra Understat e Transfermarkt, da rivedere manualmente.
- `data/market-unmatched-report.json` — righe di quotazioni/voti non agganciate a nessun giocatore del roster attuale.

Nessun dato mancante viene sostituito con `0` o valori inventati: dove l'informazione non è disponibile il campo è `null`.
