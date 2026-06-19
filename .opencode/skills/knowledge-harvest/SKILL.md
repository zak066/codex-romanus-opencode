# Skill: knowledge-harvest

## Cos'è
Questa skill ti guida nella registrazione di conoscenza in Tabularium dopo ogni task completato. La knowledge base del team cresce solo se ogni agente contribuisce con pattern, lezioni, pitfalls e tips scoperti durante il lavoro.

## Quando usarla
- **ALLA FINE DI OGNI TASK** — chiediti: "Ho imparato qualcosa di riutilizzabile?"
- Dopo aver risolto un bug complesso
- Dopo aver scoperto un pattern architetturale
- Dopo aver trovato un workaround
- Dopo aver configurato qualcosa di non banale
- Dopo aver scoperto una best practice

## Categorie di conoscenza

| Categoria | Quando usarla | Esempio |
|-----------|---------------|---------|
| `pattern` | Hai trovato un pattern di codice/architettura riutilizzabile | "Strategy pattern per validatori eterogenei" |
| `tip` | Hai scoperto un trucco o scorciatoia utile | "Usare `queueMicrotask()` per evitare unhandled rejection nei test" |
| `pitfall` | Hai incontrato una trappola/trabocchetto | "`new Response()` non imposta `url` — va mockato manualmente" |
| `lesson` | Hai imparato una lezione generale | "Sempre testare il fallimento del rate limiter, non solo lo happy path" |
| `tutorial` | Hai una procedura multi-step da documentare | "Come registrare un nuovo server MCP in opencode.json" |
| `faq` | Una domanda che ti sei posto e potrebbe ripetersi | "Perché DuckDuckGo API invece di SearXNG in v1?" |

## Criteri di decisione

Prima di registrare, chiediti:

- [ ] **È riutilizzabile?** — Lo userei in un task futuro?
- [ ] **È specifico?** — Ha dettagli concreti (es. versione, comando, riga)?
- [ ] **È nuovo?** — O è già documentato? (usa `semantic_search` per verificare)
- [ ] **Salva almeno 1 knowledge per sessione** — se hai completato un task, hai sicuramente imparato qualcosa

Se rispondi SÌ ad almeno 2 delle 4 domande → registra.

## Comandi

### Dopo ogni task completato

```typescript
// Template generico
tabularium_tabularium_memory store type=knowledge category=[pattern|tip|pitfall|lesson|tutorial|faq] title="Titolo chiaro" body="Descrizione dettagliata con contesto"
```

### Esempi concreti

```typescript
// pattern
tabularium_tabularium_memory store type=knowledge category=pattern title="Token bucket con refill calcolato" body="Invece di setInterval per refill, calcolare i token al momento del consume() basandosi sul tempo trascorso. Più semplice, testabile, nessun timer in background."

// pitfall  
tabularium_tabularium_memory store type=knowledge category=pitfall title="new Response() non imposta response.url" body="Nei test con mock di fetch, new Response(body, init) restituisce url=''. Nei test che verificano result.url, usare expect(result.url).toBe('') invece dell'URL originale."

// tip
tabularium_tabularium_memory store type=knowledge category=tip title="queueMicrotask per unhandled rejection" body="Nei test con fake timers, se una promise viene rigettata durante advanceTimers, il rejection handler va attaccato PRIMA di avanzare i timer, non dopo. Altrimenti Node.js segnala unhandled rejection."

// lesson
tabularium_tabularium_memory store type=knowledge category=lesson title="Cache MISS vs HIT logging" body="Nel search engine, loggare sempre se una query è MISS o HIT. Aiuta il debugging e dà visibilità sull'efficacia della cache."

// faq
tabularium_tabularium_memory store type=knowledge category=faq title="Perché DuckDuckGo API in v1?" body="Per il primo rilascio di speculum, DuckDuckGo API è stata scelta su SearXNG per: zero setup, zero costi, zero API key, sufficiente per UC1-UC8. SearXNG rimane in roadmap v2."
```

## Workflow consigliato

1. Completa il task principale
2. Aggiorna docs/codex-romanus/progress.md
3. **Carica questa skill**: `skill name=knowledge-harvest`
4. Chiediti: "Cosa ho imparato di riutilizzabile?"
5. Se sì → registra con `tabularium_tabularium_memory store type=knowledge ...`
6. Se no → registra comunque una breve nota (anche "Task X completato senza scoperte particolari" è meglio di niente)

## Nota importante

La knowledge base è il **termometro della salute del team**. 
- 0 knowledge entries per agente = il team non sta imparando
- 1-3 per sessione = sano
- 5+ per sessione = ottimo, ma verifica che non siano duplicati
