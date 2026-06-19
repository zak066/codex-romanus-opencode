# Nuntius — Social Media Publishing MCP Server

> **Nuntius** (lat. *messaggero, annunciatore, portatore di notizie*).
> Un server MCP modulare per pubblicare post su social network tramite AI.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP-SDK-purple)](https://github.com/modelcontextprotocol/typescript-sdk)
[![Node](https://img.shields.io/badge/Node-22+-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Overview

**Nuntius** è un server MCP (Model Context Protocol) che permette a qualsiasi agente AI (Claude Code, Cursor, Windsurf, n8n) di pubblicare contenuti su social network attraverso un'interfaccia unificata.

### Architettura a Plugin

```
MCP Client (Claude Code, Cursor, ...)
       │
       ▼
┌─────────────────────────────────────┐
│         Nuntius MCP Server          │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ MCP Tool │  │ PublishEngine   │  │
│  │ Router   │──│ Rate Limiter    │  │
│  │ (5 tool) │  │ Retry/Backoff   │  │
│  └──────────┘  └───────┬─────────┘  │
│                        │            │
│              ┌─────────▼────────┐   │
│              │  PluginRegistry  │   │
│              └──┬──────────┬────┘   │
│          ┌──────▼──┐  ┌───▼──────┐ │
│          │Facebook │  │Instagram │ │
│          │ Plugin  │  │ Plugin   │ │
│          └─────────┘  └──────────┘ │
└─────────────────────────────────────┘
       │                  │
       ▼                  ▼
  Graph API          Graph API
  (facebook.com)     (instagram.com)
```

Ogni social network è un **plugin** separato che implementa l'interfaccia `SocialPlugin`. Per aggiungere un nuovo social, basta creare una nuova directory in `plugins/` — **zero modifiche al core**.

### Piattaforme Supportate

| Piattaforma | Stato | API | Note |
|-------------|-------|-----|------|
| **Facebook** | ✅ v1.0 | Graph API v22.0 | Post testuali, foto, link |
| **Instagram** | ✅ v1.0 | Graph API v22.0 | Two-step flow, immagini, video, reel |
| LinkedIn | 📋 v2 | — | In roadmap |
| X/Twitter | 📋 v2 | — | In roadmap |

---

## Quick Start

### 1. Installazione

```bash
cd nuntius
npm install
```

### 2. Configurazione

```bash
cp .env.example .env
# Modifica .env con le tue credenziali
```

### 3. Avvio

```bash
npm run build
npm start
```

In sviluppo:
```bash
npm run dev
```

---

## Configuration

| Variabile | Obbligatorio | Default | Descrizione |
|-----------|:-----------:|:-------:|-------------|
| `FACEBOOK_PAGE_ID` | ✅ | — | ID della Pagina Facebook |
| `FACEBOOK_ACCESS_TOKEN` | ✅ | — | Page Access Token (pagine_manage_posts) |
| `FACEBOOK_API_VERSION` | ❌ | `v22.0` | Versione API Graph |
| `INSTAGRAM_USER_ID` | ✅ | — | ID Instagram Business Account |
| `INSTAGRAM_ACCESS_TOKEN` | ✅ | — | Instagram Access Token |
| `INSTAGRAM_PAGE_ID` | ❌ | — | Facebook Page collegata (opzionale) |

I plugin vengono caricati solo se le variabili obbligatorie sono presenti. Se mancano, il plugin viene escluso senza crash.

---

## MCP Tools

| Tool | Descrizione | Input |
|------|-------------|-------|
| `social_publish` | Pubblica un post su uno o più social | `platforms[]`, `text`, `mediaUrls?`, `scheduledAt?`, `platformSpecific?` |
| `social_validate` | Valida un post senza pubblicarlo | `platforms[]`, `text`, `mediaUrls?`, `scheduledAt?`, `platformSpecific?` |
| `social_list_platforms` | Elenca le piattaforme configurate e il loro stato | *(nessuno)* |
| `social_status` | Controlla lo stato di un post pubblicato | `platform`, `externalId` |
| `social_accounts` | Elenca gli account social collegati | *(nessuno)* |

### Esempio: pubblicare un post

```
User: "Pubblica 'Lancio del nuovo prodotto!' su Facebook e Instagram con immagine"

AI: → calls social_publish(platforms: ["facebook", "instagram"],
                          text: "Lancio del nuovo prodotto!",
                          mediaUrls: ["https://example.com/product.jpg"])

    📤 Post published on 2 platform(s):

    [facebook] ID: 123456789_987654321
      Status: published ✅
      URL: https://facebook.com/...

    [instagram] ID: 17898765432109876
      Status: published ✅
      URL: https://instagram.com/p/...
```

---

## Aggiungere un Nuovo Social (es. LinkedIn)

L'architettura a plugin rende l'aggiunta di una nuova piattaforma semplice e pulita:

1. **Crea** `src/plugins/linkedin/index.ts`
2. **Implementa** l'interfaccia `SocialPlugin`:
   - `getPlatformName()` → `"linkedin"`
   - `getRequiredConfig()` → `["LINKEDIN_ACCESS_TOKEN"]`
   - `publishPost()` → chiamata API LinkedIn
   - `getPostStatus()` → stato del post
   - `getMediaConstraints()` → constraints specifici
3. **Aggiungi** le env var al `.env`
4. **Fatto.** Il `PluginRegistry` scopre e carica automaticamente il nuovo plugin.

```typescript
// src/plugins/linkedin/index.ts
import type { SocialPlugin } from '../social-plugin.js';
import type { PostPayload, PublishResult, PostStatusResult, ValidationResult, MediaConstraints } from '../../types.js';

export default class LinkedInPlugin implements SocialPlugin {
  getPlatformName(): string { return 'linkedin'; }
  getRequiredConfig(): string[] { return ['LINKEDIN_ACCESS_TOKEN']; }
  // ... implementazione
}
```

---

## Development

| Comando | Descrizione |
|---------|-------------|
| `npm run dev` | Avvia in sviluppo con hot reload (tsx watch) |
| `npm test` | Esegue test suite (Vitest) |
| `npm run build` | Build TypeScript per produzione |
| `npm start` | Avvia server MCP in produzione |

---

## Architettura

### Stack Tecnologico

| Componente | Scelta |
|-----------|--------|
| Runtime | Node.js 22+ |
| Linguaggio | TypeScript 5.5+ ESM |
| MCP SDK | @modelcontextprotocol/sdk (McpServer) |
| Validazione | Zod 3.23+ |
| HTTP Client | fetch nativo Node.js |
| Testing | Vitest 3+ |
| Rate Limiting | Token Bucket in-memory |

### Struttura Directory

```
nuntius/
├── src/
│   ├── index.ts                   # Entry point MCP server
│   ├── config.ts                  # Config loading da env
│   ├── types.ts                   # Tipi condivisi
│   ├── errors.ts                  # Gerarchia errori
│   ├── engine/
│   │   ├── publish-engine.ts      # Orchestrator
│   │   ├── plugin-registry.ts     # Plugin registry (dynamic import)
│   │   ├── rate-limiter.ts        # Token Bucket rate limiter
│   │   └── validator.ts           # Zod validator
│   ├── plugins/
│   │   ├── social-plugin.ts       # Interfaccia SocialPlugin
│   │   ├── facebook/              # Facebook Graph API
│   │   └── instagram/             # Instagram Graph API
│   └── tools/
│       ├── index.ts               # registerAllTools()
│       ├── publish.ts             # social_publish
│       ├── validate.ts            # social_validate
│       ├── platforms.ts           # social_list_platforms
│       ├── status.ts              # social_status
│       └── accounts.ts            # social_accounts
├── tests/
│   ├── unit/                      # Test unitari (124 test)
│   └── integration/               # Test integrazione
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

---

## Troubleshooting

| Problema | Causa | Soluzione |
|----------|-------|-----------|
| `Plugin X not loaded` | Variabili d'ambiente mancanti | Verifica `.env` contenga tutte le variabili richieste |
| `Rate limit exceeded` | Troppe richieste in finestra temporale | Attendi il reset (Instagram: 25/24h, Facebook: 150/h) |
| `AuthError` | Token scaduto o non valido | Rigenera il token nelle impostazioni Meta Developer |
| Instagram: text-only not supported | IG API non supporta post senza media | Aggiungi almeno un'immagine |

---

## License

MIT — Codex Romanus Team
