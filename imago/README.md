# Imago 🖼️

> Server MCP per generazione immagini AI via ComfyUI.
> *Imago* (lat. immagine, ritratto, fantasma)

## Overview

Imago è un server MCP (Model Context Protocol) che permette ad agenti AI (Claude Code, Cursor, n8n, ecc.) di generare immagini tramite **ComfyUI**. L'architettura **Adapter+Bridge** separa la comunicazione con ComfyUI dalla logica applicativa, garantendo manutenibilità e testabilità.

**Progetto**: Codex Romanus · **ADR base**: ADR-022 (Adapter+Bridge), ADR-023 (Asset Registry), ADR-024 (Workflow Manager), ADR-025 (Tool Design), ADR-026 (Image Handler), ADR-027 (Nome)

## Features

- **11 MCP tools** per esecuzione workflow, generazione immagini e gestione sistema
- **3 template workflow** predefiniti (txt2img, img2img, upscale) con override parametri via `params`
- **Asset Registry** in-memory con TTL (24h default) e LRU eviction per tracciamento output
- **Image Handler** per thumbnail WebP ottimizzate (≤100KB inline per risposte MCP)
- **Polling automatico** (120s timeout) per job asincroni con wait
- **Error handling** strutturato: gerarchia `ImagoError` con 6 subclassi specifiche
- **Logger JSON** su stderr (safe per stdio MCP)

## Quick Start

```bash
# Prerequisiti: Node.js 22+, ComfyUI in esecuzione su http://127.0.0.1:8188

cd imago
cp .env.example .env
npm install
npx tsx src/index.ts
```

Il server si avvia su stdio (transport MCP predefinito) e resta in ascolto per richieste `tools/call` e `tools/list`.

## Configurazione (.env)

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `COMFYUI_URL` | `http://127.0.0.1:8188` | URL dell'istanza ComfyUI |
| `COMFYUI_CLIENT_ID` | `crypto.randomUUID()` | Client ID per connessione WebSocket (auto-generato se vuoto) |

## Architettura

```
┌─────────────────┐      MCP stdio      ┌──────────────────────┐      REST/WS      ┌──────────────┐
│   Agente AI      │◄──────────────────►│     Imago Server      │◄────────────────►│   ComfyUI    │
│ (Claude, Cursor, │                    │   (McpServer + 11     │                  │  (Stable      │
│  n8n, ...)       │                    │    tool handler)      │                  │   Diffusion)  │
└─────────────────┘                     └──────────────────────┘                  └──────────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    │         │         │
                                    ▼         ▼         ▼
                              ┌─────────┐ ┌───────┐ ┌───────────┐
                              │ Workflow│ │ Asset │ │  Image    │
                              │Manager  │ │Registry│ │ Handler   │
                              └─────────┘ └───────┘ └───────────┘
```

**Pattern**: Composition Root — tutte le dipendenze vengono create in `src/index.ts` e iniettate nei tool via `registerAllTools(server, deps)`.

## Struttura

```
imago/
├── src/
│   ├── index.ts                  # Entry point: McpServer + registerAllTools
│   ├── config.ts                 # Caricamento configurazione da env
│   ├── comfyui/
│   │   ├── client.ts             # ComfyClient: 9 metodi HTTP/WS
│   │   └── types.ts              # Interfacce TypeScript API ComfyUI
│   ├── services/
│   │   ├── workflow-manager.ts   # Template workflow (8 metodi, 3 template)
│   │   ├── asset-registry.ts     # Registro asset (dual-index, TTL, LRU)
│   │   └── image-handler.ts      # WebP thumbnails via sharp
│   ├── tools/
│   │   ├── index.ts              # registerAllTools() + ToolDeps
│   │   ├── workflow-execute.ts   # 4 tool: enqueue/get_job_status/get_queue/cancel
│   │   ├── generation.ts         # 3 tool: generate_image/regenerate/view_image
│   │   └── system.ts             # 4 tool: list_models/get_stats/get_defaults/set_defaults
│   └── utils/
│       ├── errors.ts             # ImagoError + 6 subclassi
│       └── logger.ts             # Logger JSON su stderr
├── workflows/
│   ├── txt2img.default.json
│   ├── img2img.default.json
│   └── upscale.default.json
├── tests/
│   ├── unit/                     # 7 file, 147 test
│   └── integration/              # 3 file, 28 test
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

## MCP Tools Reference

### Esecuzione Workflow

| Tool | Input | Output |
|------|-------|--------|
| `enqueue_workflow` | `workflow` (JSON object), `extra_data?`, `client_id?` | `{ prompt_id, status }` |
| `get_job_status` | `prompt_id` (string) | `{ status, progress?, result? }` |
| `get_queue` | — | `{ running[], pending[], queue_size }` |
| `cancel_job` | `prompt_id` (string) | `{ cancelled }` |

### Generazione Immagini

| Tool | Input | Output |
|------|-------|--------|
| `generate_image` | `workflow` (enum: `txt2img\|img2img\|upscale`), `params?`, `wait?` | `{ prompt_id, status, images[] }` |
| `regenerate` | `prompt_id`, `params?`, `wait?` | `{ prompt_id, status, images[] }` |
| `view_image` | `asset_id?` / `filename?`, `subfolder?`, `width?`, `height?`, `quality?` | `{ asset_id, thumbnail }` |

### Sistema

| Tool | Input | Output |
|------|-------|--------|
| `list_models` | `type?` (`checkpoints\|loras\|vae\|controlnet\|embeddings`) | `{ models[] }` |
| `get_system_stats` | — | `{ system, devices, device_count }` |
| `get_defaults` | — | `{ defaults, note }` (placeholder) |
| `set_defaults` | `key`, `value` | `{ updated, message? }` (placeholder) |

## Sviluppo

```bash
# Compilazione TypeScript
npm run build          # tsc --noEmit

# Test
npm test               # vitest run (175 test, 10 suite)
npm run test:unit      # Solo test unitari
npm run test:int       # Solo test integrazione
npm run test:watch     # Modalità watch

# Esecuzione diretta (dev)
npx tsx src/index.ts
```

## Packaging — Versione Portable

Lo script `npm run pack` (equivalente a `node scripts/pack.mjs`) crea una copia autonoma di Imago nella cartella `imago-portable/`, pronta per essere copiata e utilizzata in altri progetti senza dipendere dall'albero di sviluppo.

```bash
npm run pack
```

### Cosa fa

1. **Verifica prerequisiti** — Node.js ≥ 22 e disponibilità del compilatore TypeScript
2. **Build** — Esegue `tsc --noEmit` (se `dist/` è assente o vuoto)
3. **Crea** `imago-portable/` — Pulisce la directory se già esistente
4. **Copia i file** necessari all'esecuzione:

| File/Cartella | Descrizione |
|:-------------|:------------|
| `dist/` | Codice compilato TypeScript |
| `workflows/` | Template workflow predefiniti (txt2img, img2img, upscale) |
| `package.json` | Dipendenze e script del progetto |
| `package-lock.json` | Lockfile delle dipendenze (se presente) |
| `.env.example` | Template configurazione ambiente |
| `README.md` | Questa documentazione |

5. **Genera script di installazione** — `install.bat` (Windows) e `install.sh` (Unix/macOS) per semplificare la configurazione nella destinazione

### Output

```
imago-portable/
├── dist/                    # Codice compilato
├── workflows/               # Template workflow
├── package.json
├── package-lock.json        # (opzionale)
├── .env.example
├── README.md
├── install.bat              # Script installazione Windows
└── install.sh               # Script installazione Unix/macOS
```

### Prerequisiti

- **Node.js ≥ 22** — Necessario per l'esecuzione dello script e del server
- **`npm install` già eseguito** — Il compilatore TypeScript (`tsc`) deve essere disponibile tramite npx

### Come usare la versione portable

```bash
# 1. Copia la cartella nella destinazione
cp -r imago-portable/ /percorso/destinazione/

# 2. Entra nella cartella
cd /percorso/destinazione/imago-portable

# 3. Installa le dipendenze
install.bat              # Windows
# oppure
chmod +x install.sh && ./install.sh   # Unix/macOS

# 4. Configura ambiente
copy .env.example .env   # Windows
cp .env.example .env     # Unix/macOS

# 5. Avvia il server
npm start
```

> **Nota**: La versione portable non include i file di sviluppo (`tests/`, `src/`, `tsconfig.json`, `vitest.config.ts`, `scripts/`) per mantenere la distribuzione leggera. Per lo sviluppo, usa la cartella principale del progetto.


## Test

| Suite | File | Test | Tipo |
|:-----|:----|:----:|:----:|
| ComfyClient | `tests/unit/comfy-client.test.ts` | 20 | Unit |
| AssetRegistry | `tests/unit/asset-registry.test.ts` | 37 | Unit |
| WorkflowManager | `tests/unit/workflow-manager.test.ts` | 34 | Unit |
| Tools WorkflowExecute | `tests/unit/tools-workflow-execute.test.ts` | 16 | Unit |
| Tools System | `tests/unit/tools-system.test.ts` | 8 | Unit |
| Tools Generation | `tests/unit/tools-generation.test.ts` | 12 | Unit |
| ImageHandler | `tests/unit/image-handler.test.ts` | 20 | Unit |
| ComfyClient Integration | `tests/integration/comfy-client.test.ts` | 11 | Integration* |
| WorkflowExecute Integration | `tests/integration/workflow-execute.test.ts` | 12 | Integration* |
| Generation Integration | `tests/integration/generation.test.ts` | 5 | Integration* |
| **Totale** | **10 file** | **175** | |

\* I test di integrazione richiedono un'istanza ComfyUI raggiungibile su `COMFYUI_URL`. Si skipano automaticamente se non disponibile.

**Nessuna regressione** — `tsc --noEmit` : 0 errori.

## Dipendenze

| Pacchetto | Versione | Uso |
|-----------|----------|-----|
| `@modelcontextprotocol/sdk` | ^1.10.0 | Framework MCP server |
| `zod` | ^3.23.0 | Validazione schemi input |
| `ws` | ^8.18.0 | WebSocket per notifiche ComfyUI |
| `sharp` | ^0.33.0 | Elaborazione immagini e WebP |
| `dotenv` | ^17.4.0 | Caricamento variabili ambiente |
| `typescript` (dev) | ^5.7.0 | Compilatore TS |
| `vitest` (dev) | ^3.0.0 | Test runner |

## Licenza

MIT — Codex Romanus Team
