# App Control Center

PWA statica che risponde a una domanda sola: **"le mie app stanno bene, o
c'è qualcosa che richiede la mia attenzione?"**

Monitora CineFighi, CineTracker, Spot e Predict. Si apre da telefono, dice
la risposta in tre secondi, e se la risposta è "no" dice cosa guardare e
dove.

👉 https://mattiacoltelli-source.github.io/Default/

## Cosa fa che GitHub non fa già

Aggregare non sarebbe bastato a giustificarla: il tab Actions di
[`qa-agent`](https://github.com/mattiacoltelli-source/qa-agent) dice quasi
tutto. Quello che nessuno strumento dice è **cosa non è successo**:

- **Un esito vecchio non è un esito.** Un PASS di dieci giorni fa non dice
  che l'app funziona, dice che funzionava dieci giorni fa. Ogni segnale ha
  una scadenza e quando la supera diventa giallo o rosso — anche se
  l'ultimo esito era verde. È la bugia più pericolosa che una dashboard di
  monitoraggio possa raccontare, perché somiglia a una buona notizia.
- **Le previsioni di Predict che non sono state generate.** GitHub mostra i
  run avvenuti; nessuno mostra quelli mancati. Se il file dello slot di
  oggi non c'è, qui diventa rosso.
- **Le valutazioni di Predict rimaste indietro.** Previsioni il cui
  orizzonte è scaduto da giorni e che sono ancora in `pending.json`: è il
  modo in cui `evaluate.yml` fallisce senza far diventare rosso niente.
- **Data Health che non gira da 7 giorni.** Non è una soglia decorativa:
  Supabase free tier sospende un progetto dopo 7 giorni senza richieste
  API. Oltre quel limite CineFighi e CineTracker si spengono da soli.

## Cosa NON fa

Non esegue controlli propri. Non apre browser, non interroga le API delle
app, non tocca Supabase. Quel lavoro lo fa già il QA Agent con sei agenti
dedicati, e rifarlo qui significherebbe avere due sistemi che possono
dissentire sullo stesso fatto.

```
qa-agent          →  controlla e produce i dati
App Control Center →  raccoglie, aggrega e mostra
```

Non ha metriche messe lì perché stanno bene in una dashboard: Spot non ne
ha nessuna, perché non ha un backend da cui leggerle e inventarle sarebbe
peggio che lasciarle fuori.

## Architettura

Nessun backend, nessun build, nessuna dipendenza, nessuna credenziale.
Una pagina statica su GitHub Pages che legge due sorgenti pubbliche:

```
raw.githubusercontent.com
├── qa-agent/status/*.json          esito dei sei agenti (vedi qa-agent/status/README.md)
├── qa-agent/history/data/*.jsonl   ripiego finché un agente non pubblica lo stato
└── Prova/REPORT.md, data/…         dati che Predict committa da sé
                ↓
api.github.com (senza token)        ultimo commit e ultimo deploy
                ↓
        index.html + 4 moduli JS
```

Funziona senza token perché **tutti i repo sono pubblici**. Questa è anche
la ragione per cui non c'è un backend: non c'è nessuna credenziale da
proteggere. Se un giorno servisse leggere qualcosa di privato, servirebbe
una Edge Function che faccia da proxy — mai una chiave dentro questo
bundle, che è pubblico quanto i repo che legge.

L'API GitHub non autenticata concede **60 richieste l'ora per indirizzo
IP** e un aggiornamento ne consuma una decina: per questo commit e deploy
sono in cache per dieci minuti e sono l'unica parte facoltativa della
pagina. Se la quota si esaurisce, gli stati restano aggiornati e compare
una nota — la risposta alla domanda principale non dipende da lì.

## Struttura

```
index.html      struttura e nient'altro
styles.css      un foglio, token in :root, chiaro/scuro automatico
config.js       repo, app, agenti, soglie di scadenza — le uniche costanti
sources.js      recupero dati, cache, copia offline, quota GitHub
rules.js        motore di stato e scadenza (puro, testato)
predict.js      segnali specifici di Predict (puro, testato)
app.js          composizione e disegno
sw.js           guscio in cache, dati mai
```

`rules.js` e `predict.js` non sanno nulla di DOM né di rete: sono funzioni
da dato a dato, ed è lì che vive il giudizio.

## Sviluppo

```bash
npm test      # 36 test, node --test, nessuna dipendenza
npm run serve # http://localhost:8080
```

Non c'è passo di build: i file che stanno nel repo sono quelli che
arrivano al browser.

## Soglie

| Segnale | Giallo | Rosso | Perché |
|---|---|---|---|
| QA, API Doctor, Performance | 5 giorni | 10 giorni | "Controllo Completo" gira lunedì e giovedì: l'intervallo normale più lungo è 4 giorni |
| Data Health | 6,25 giorni | **7 giorni** | Supabase free tier sospende un progetto dopo 7 giorni senza richieste |
| Scale, Security | 10 giorni | 20 giorni | Cambiano lentamente, un ritardo non è un'emergenza |
| Previsioni Predict | — | slot delle 7:00 ET passato | Solo nei giorni feriali, e solo dopo la chiusura della finestra di recupero |
| Valutazioni Predict | 1 in ritardo | oltre 3 | Oltre 3 giorni dalla scadenza dell'orizzonte |

Stanno tutte in `config.js`.

## Se è tutto giallo

Vuol dire che gli agenti non hanno ancora pubblicato uno stato. Lancia
["Controllo Completo"](https://github.com/mattiacoltelli-source/qa-agent/actions/workflows/full-check.yml)
una volta: da lì in poi ogni run aggiorna i file che questa pagina legge.
