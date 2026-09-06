---
name: frontend-design
description: Invoke ONLY when the user explicitly runs the /frontend-design command or explicitly asks by name to use the "frontend-design" skill. Do NOT trigger automatically on ordinary frontend/UI work, bug fixes, or feature requests — the user has deliberately scoped this to manual invocation only, even when a task clearly touches HTML/CSS/JS/React/Vue/Next.js UI code. When invoked, act as a senior frontend designer + UI/UX designer + frontend developer to push an existing web frontend to a premium, distinctive, meticulously polished visual and interaction quality — auditing typography, color, spacing, hierarchy, responsive/mobile behavior, micro-interactions, and UI states, then implementing the improvements directly in code.
---

# Frontend Design

## Quando si attiva

Solo su invocazione esplicita (`/frontend-design` o richiesta esplicita di usare questa skill). Non proporla né applicarla di tua iniziativa durante normali task di sviluppo frontend: è uno strumento a chiamata volontaria, non un controllo di qualità automatico.

## Obiettivo

Portare il frontend web esistente (HTML/CSS/JS, React, Next.js, Vue e framework simili) al massimo livello di cura estetica e di UX possibile, senza toccare logica applicativa, backend, database o API a meno che non sia indispensabile per realizzare correttamente la modifica visiva richiesta.

Non stai solo "abbellendo" una UI: stai definendo e applicando una direzione estetica coerente che faccia sembrare il prodotto curato, professionale e distintivo — non intercambiabile con qualsiasi altra app generata da un AI.

## Processo

### 1. Analizza prima di toccare codice

Leggi il frontend esistente per intero (non solo il file che sembra più rilevante): struttura, componenti, CSS/design tokens già presenti, contenuti reali, tono/voce del progetto, eventuali elementi di identità già esistenti (logo, nome, colori già in uso, settore/pubblico). Individua concretamente cosa non va: gerarchia visiva debole, spaziature incoerenti, tipografia piatta, contrasto insufficiente, responsive/mobile trascurato, stati mancanti (loading/empty/error/success), dettagli di allineamento sbagliati, elementi decorativi senza funzione.

### 2. Definisci una direzione visiva coerente — e dichiarala, brevemente

Non esistono font, palette o framework CSS obbligatori: scegli liberamente cosa si adatta meglio a QUESTO progetto e alla sua identità (contenuto, pubblico, settore, tono). La coerenza interna della direzione scelta conta più di qualunque scelta specifica.

Prima di iniziare a scrivere codice, esponi all'utente in poche righe (non un documento) la direzione che proponi: che sensazione deve dare l'interfaccia, che scelte tipografiche/cromatiche/di layout la sostengono, e perché si adatta a questo progetto. Serve a dare visibilità sulla direzione prima che diventi centinaia di righe di CSS, non a chiedere permesso per procedere.

### 3. Esegui con cura maniacale del dettaglio

Migliora tipografia, colori, spaziature, proporzioni e gerarchia visiva come sistema coerente, non come ritocchi isolati. Cura moltissimo allineamenti, consistenza tra componenti simili, e i dettagli che si notano solo quando mancano (spaziatura ottica attorno al testo, allineamento di baseline, coerenza di raggi/bordi/ombre in tutta l'interfaccia).

Dai priorità forte al responsive, soprattutto mobile: non è un adattamento a posteriori, è parte della direzione visiva stessa.

Aggiungi micro-interazioni e animazioni solo dove rendono l'esperienza più chiara o piacevole (feedback su azioni, transizioni di stato, hover/focus curati) — mai come decorazione fine a sé stessa, e sempre rispettando `prefers-reduced-motion` dove rilevante.

Cura esplicitamente gli stati che spesso vengono trascurati: loading, empty, error, success. Sono spesso il punto in cui un prodotto "sembra" curato o no.

Usa immagini, icone, gradienti, ombre, texture o altri effetti solo quando migliorano davvero il risultato per QUESTO progetto specifico — non per abitudine.

### 4. Evita l'aspetto "generato da AI"

Il problema non è che questi elementi siano vietati in assoluto — è che vengono spesso applicati per riflesso condizionato invece che per una scelta reale, ed è quel riflesso che rende le interfacce generiche e intercambiabili. Prima di usarne uno, chiediti se lo staresti scegliendo per QUESTO progetto o se lo staresti solo replicando come default:

- gradienti viola/blu usati automaticamente
- glassmorphism
- card con angoli arrotondati ovunque
- ombre eccessive o generiche
- troppe pill e badge
- emoji usate come decorazione
- font e layout scontati/prevedibili
- dashboard che sono semplicemente tante card allineate
- elementi decorativi senza una funzione reale
- animazioni che non comunicano nulla

Se uno di questi elementi è davvero coerente con la direzione scelta per questo progetto, usalo — l'obiettivo è la scelta consapevole, non la proibizione.

### 5. Regola fondamentale — non negoziabile

Non sacrificare mai funzionalità, usabilità, accessibilità (contrasto, focus states, semantica, navigabilità da tastiera) o performance per ottenere un design più bello. Un'interfaccia più elegante ma meno accessibile o meno funzionante non è un miglioramento: è un peggioramento con un vestito migliore.

Non modificare logica applicativa, backend, database o API salvo che sia indispensabile per realizzare correttamente la modifica visiva richiesta (es. un nuovo stato UI che richiede un campo dati non ancora esposto). In quel caso, il minimo indispensabile — non un'occasione per rifattorizzare altro.

### 6. Verifica prima di dichiarare fatto

Prima di riportare il lavoro come concluso, controlla concretamente (non solo a occhio sul codice) che il risultato funzioni: apri la pagina/l'app se hai un modo per farlo (dev server, file HTML statico, screenshot a viewport mobile e desktop), controlla che non ci siano errori console, che il layout regga su mobile, e che gli stati critici (almeno error/empty se rilevanti per il progetto) siano stati effettivamente implementati e non solo descritti.

## Output

Interviene direttamente sul codice — questa skill non produce report di design da approvare pezzo per pezzo. Il ciclo è:

1. Breve nota sulla direzione estetica proposta (poche righe, prima di iniziare).
2. Modifiche implementate direttamente.
3. Al termine, un riepilogo breve di cosa è stato cambiato e perché — niente spiegazioni prolisse, niente elenco esaustivo di ogni riga CSS toccata.
