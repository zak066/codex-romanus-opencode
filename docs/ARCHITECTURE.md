# Architecture — Codex Romanus

## System Overview

Codex Romanus is a **multi-agent AI team framework** built on the **Model Context Protocol (MCP)**. Agents communicate with each other and with infrastructure servers through a standardized protocol, enabling coordinated software development across the entire lifecycle.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     IUPPITER-ORCHESTRATOR (primary agent)                   │
│                   Plans, delegates, integrates — writes NO code             │
└──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┘
   │  │  │  │  │  │  │  │  │  │  │
 ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐
 │MI│ │VU│ │CA│ │JA│ │AG│ │SC│ │OV│ │PL│ │ME│ │DI│ │TA│
 │AR│ │SD│ │QU│ │SE│ │DE│ │PE│ │FR│ │SE│ │JR│ │TE│ │DO│
 │CH│ │EV│ │AL│ │CU│ │VO│ │RF│ │ON│ │O │ │  │ │ST│ │CS│
 └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘

┌────────────────────────────────────────────────────────────────────────────┐
│                           MCP SERVER ECOSYSTEM                              │
│  🏛️ Tabularium  🚪 Ianus Liminalis  🔍 Speculum  📚 Context7               │
│  🖼️ Imago  📊 Praetorium                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Agent Communication

Agents communicate through **Tabularium's messaging system** (R1, ADR-029):

```
┌─────────────────┐     MCP stdio      ┌──────────────────┐
│  Agent A         │◄─────────────────►│   Tabularium      │
│  (vulcanus, etc) │   tools/call      │   (MCP Server)    │
│                  │   tools/list      │                   │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │    SQLite Database     │
                                    │  (channels, messages,  │
                                    │   agent_heartbeats)    │
                                    └───────────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   SSE Server :3100    │
                                    │  (real-time events)    │
                                    └───────────────────────┘
```

### Communication flows:
- **Tool calls**: Agents invoke MCP tools directly (e.g., `tabularium_agent_send` to message another agent)
- **DM & Channels**: Messages via `#general`, `#architecture`, `#bugs`, `#quality`, `#alerts` or direct DM
- **Heartbeat**: `tabularium_agent_status` updates every agent's status (busy/idle/error) with current task
- **SSE Events**: Real-time push for status changes, new messages, and alerts (port 3100)
- **Escalation**: Blocked agents send 🚨 broadcast to `#general` + DM to `@iuppiter-orchestrator`

## Architectural Patterns

### Lex Agentium Protocol

Mandatory 4-phase protocol every agent follows for every task:

| Phase | Name | Key Actions |
|:-----:|------|-------------|
| **0** | **PRE-FLIGHT** | Heartbeat `busy`, load skill `lex-agentium`, check inbox, broadcast if >5min |
| **1** | **EXECUTION** | Try-catch on every tool call, journal_log after edits, keep-alive every 60s |
| **2** | **COMPLETION** | TSC 0 errors, tests pass, dual-write progress, knowledge harvest, broadcast ✅ |
| **3** | **ESCALATION** | Broadcast 🚨 + DM to Iuppiter + progress ❌ entry + wait |

### MCP² — Memory Compact Protocol

4-phase memory lifecycle for Tabularium's SQLite database:

| Phase | Name | Trigger | Action |
|:-----:|------|---------|--------|
| 0 | **PRIME** | Session start | `warmup_context` + `oracle_predict` + `semantic_search` |
| 1 | **CHECKPOINT** | After each task | Snapshot + `knowledge_suggest` |
| 2 | **COMPACT** | 500+ events or 10+ snapshots | Condense raw events into knowledge entries |
| 3 | **PURGE** | 30 days or DB > 50MB | Condense + DELETE old events + VACUUM |

### 5-Tier Permission Model (Ianus Liminalis)

| Tier | Agents | Allowed Operations |
|:----:|--------|-------------------|
| 🔴 **Core Dev** | vulcanus, catone, agrippa, iuppiter | All (read, write, edit, delete, backup, rollback) |
| 🟡 **Tester/Frontend** | ovidio, plinio, diana | Read, write, edit, delete, search, tree, stat, list, journal |
| 🟢 **Junior/Docs** | mercurius, tacito | Read, write, edit, search, tree, stat, list, journal (no bash) |
| 🔵 **Read-only** | minerva, janus, scipione | Read, search, tree, stat, list, journal |
| 🚫 **Sensitive (deny all)** | * | `.env*`, `credentials*`, `node_modules/**`, `.git/**` |

## Directory Structure

```
codex-romanus/
├── README.md                        # Main docs (this)
├── AGENTS.md                        # Team instructions for AI agents
├── AGENTS.md                        # (in Praetorium — Praetorium-specific rules)
├── opencode.json                    # Active config (default: large team)
├── opencode.{small,medium,large}.json   # Preset team configs
├── .codex-romanus.rc                # Codex Romanus install marker
├── switch-team.ps1                  # Team preset switcher
│
## MCP Servers
├── tabularium/                      # Governance, memory, metrics, quality
│   ├── src/                         # TypeScript source
│   ├── migrations/                  # SQLite migrations (15+)
│   ├── dist/                        # Compiled output
│   └── package.json
│
├── ianus-liminalis/                 # Filesystem with atomic backup
│   ├── src/                         # TypeScript source (59 tools)
│   └── package.json
│
├── speculum/                        # Web search (no API key)
│   ├── src/                         # DuckDuckGo-based search
│   └── package.json
│
├── imago/                           # AI image generation
│   ├── src/                         # ComfyUI integration
│   ├── workflows/                   # Default workflow templates
│   └── package.json
│
## Web UI
├── praetorium/                      # Unified dashboard & model manager
│   ├── src/                         # Next.js 16 App Router
│   └── package.json
│
## Infrastructure
├── packages/fs-backup/              # Shared atomic backup library
├── scripts/                         # Utility scripts
├── templates/                       # Host project integration templates
├── docs/                            # Documentation
│   ├── codex-romanus/               # ADR, planning, progress
│   ├── tabularium/                  # Tabularium API docs
│   ├── ianus-liminalis/             # Ianus documentation
│   ├── eng/                         # English docs (you are here)
│   └── adr/                         # ADR detail files
│
├── .opencode/                       # Agent configs (12) and skills (12)
│   ├── agents/                      # Agent prompt files
│   └── skills/                      # Skill procedures
│
├── .ianus-backups/                  # Automatic Ianus backups
├── .ianus-journal/                  # Filesystem audit trail
└── thesaurus/                       # Idea backlog
```

## Key Design Decisions (ADR)

Codex Romanus uses **Architecture Decision Records** (ADR) to track every significant design choice. Current count: **39+ ADRs**, all stored in Tabularium's SQLite.

| ADR | Decision | Status |
|:---:|----------|:------:|
| 001 | SQLite as embedded database | ✅ Accepted |
| 007 | Tabularium as team memory server | ✅ Accepted |
| 009 | Ianus Liminalis as filesystem MCP | ✅ Accepted |
| 012 | ADR Lifecycle with 4 states + graph | ✅ Accepted |
| 024 | TypeScript ESM + Node 22+ + MCP SDK | ✅ Accepted |
| 029 | Real-time messaging between agents | ✅ Accepted |
| 030 | Knowledge Graph for entity relationships | ✅ Accepted |
| 036 | Memory Compact Protocol (MCP²) | ✅ Accepted |
| 040 | Revival: web search without API key | ✅ Accepted |
| 045 | Praetorium — unified command center | ✅ Accepted |
| 046 | Deprecation of Arae and legacy Dashboard | ✅ Accepted |

## Multi-PC Workflow

The project is designed for Git-based sync across multiple machines:

1. **SQLite WAL issue**: `memory.db` may have uncheckpointed data in `.db-wal`
2. **Solution**: Pre-commit hook (`scripts/checkpoint-db.cjs`) forces WAL → DB transfer
3. **Workflow**: `git pull → work → git commit → git push`
4. **Conflict resolution**: `git checkout --ours/--theirs tabularium/memory.db`
