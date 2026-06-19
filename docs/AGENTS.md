# Agent Guide — Codex Romanus

> Reference documentation for the 12-agent team: roles, protocols, delegation rules, heartbeat system, and sanctions.

## Agent Table

| # | Agent (@name) | Inspiration | Role | Skill | Model | Permission Tier |
|:--:|---------------|-------------|------|-------|-------|:---------------:|
| P | `@iuppiter-orchestrator` | Jupiter | **Orchestrator** (writes no code) | orchestrazione | mimo-v2.5 🧠 | 🔴 Core Dev |
| 1 | `@minerva-architect` | Minerva | **Architect** — ADR, design review | progettazione | v4-flash 🧠 | 🔵 Read-only |
| 2 | `@vulcanus-senior-dev` | Vulcan | **Senior Developer** — complex impl. | realizzazione | v4-flash 🧠 | 🔴 Core Dev |
| 3 | `@catone-quality` | Cato | **Quality/Tooling** — lint, toolchain | censura | v4-flash | 🔴 Core Dev |
| 4 | `@janus-security` | Janus | **Security Auditor** — vuln scanning | vigilanza | v4-flash 🧠 | 🔵 Read-only |
| 5 | `@agrippa-devops` | Agrippa | **DevOps** — CI/CD, Docker, deploy | opere | v4-flash | 🔴 Core Dev |
| 6 | `@scipione-perf` | Scipio | **Performance** — profiling, load testing | tattica | v4-flash 🧠 | 🔵 Read-only |
| 7 | `@ovidio-frontend` | Ovid | **Frontend Developer** — UI, a11y, CSS | arte | v4-flash | 🟡 Tester/Frontend |
| 8 | `@plinioilvecchio-seo` | Pliny the Elder | **SEO Specialist** — meta, JSON-LD | naturalis | v4-flash | 🟡 Tester/Frontend |
| 9 | `@mercurius-junior-dev` | Mercury | **Junior Developer** — simple tasks, CRUD | esecuzione | mimo-v2.5 | 🟢 Junior/Docs |
| 10 | `@diana-tester` | Diana | **Tester** — unit, integration, e2e | verifica | v4-flash | 🟡 Tester/Frontend |
| 11 | `@tacito-docs` | Tacitus | **Documenter** — README, API docs, changelog | annali | v4-flash | 🟢 Junior/Docs |

**Model key**: `🧠` = reasoning variant enabled.

---

## Lex Agentium Protocol

Lex Agentium is a mandatory 4-phase workflow protocol that every agent **must** follow for every task. It ensures visibility, traceability, and quality across the team.

### Phase 0 — Pre-flight (before any action)

Executed in strict order:

| Step | Action | Tool |
|:----:|--------|------|
| 1 | **Heartbeat** — set status to `busy` with current task | `tabularium_agent_status(status="busy")` |
| 2 | **Task breakdown** — create todo list if multi-step | `todowrite()` |
| 3 | **Skill load** — load `lex-agentium` (mandatory) | `skill(name="lex-agentium")` |
| 4 | **Check inbox** — read pending DM messages | `tabularium_agent_inbox()` |
| 5 | **Broadcast** — only if task > 5 minutes | `tabularium_agent_send(channel="#general")` |

### Phase 1 — Execution (during work)

| Rule | Requirement | Severity |
|------|-------------|:--------:|
| Try-catch | Every MCP tool call must be wrapped in try-catch | 🔴 |
| Journal log | Every file modification → `tabularium_journal_log` | 🟡 |
| Keep-alive | Heartbeat every 60s if task > 3 min | 🟡 |
| Escalation | Blocked? → immediate Phase 3 | 🔴 |
| No delegation | Never delegate to another agent | 🔴 |
| Use Ianus | Never use bash for file operations | 🟡 |
| Read first | Always read existing code before writing | 🔴 |

### Phase 2 — Completion (before finishing)

```text
[ ] TypeScript: npx tsc --noEmit → 0 errors
[ ] Tests: npx vitest run → all pass (if applicable)
[ ] Daily progress entry in `progress/YYYY-MM-DD.md`
[ ] Summary line in `progress.md`
[ ] Knowledge harvest: at least 1 entry
[ ] Journal: all modifications logged
[ ] Broadcast ✅ COMPLETION on #general
[ ] Heartbeat → idle
```

### Phase 3 — Escalation (if blocked)

```text
1. Broadcast 🚨 on #general
2. DM to @iuppiter-orchestrator with details
3. Set heartbeat → busy + "BLOCKED: description"
4. Write daily progress entry with ❌
5. Add summary line in progress.md with ❌
6. Wait for instructions — do NOT proceed
```

---

## Heartbeat System

Every agent maintains a heartbeat via `tabularium_agent_status`:

| Parameter | Description |
|-----------|-------------|
| **Start** | `status="busy"` + `current_task="<verb> <object>"` |
| **Keep-alive** | `status="busy"` every 60s (task > 3 min) |
| **End** | `status="idle"` |
| **Timeout** | 180s without heartbeat → marked **offline** |

The Heartbeat Monitor in Tabularium tracks every agent's status in real time. The Praetorium dashboard displays a live status board.

### Iuppiter-specific rule

Iuppiter **must** heartbeat first, before any other tool call:

```json
tabularium_agent_status agent="iuppiter-orchestrator" status="busy" current_task="Planning sprint 12"
```

---

## Delegation Rules

| Rule | Description |
|------|-------------|
| **Only Iuppiter can delegate** | Subagents never invoke other subagents |
| **Iuppiter writes no code** | Only planning `.md` and progress files |
| **Task delegation** | Via `task` tool (e.g., `task(to="vulcanus", ...)`) |
| **Direct delegation** | For complex tasks, Iuppiter breaks down and assigns phases |

### Subagent Routing Table

When Iuppiter delegates, tasks are routed by domain:

| Task Domain | Target Agent | Rationale |
|-------------|:------------:|-----------|
| Architecture, ADR, design review | `@minerva-architect` | Design authority |
| Complex implementation, refactoring | `@vulcanus-senior-dev` | Senior development |
| Lint setup, toolchain, quality gates | `@catone-quality` | Quality enforcement |
| Security audit, vulnerability scan | `@janus-security` | Security expertise |
| CI/CD, Docker, deploy, infrastructure | `@agrippa-devops` | DevOps ownership |
| Profiling, load tests, benchmarks | `@scipione-perf` | Performance optimization |
| UI components, CSS, a11y, responsive | `@ovidio-frontend` | Frontend specialization |
| SEO meta, JSON-LD, structured data | `@plinioilvecchio-seo` | SEO expertise |
| Simple CRUD, utility functions, fixes | `@mercurius-junior-dev` | Junior development |
| Unit, integration, e2e tests | `@diana-tester` | Testing ownership |
| README, API docs, changelog | `@tacito-docs` | Documentation |

---

## Sanctions System

Violations of Lex Agentium are tracked in Tabularium and impact the Quality Scorecard.

| Violations | Consequence |
|:----------:|-------------|
| 1–2 minor | Logged in metrics, no action |
| 3+ medium in a session | Iuppiter sends DM warning + mandatory skill reload |
| 1 severe | Incident created + alert to Catone |
| 3+ severe | Mandatory review by Catone + notification to Dominus |

### Violation Classification

| Level | Examples |
|:-----:|----------|
| 🔴 **Severe** | Skipping heartbeat, delegation by subagent, ignoring escalation, deleting database files |
| 🟡 **Medium** | Missing journal log, skipping progress entry, no broadcast on long task |
| 🟢 **Minor** | Late keep-alive, incomplete task description, missing knowledge harvest |

---

## Team Presets

Three configurations adapt the agent roster to project size:

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

Switch with: `.\switch-team.ps1 small` (PowerShell) on Windows.

---

## Related Documents

| Doc | Description |
|-----|-------------|
| [README.md](README.md) | Project overview |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture |
| [MCP-SERVERS.md](MCP-SERVERS.md) | MCP server reference |
| [GETTING-STARTED.md](GETTING-STARTED.md) | Setup guide |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| `docs/codex-romanus/LEX-AGENTIUM.md` | Full protocol (Italian) |
