# Codex Romanus v2.0

> **A multi-agent AI team** for [opencode](https://opencode.ai): 12 agents (6 Roman gods + 6 historical figures) covering the full software development lifecycle — planning, architecture, implementation, frontend, quality, security, performance, DevOps, SEO, testing, and documentation.

I'm neither a fan nor a detractor of AI, but I can't deny that I had fun. The Codex Romanus project was born from an idea based on ancient Rome.


## Quick Summary

| Attribute | Value |
|-----------|-------|
| **Version** | 2.0.0 |
| **License** | MIT |
| **Runtime** | Node.js 22+, opencode Go |
| **Stack** | TypeScript ESM, MCP Protocol (Stdio/SSE) |
| **Team** | 12 agents (1 primary, 11 subagents) |
| **MCP Servers** | 6 (Tabularium, Ianus Liminalis, Speculum, Context7, Imago, Praetorium) |
| **Tests** | 1000+ across all servers |

## The 12 Agents

| # | Agent (@name) | Inspiration | Type | Role | Model |
|---|---------------|-------------|------|------|-------|
| P | `@iuppiter-orchestrator` | Jupiter | God | **Orchestrator** (writes no code) | v4-pro |
| 1 | `@minerva-architect` | Minerva | God | **Architect** — ADR, design review | v4-pro |
| 2 | `@vulcanus-senior-dev` | Vulcan | God | **Senior Developer** — complex impl. | v4-pro |
| 3 | `@catone-quality` | Cato the Censor | Figure | **Quality/Tooling** — lint, toolchain | v4-flash |
| 4 | `@janus-security` | Janus | God | **Security Auditor** — vuln scanning | v4-pro |
| 5 | `@agrippa-devops` | Agrippa | Figure | **DevOps** — CI/CD, Docker, deploy | v4-pro |
| 6 | `@scipione-perf` | Scipio | Figure | **Performance** — profiling, load test | v4-pro |
| 7 | `@ovidio-frontend` | Ovid | Figure | **Frontend Developer** — UI, a11y | v4-flash |
| 8 | `@plinioilvecchio-seo` | Pliny the Elder | Figure | **SEO Specialist** — meta, JSON-LD | v4-flash |
| 9 | `@mercurius-junior-dev` | Mercury | God | **Junior Developer** — simple tasks | v4-flash |
| 10 | `@diana-tester` | Diana | God | **Tester** — unit, integration, e2e | v4-flash |
| 11 | `@tacito-docs` | Tacitus | Figure | **Documenter** — README, API docs | v4-flash |

## MCP Server Ecosystem

Codex Romanus orchestrates 6 MCP servers that provide infrastructure to all agents:

| Server | Purpose | Stack |
|--------|---------|-------|
| **Tabularium** 🏛️ | Governance, memory, metrics, quality | Node.js, SQLite, SSE |
| **Ianus Liminalis** 🚪 | Filesystem with atomic backup | Node.js, 59 tools |
| **Speculum** 🔍 | Web search (no API key) | Node.js, DuckDuckGo |
| **Context7** 📚 | Up-to-date library docs (remote) | Upstash MCP |
| **Imago** 🖼️ | AI image generation via ComfyUI | Node.js, ComfyUI |
| **Praetorium** 📊 | Operational dashboard & model GUI | Next.js 16, React 19 |

## Quick Start

```bash
# 1. Prerequisites
#    - opencode AI editor (https://opencode.ai)
#    - opencode Go subscription (DeepSeek V4 models)
#    - Node.js 22+
#    - Git

# 2. Clone
git clone <repo-url> codex-romanus
cd codex-romanus

# 3. Install server dependencies
cd tabularium > npm install > npm run build > cd ..
cd ianus-liminalis > npm install > npm run build && cd ..
cd imago > npm install > npm run build && cd ..
cd praetorium > npm install > npm run build && cd ..
cd nuntius > npm install > npm run build

or lunch setup-codex.ps1

# 4. Restart opencode to load MCP servers

# 5. Verify
#    Run in opencode: @iuppiter-orchestrator health check

# 6. Praetorium Advisory
#    add Artificial Analysis Api Key in Praetorium .env.local.dev and copy or rename to .env.local
	 cd praetorium > npm install > npm run build > npm start 
```

## Team Presets

Three configurations adapt the team to project size:

| Role | 🟢 Small (6) | 🔵 Medium (9) | 🔴 Large (12) |
|------|:---:|:----:|:----:|
| Orchestrator | ✅ | ✅ | ✅ |
| Architect | — | Minerva | Minerva |
| Senior Dev | Vulcanus | Vulcanus | Vulcanus |
| Security | Janus | Janus | Janus |
| Junior Dev | Mercurius | — | Mercurius |
| Testing | Diana | Diana | Diana |
| Docs | Tacito | Tacito | Tacito |
| Quality | — | Catone | Catone |
| DevOps | — | Agrippa | Agrippa |
| Frontend | — | Ovidio | Ovidio |
| Performance | — | — | Scipione |
| SEO | — | — | Plinio |

Switch with: `.\switch-team.ps1 small` (PowerShell)

## Workflow

The team follows 5 orchestrated phases:

| Phase | Activity | Agents |
|-------|----------|--------|
| **1. Planning** | Requirements, planning.md, ADR | Iuppiter, Minerva |
| **2. Implementation** | Backend, frontend, SEO | Vulcanus, Mercurius, Ovidio, Plinio |
| **3. Quality** | Lint, test, load test, audit | Catone, Diana, Scipione, Janus |
| **4. Deploy + Docs** | CI/CD, deploy, documentation | Agrippa, Tacito |
| **5. Closure** | Verify planning vs progress | Iuppiter, Tabularium |

## Key Governance Rules

1. **Only Iuppiter can delegate** — no subagent invokes another subagent
2. **Iuppiter writes no code** — only planning `.md` and progress files
3. **Lex Agentium** — every agent must load this skill at task start (Phase 0)
4. **Heartbeat required** — `tabularium_agent_status` at start/end of every task
5. **Dual-write progress** — detailed entry in `progress/YYYY-MM-DD.md` + summary in `progress.md`
6. **Knowledge harvest** — at least 1 knowledge entry per session
7. **Journal log** — every file modification via `tabularium_journal_log`
8. **Use Ianus for files** — never bash for file edits (atomic backup + audit trail)
9. **Database safety** — never delete/reset `memory.db` without Dominus authorization

## Learn More

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture & MCP server design |
| [AGENTS.md](docs/AGENTS.md) | Agent roles, Lex Agentium protocol, delegation |
| [MCP-SERVERS.md](docs/MCP-SERVERS.md) | All 6 MCP servers in detail |
| [GETTING-STARTED.md](docs/GETTING-STARTED.md) | Full setup guide |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to contribute |
