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
- **Data Health che smette di girare.** Supabase free tier sospende un
  progetto dopo 7 giorni senza richieste API: oltre quel limite CineFighi
  e CineTracker si spengono da soli. Il giro notturno è ciò che li tiene
  svegli, e il rosso arriva con quattro giorni di margine sul danno.

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

Nessun backend, nessun build, nessun pacchetto da installare. Una pagina
statica su GitHub Pages che legge due sorgenti pubbliche:

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

L'unico codice di terzi è il loader di Sentry (~1,5 KB, caricato solo al
primo errore — vedi più sotto); tutto il resto è in questo repo.

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
sentry.js       segnalazione errori (loader lazy, tetto per sessione)
app.js          composizione e disegno
sw.js           guscio in cache, dati mai
```

`rules.js` e `predict.js` non sanno nulla di DOM né di rete: sono funzioni
da dato a dato, ed è lì che vive il giudizio.

## Sviluppo

```bash
npm test      # 38 test, node --test, nessun pacchetto da installare
npm run serve # http://localhost:8080
```

Non c'è passo di build: i file che stanno nel repo sono quelli che
arrivano al browser.

## Soglie

"Controllo Completo" gira **ogni notte alle 02:00 UTC** (le 4 del mattino
in Italia d'estate, le 3 d'inverno) e lancia tutti e sei gli agenti. Le
soglie seguono quella cadenza:

| Segnale | Giallo | Rosso | Perché |
|---|---|---|---|
| QA, Data Health, API Doctor, Performance | 36 ore | 72 ore | Un giro notturno saltato capita; tre di fila no |
| Scale, Security | 3 giorni | 7 giorni | Cambiano lentamente, un ritardo non è un'emergenza |
| Previsioni Predict | — | slot delle 7:00 ET passato | Solo nei giorni feriali, e solo dopo la chiusura della finestra di recupero |
| Valutazioni Predict | 1 in ritardo | oltre 3 | Oltre 3 giorni dalla scadenza dell'orizzonte |

Il rosso di Data Health a 72 ore lascia **4 giorni di margine** prima che
Supabase sospenda i database: è un test, non un commento.

Stanno tutte in `config.js`.

## Lanciare un controllo a mano

Il bottone **"Lancia un controllo"** apre l'elenco dei sette workflow e
porta alla pagina di quello scelto su GitHub, dove si preme "Run workflow".

**Perché un link e non un bottone che lo lancia davvero**: far partire un
workflow via API richiede un token con permesso `actions: write`. Questa
pagina è statica e pubblica, quindi un token qui dentro sarebbe leggibile
da chiunque apra il sorgente — e sarebbe un token *in scrittura*: chiunque
potrebbe lanciare i workflow, bruciare i minuti di Actions e usare lo
stesso token sui repo. Non c'è modo di nasconderlo in una pagina statica.
L'unica alternativa reale sarebbe una Edge Function che tiene il token
lato server e fa da proxy: un componente in più da mantenere e proteggere,
per risparmiare un tocco. Lo scambio non vale.

## Errori: Sentry

Gli errori JavaScript della dashboard finiscono nel progetto Sentry
`mattia-e5/control-center`. Una pagina di monitoraggio che si rompe in
silenzio è peggio che inutile, perché continua a sembrare rassicurante.

- **Loader script**, ~1,5 KB: scarica l'SDK vero solo quando c'è davvero
  un errore da mandare. In un giorno senza errori non costa niente.
- **Niente session replay, niente tracing**: disattivati anche lato
  progetto. Servono a un prodotto con utenti veri, qui brucerebbero quota.
- **Tetto di 10 eventi per sessione** (`config.js`), più il limite lato
  progetto: una DSN pubblica su una pagina pubblica va protetta da un
  ciclo di errori impazzito.
- **Un solo errore segnalato di proposito**: un `status/*.json` che esiste
  ma non è JSON valido. È un contratto rotto fra due repo che a schermo
  sembrerebbe solo uno stato "sconosciuto" in più.

La DSN sta in chiaro in `config.js`. È l'unica credenziale in questa
pagina, ed è l'unica che può starci: è una chiave pubblica di **sola
scrittura**, progettata per i bundle browser, che non dà accesso in
lettura a niente.

## Se è tutto giallo

Vuol dire che gli agenti non hanno ancora pubblicato uno stato. Lancia
["Controllo Completo"](https://github.com/mattiacoltelli-source/qa-agent/actions/workflows/full-check.yml)
una volta: da lì in poi ogni run aggiorna i file che questa pagina legge.
