# Serie A stats — dataset

Dataset JSON pulito e verificato dei giocatori attualmente in Serie A, con statistiche avanzate (xG, xA, npxG, xGChain, xGBuildup) per la stagione storica 2025/26 e per la stagione corrente 2026/27 (parziale).

Fonti: [Understat](https://understat.com) per le statistiche avanzate, [Transfermarkt](https://www.transfermarkt.com) per il roster attuale delle 20 squadre di Serie A.

## Uso

```bash
npm install
npm run build-data      # fetch-data.js + normalize-data.js -> data/serie-a-master.json, data/serie-a-matches.json
npm run validate-data    # valida data/serie-a-master.json
```

- `npm run fetch-data` — raccoglie solo i dati grezzi in `data/raw/` (idempotente: salta le richieste già in cache; `--force` per rifare tutto).
- `npm run normalize-data` — matching, filtro roster attuale, calcolo metriche derivate, scrittura degli output finali. Legge solo `data/raw/`, nessuna richiesta di rete.
- `npm run validate-data` — controlli strutturali, di coerenza numerica e di appartenenza al roster attuale. Esce con codice diverso da zero se trova errori.

## Output

- `data/serie-a-master.json` — un record per giocatore attualmente in Serie A, con storico 2025-26 e stagione corrente 2026-27.
- `data/serie-a-matches.json` — dati partita-per-partita, separati per non appesantire il file principale.
- `data/unmatched-report.json` — mapping incerti tra Understat e Transfermarkt, da rivedere manualmente.

Nessun dato mancante viene sostituito con `0` o valori inventati: dove l'informazione non è disponibile il campo è `null`.
