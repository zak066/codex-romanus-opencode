---
name: annali
description: |
  Tacito, documentation, docs, README, API docs, JSDoc, TSDoc, changelog,
  Keep a Changelog, markdown, contributing guide, inline documentation.
  Use when writing or updating documentation files.
---

# Annali — Tacito

## Tipi di documentazione

| Tipo | Scopo | File tipico |
|---|---|---|
| README | Panoramica, installazione, usage base | `README.md` |
| API docs | Endpoint, request/response, errori | `docs/api.md` o OpenAPI spec |
| Inline docs | Firma, parametri, eccezioni | Nel codice (JSDoc/TSDoc) |
| Changelog | Novità per ogni versione | `CHANGELOG.md` |
| Contributing | Come contribuire | `CONTRIBUTING.md` |

## README Template

```markdown
# {Nome Progetto} v{version}

[![CI](badge_url)](link) [![Coverage](badge_url)](link)

> {Descrizione in 1-2 righe}

## Installazione

\`\`\`bash
npm install
cp .env.example .env  # configura ambiente
\`\`\`

## Avvio rapido

\`\`\`bash
npm run dev
# Apri http://localhost:3000
\`\`\`

## Scripts

| Comando | Descrizione |
|---|---|
| `npm run dev` | Avvia in sviluppo con hot reload |
| `npm test` | Esegue test suite |
| `npm run build` | Build per produzione |
| `npm run lint` | ESLint check |

## API

### `GET /api/health`
Stato: ✅ | Auth: No
Response: `{ status: "ok", uptime: number }`

## Tech Stack

- Runtime: Node.js 20
- Framework: Express
- Database: PostgreSQL
- Cache: Redis
```

## JSDoc/TSDoc Standard

```typescript
/**
 * Valida email e autentica utente.
 *
 * @param email - Email dell'utente (valida formato)
 * @param password - Password in chiaro (min 8 char)
 * @returns Token JWT valido per 24h
 * @throws {ValidationError} se email o password non validi
 * @throws {AuthError} se credenziali non corrispondono
 */
async function login(email: string, password: string): Promise<string>
```

## CHANGELOG — Keep a Changelog

```markdown
# Changelog

## [1.1.0] — 2026-05-23
### Added
- Endpoint GET /api/profile per profilo utente
- Paginazione su GET /api/users

### Fixed
- Bug timeout su login con token scaduto (#42)
- Errore 500 su input malformato (#40)

### Changed
- Rimosso campo `role` da response registrazione

## [1.0.0] — 2026-05-01
### Added
- Release iniziale: registrazione, login, CRUD utenti
```

## Inline Commenti — Regole

- Commenta il PERCHÉ, non il COSA (il codice dice cosa fa)
- Utility functions complesse: commento di esempio
- Workaround per bug/framework: commento con issue reference
- TODO: sempre con issue number: `// TODO(#123): refactor this`
- Non commentare codice ovvio: `// incrementa contatore` → ❌

## Badge comuni per README

```markdown
[![CI](https://github.com/user/repo/actions/workflows/ci.yml/badge.svg)](https://github.com/user/repo/actions)
[![Coverage](https://codecov.io/gh/user/repo/branch/main/graph/badge.svg)](https://codecov.io/gh/user/repo)
[![npm](https://img.shields.io/npm/v/package.svg)](https://www.npmjs.com/package/package)
```

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="tacito-docs" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="tacito-docs" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni documento creato/aggiornato, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | tacito-docs
- Documento: {file}
- Tipo: creato / aggiornato
- Contenuto: {cosa contiene}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
