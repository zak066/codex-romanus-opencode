---
name: realizzazione
description: |
  Vulcanus, senior developer, implementation, refactoring, code optimization,
  error handling, logging, design patterns. Use when implementing complex
  features or refactoring existing code.
---

# Realizzazione — Vulcanus

## Refactoring Pattern — Quando e Come

| Pattern | Sintomo | Azione |
|---|---|---|
| Extract Method | Funzione >30 righe | Estrai blocchi in funzioni nominate |
| Replace Conditional with Polymorphism | if/else/switch su tipo | Strategy pattern |
| Introduce Parameter Object | >3 parametri | Oggetto parametro |
| Extract Class | Classe fa troppe cose | Dividi in classi specializzate |
| Replace Magic Number | Numeri hardcoded | Costanti con nome |
| Encapsulate Field | Campi pubblici | Getter/setter |
| Remove Duplicate | Stesso codice in N posti | Fattorizza in utility |

## Error Handling Strategy

```javascript
// Fall fast — programmazione
if (!user) throw new AppError('USER_NOT_FOUND', 404);

// Graceful — operativo
try {
  await sendEmail(user, payload);
} catch (err) {
  logger.error({ err, userId: user.id }, 'Email fallita');
  // Non bloccare il flusso principale
}
```

- Usa errori custom tipizzati, mai stringhe o numeri
- Logga sempre con contesto (userId, requestId, action)
- Non silenziare errori con catch vuoti
- Middleware centralizzato per errori HTTP

## Performance Pattern

- **Lazy loading**: carica solo ciò che serve ora
- **Caching**: memorizza risultati costosi (TTL appropriato)
- **Batch processing**: riduci chiamate N+1 con batch query
- **Connection pool**: riusa connessioni DB
- **Async**: operazioni I/O non bloccanti
- **Evita**: loop annidati, closure inutili in hot path, reflection in loop

## Logging Best Practice

```javascript
logger.info({ action: 'user.login', userId, ip }, 'Login effettuato');
logger.error({ err, action: 'user.login' }, 'Login fallito');
```

- Log strutturato (JSON), non stringhe
- Livelli: error, warn, info, debug
- Mai loggare dati sensibili (password, token, PII)
- Includi sempre: action, userId (se applicabile), duration (se applicabile)

## Quando coinvolgere altri (via Iuppiter)

- Dubbi architetturali → richiedi @minerva-architect
- Dubbi di sicurezza → richiedi @janus-security
- Dubbi di performance → richiedi @scipione-perf
- Task che richiedono UI/Frontend → richiedi @ovidio-frontend

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="vulcanus-senior-dev" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="vulcanus-senior-dev" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni task completato, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry dettagliata (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | vulcanus-senior-dev
- Implementato: {descrizione}
- File modificati: {elenco}
- Test: {passano|da fare}
- Bloccante: {sì|no}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
