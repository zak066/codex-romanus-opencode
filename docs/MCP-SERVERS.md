# MCP Servers Reference — Codex Romanus

> Comprehensive reference for all 6 MCP (Model Context Protocol) servers that provide infrastructure services to the Codex Romanus agent team.

Codex Romanus orchestrates **6 MCP servers** — 5 local (Node.js, stdio) and 1 remote (Upstash SSE). Every agent has access to all tools and resources from these servers.

---

## 1. Tabularium 🏛️ — Governance & Memory

**The central brain** of Codex Romanus. Provides governance, team memory, metrics, quality gates, decision tracking, alerts, incidents, and bug tracking.

- **Stack**: Node.js, SQLite (better-sqlite3), SSE server on port 3100
- **Mode**: Local MCP (stdio)
- **Config**: `mcp.tabularium` in `opencode.json`

### Resources (read-only data)

| URI | Returns |
|-----|---------|
| `tabularium://agents/list` | List of active agents |
| `tabularium://agents/{name}` | Single agent configuration |
| `tabularium://models/available` | Available models (Go and Zen) |
| `tabularium://models/assignments` | Agent → model mapping |
| `tabularium://project/tasks` | Tasks from progress.md |
| `tabularium://project/decisions` | All registered ADRs |
| `tabularium://project/summary` | Project summary |
| `tabularium://project/map` | Project structure map |
| `tabularium://project/meta` | Project metadata |
| `tabularium://project/docs` | Doc freshness analyzer |
| `tabularium://memory/sessions` | Past sessions |
| `tabularium://memory/knowledge` | Knowledge base (lessons, FAQ, patterns) |
| `tabularium://memory/search?q=...` | Full-text and semantic search |
| `tabularium://memory/context` | Current team context |
| `tabularium://decisions/active` | Active (proposed + accepted) ADRs |
| `tabularium://quality/scorecard` | Quality Scorecard A–F |
| `tabularium://journal` | File Change Journal |
| `tabularium://metrics` | Time-series metrics |
| `tabularium://graph/{type}/{id}/neighbors` | Knowledge graph neighbors |
| `tabularium://graph/overview` | Full graph overview |
| `tabularium://agents/status` | Real-time heartbeat status |
| `tabularium://channels/{name}/history` | Channel message history |
| `tabularium://a11y` | A11y Audit Trail (10 WCAG criteria) |
| `tabularium://design` | Design Token Vault (23 Roman Dark tokens) |
| `tabularium://seo/sitemap` | Sitemap XML generator |
| `tabularium://seo/breadcrumb` | BreadcrumbList JSON-LD |
| `tabularium://seo/organization` | Organization JSON-LD |

### Tools (actions)

| Category | Tools |
|----------|-------|
| **Agent** | `tabularium_agent_config`, `tabularium_agent_status`, `tabularium_agent_list_agents`, `tabularium_agent_send`, `tabularium_agent_inbox`, `tabularium_agent_mark_read`, `tabularium_agent_delete_message`, `tabularium_agent_search_messages`, `tabularium_agent_event_history` |
| **Memory** | `tabularium_tabularium_memory` (store/query/snapshot/semantic_search/trend_report/oracle_predict), `tabularium_tabularium_memory_compact`, `tabularium_tabularium_memory_purge`, `tabularium_tabularium_memory_purge_schedule` |
| **Decisions** | `tabularium_decision_lifecycle`, `tabularium_decision_log` |
| **Journal** | `tabularium_journal_log`, `tabularium_journal_query` |
| **Metrics** | `tabularium_metrics_store`, `tabularium_metrics_query`, `tabularium_metrics_trend` |
| **Quality** | `tabularium_quality_gate_run`, `tabularium_quality_gate_stream`, `tabularium_regression_detect` |
| **Alerts** | `tabularium_alert_list`, `tabularium_alert_acknowledge`, `tabularium_alert_resolve`, `tabularium_alert_evaluate` |
| **Incidents** | `tabularium_incident_create`, `tabularium_incident_list`, `tabularium_incident_update` |
| **Bugs** | `tabularium_bug_report`, `tabularium_bug_query`, `tabularium_bug_trend`, `tabularium_bug_update` |
| **Secrets** | `tabularium_secret_scan`, `tabularium_secret_list`, `tabularium_secret_update_status` |
| **SBOM** | `tabularium_sbom_capture`, `tabularium_sbom_diff`, `tabularium_sbom_list` |
| **Channels** | `tabularium_channel_create`, `tabularium_channel_delete`, `tabularium_channel_list` |
| **Knowledge Graph** | `tabularium_graph_add_edge`, `tabularium_graph_query`, `tabularium_graph_get_related`, `tabularium_graph_auto_link`, `tabularium_graph_get_path`, `tabularium_graph_remove_edge` |
| **Utility** | `tabularium_utility` (health/info/cache/validate), `tabularium_db_maintenance`, `tabularium_task_list`, `tabularium_task_scaffold`, `tabularium_cache_warmup`, `tabularium_ianus_ingest`, `tabularium_warmup_context`, `tabularium_generate_changelog`, `tabularium_generate_sitemap`, `tabularium_validate_structured_data` |

### Usage Examples

```json
// Set heartbeat
tabularium_agent_status agent="mercurius-junior-dev" status="busy" current_task="Fix typo in README"

// Log journal entry
tabularium_journal_log file_path="README.md" agent="mercurius" change_type="modified" summary="Fixed typo in line 23"

// Store knowledge
tabularium_tabularium_memory action="store" type="knowledge" category="tip" title="..." body="..."

// Run quality gate
tabularium_quality_gate_run projectPath="."
```

---

## 2. Ianus Liminalis 🚪 — Filesystem Operations

**The filesystem gateway**. Mediates every disk access with atomic backup, audit trail, and a 5-tier permission model. Named after Janus, the god of doorways and transitions.

- **Stack**: Node.js, 59 tools across 10 domains
- **Mode**: Local MCP (stdio)
- **Config**: `mcp.ianus-liminalis` in `opencode.json`

### Tools (59)

| Domain | Tools |
|--------|-------|
| 📂 **Reading** | `fs_read`, `fs_read_multiple`, `fs_search`, `fs_find`, `fs_stat`, `fs_stat_bulk`, `fs_list`, `fs_tree`, `fs_journal`, `diff_files` |
| ✏️ **Writing** | `fs_write`, `fs_edit`, `fs_append`, `fs_delete`, `fs_format`, `fs_undo`, `fs_backup`, `fs_rollback` |
| 📁 **Filesystem** | `fs_mkdir`, `fs_copy`, `fs_move`, `fs_symlink`, `fs_watch`, `fs_watch_exec`, `fs_archive`, `list_allowed_directories`, `fs_tail`, `fs_batch_search_replace` |
| 🔒 **Security** | `fs_lock`, `fs_unlock`, `fs_get_locks`, `fs_secret_scan`, `fs_permission_audit`, `fs_find_sensitive`, `fs_encrypt` |
| ⚡ **Productivity** | `fs_scaffold`, `fs_validate`, `fs_temp_sandbox`, `fs_template_render`, `fs_yaml_merge`, `fs_validate_config` |
| 🚀 **Advanced** | `fs_diff_tree`, `fs_snapshot`, `fs_merge`, `fs_workflow`, `fs_hooks`, `fs_dupe_finder`, `fs_audit_report`, `fs_size_analyzer`, `fs_cache` |
| 🎨 **Frontend** | `fs_css_lint`, `fs_html_lint`, `fs_component_scaffold` |
| 🌐 **SEO** | `fs_meta_scanner`, `fs_sitemap_scanner` |
| 🧪 **Testing** | `fs_test_coverage`, `fs_fixture_loader` |
| 📖 **Documentation** | `fs_doc_scaffold`, `fs_api_doc_extractor` |

### Resources

| URI | Description |
|-----|-------------|
| `ianus://files/{path}` | File content (permission-checked) |
| `ianus://tree/{path}` | Directory structure |
| `ianus://journal` | Last 100 audit trail entries |
| `ianus://stats` | Server statistics (uptime, operations) |

### 5-Tier Permission Model

| Tier | Agents | Allowed Operations |
|:----:|--------|-------------------|
| 🔴 **Core Dev** | vulcanus, catone, agrippa, iuppiter | All (read, write, edit, delete, backup, rollback) |
| 🟡 **Tester/Frontend** | ovidio, plinio, diana | Read, write, edit, delete, search, tree, stat, list, journal |
| 🟢 **Junior/Docs** | mercurius, tacito | Read, write, edit, search, tree, stat, list, journal (no bash) |
| 🔵 **Read-only** | minerva, janus, scipione | Read, search, tree, stat, list, journal |
| 🚫 **Sensitive (deny all)** | * | `.env*`, `credentials*`, `node_modules/**`, `.git/**` |

### Usage Examples

```json
// Read a file
fs_read path="docs/eng/README.md"

// Write a file with automatic backup
fs_write path="src/utils.ts" content="export const greet = (name: string) => `Hello, ${name}!`"

// Edit a file (replace pattern)
fs_edit path="README.md" operation="replace" pattern="v1\.0\.0" content="v2.0.0"

// Search files
fs_search pattern="export function" include="*.ts"
```

---

## 3. Speculum 🔍 — Web Search

**The web search server**. Provides instant web access without requiring any API key. Based on DuckDuckGo Lite HTML.

- **Stack**: Node.js, DuckDuckGo Lite HTML
- **Mode**: Local MCP (stdio)
- **Config**: `mcp.speculum` in `opencode.json`

### Tools

| Tool | Description |
|------|-------------|
| `speculum_speculum_web_search(query, maxResults, region, timeRange)` | DuckDuckGo search, up to 20 results, region/time filters |
| `speculum_speculum_web_fetch(url)` | Fetch and extract content via Mozilla Readability |
| `speculum_speculum_knowledge(query)` | Instant Answer: abstract, infobox, related topics |
| `speculum_speculum_suggest(query)` | Search autocomplete suggestions |

### Usage Examples

```json
// Web search
speculum_speculum_web_search query="opencode MCP server setup" maxResults=5

// Fetch and extract
speculum_speculum_web_fetch url="https://opencode.ai/docs"

// Instant knowledge
speculum_speculum_knowledge query="Model Context Protocol"
```

---

## 4. Context7 📚 — Library Documentation

**Up-to-date documentation** for libraries, APIs, and frameworks. A remote MCP server by Upstash that provides version-specific docs and code examples.

- **Stack**: Upstash MCP (remote)
- **Mode**: Remote MCP (SSE)
- **Config**: `mcp.context7` in `opencode.json`

### Tools

| Tool | Description |
|------|-------------|
| `context7_resolve-library-id(libraryName, query)` | Find the Context7 ID for a library |
| `context7_query-docs(libraryId, query)` | Retrieve documentation + code examples |

### Workflow

```markdown
1. Resolve library ID:
   context7_resolve-library-id(libraryName="Next.js", query="App Router")

2. Query docs:
   context7_query-docs(libraryId="/vercel/next.js", query="How to implement dynamic routes")
```

For version-specific docs, append the version to the library ID:

```
/vercel/next.js/v15.1.8
```

**Rule**: When a task involves external libraries/APIs/frameworks, agents **must** use Context7 before relying on training data.

---

## 5. Imago 🖼️ — AI Image Generation

**The image generation server**. Generates images via ComfyUI with three built-in workflow templates.

- **Stack**: Node.js, ComfyUI
- **Mode**: Local MCP (stdio)
- **Config**: `mcp.imago` in `opencode.json`

### Tools

| Tool | Description |
|------|-------------|
| `imago_generate_image(workflow, params, wait)` | Generate image (txt2img, img2img, or upscale) |
| `imago_regenerate(prompt_id, params, wait)` | Regenerate a previous job with modified params |
| `imago_view_image(asset_id/filename)` | Display WebP thumbnail of a generated image |
| `imago_list_models(type)` | List installed checkpoints, LoRAs, VAEs |
| `imago_get_system_stats()` | ComfyUI system information |
| `imago_get_queue()` | Show current execution queue |
| `imago_get_job_status(prompt_id)` | Check job status |
| `imago_get_defaults()` / `imago_set_defaults(key, value)` | Default configuration |
| `imago_cancel_job(prompt_id)` | Cancel a queued job |

### Usage Example

```json
// Generate image
imago_generate_image workflow="txt2img" params={ "prompt": "Roman forum at sunset, digital art" }

// View result
imago_view_image asset_id="abc123"
```

---

## 6. Praetorium 📊 — Operational Dashboard

**The unified command center**. A web-based dashboard and model manager that displays agent status, metrics, quality scores, and system health in real time.

- **Stack**: Next.js 16, React 19, TypeScript
- **Mode**: Web application (port 3000)
- **Config**: Standalone Next.js app in `praetorium/`

### Features

- **Agent Status Board** — live heartbeat display for all 12 agents
- **Metrics Dashboard** — time-series charts for quality, perf, security, test metrics
- **Quality Scorecard** — A–F scoring with trend history
- **Alert Center** — open alerts, incidents, and vulnerabilities
- **Knowledge Graph Explorer** — visual navigation of entity relationships
- **Model Manager** — model assignments and advisor reports
- **File Change Journal** — browse recent filesystem activity

No MCP tools — Praetorium is a standalone web UI that reads data from Tabularium via SQLite and SSE.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     OPENCODE (Go runtime)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 IUPPITER-ORCHESTRATOR                     │   │
│  │           (primary agent, delegates, writes no code)       │   │
│  └──────────┬──────────┬──────────┬──────────┬──────────────┘   │
│             │          │          │          │                    │
│     ┌───────┴────┐ ┌──┴───┐ ┌───┴────┐ ┌───┴────────┐           │
│     │ 11 Subagents│ │MCP   │ │MCP     │ │MCP Remote  │           │
│     │ (minerva,   │ │Local │ │Local   │ │(Context7)   │           │
│     │  vulcanus…)  │ │stdio │ │stdio   │ │SSE         │           │
│     └────────────┘ └──────┘ └────────┘ └────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────────┐
    │           ┌─────────────┴──────────────┐               │
    │           │     MCP SERVER ECOSYSTEM    │               │
    │           │                             │               │
    │  ┌────────┴────────┐    ┌──────────────┴──────┐        │
    │  │  Tabularium 🏛️   │    │  Ianus Liminalis 🚪  │        │
    │  │  (SQLite :3100)  │    │  (Filesystem, 59     │        │
    │  │                  │    │   tools, backups)     │        │
    │  └─────────────────┘    └──────────────────────┘        │
    │                                                          │
    │  ┌──────────┴────────┐  ┌──────────────┴────────┐      │
    │  │  Speculum 🔍       │  │     Imago 🖼️           │      │
    │  │  (Web Search,      │  │  (ComfyUI, Image Gen)  │      │
    │  │   DuckDuckGo)      │  │                        │      │
    │  └───────────────────┘  └───────────────────────┘      │
    │                                                          │
    │  ┌──────────────────────────┐  ┌──────────────────────┐ │
    │  │    Context7 📚 (Remote)   │  │  Praetorium 📊 WebUI │ │
    │  │  (Upstash MCP, SSE)       │  │  (Next.js 16, :3000)│ │
    │  └──────────────────────────┘  └──────────────────────┘ │
    └──────────────────────────────────────────────────────────┘
```

---

## Related Documents

| Doc | Description |
|-----|-------------|
| [README.md](README.md) | Project overview |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture |
| [AGENTS.md](AGENTS.md) | Agent guide |
| [GETTING-STARTED.md](GETTING-STARTED.md) | Setup guide |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
