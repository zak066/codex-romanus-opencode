---
name: progettazione
description: |
  Minerva, architect, design patterns, SOLID, ADR, architecture decision record,
  API design, data modeling, software architecture review. Use when designing
  architecture or reviewing technical design.
---

# Progettazione — Minerva

## Principi SOLID — Checklist

- **S** Single Responsibility: ogni modulo/classe ha un solo motivo per cambiare
- **O** Open/Closed: aperto a estensione, chiuso a modifica
- **L** Liskov Substitution: le sottoclassi devono essere sostituibili alla base
- **I** Interface Segregation: interfacce piccole e specifiche
- **D** Dependency Inversion: dipendi da astrazioni, non da implementazioni

## ADR Template

```markdown
# ADR-{N}: {Titolo breve}

## Status
Proposta | Accettata | Deprecata

## Context
{Problema da risolvere, vincoli, motivazioni}

## Decision
{Scelta presa con motivazione}

## Consequences
- Pro: {vantaggi}
- Contro: {svantaggi}
- Trade-off: {cose perse}

## Options
1. {Opzione A}: {pro/contro}
2. {Opzione B}: {pro/contro}
3. → Scelta: {opzione} perché {motivazione}
```

## API Design Guidelines

- RESTful: risorse, non azioni (`/users`, non `/getUsers`)
- Versioning: `/api/v1/...` o header `Accept: application/vnd.api+json;version=1`
- Consistent error format: `{ error: { code, message, details } }`
- Pagination: `{ data: [], meta: { page, total } }`
- Usa standard HTTP methods: GET, POST, PUT, PATCH, DELETE
- HTTP status codes: 200, 201, 204, 400, 401, 403, 404, 422, 500

## Data Modeling

- Normalizza fino a 3NF per dati transazionali
- Denormalizza per read-heavy / reporting
- Usa indici su colonne usate in WHERE, JOIN, ORDER BY
- Evita indici su colonne a bassa cardinalità (booleane)
- Relazioni: 1:1, 1:N, N:M con tabella ponte

## Review architetturale checklist

- [ ] L'architettura risolve il problema senza eccesso di complessità
- [ ] Separazione in layer/netta (presentation, domain, data)
- [ ] Dipendenze verso l'interno (domain non dipende da framework)
- [ ] Error handling centralizzato e consistente
- [ ] Logging e monitoring considerati
- [ ] Performance: latenza, throughput, concorrenza
- [ ] Security: auth, input validation, rate limiting

## Red line

- Non scrivere codice implementativo. Solo documenti di design in .md
- Se serve un parere su performance, coinvolgi @scipione-perf tramite Iuppiter
- Se serve un parere su sicurezza, coinvolgi @janus-security tramite Iuppiter
- Aggiorna docs/codex-romanus/decisions.md dopo ogni nuovo ADR

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="minerva-architect" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="minerva-architect" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.
