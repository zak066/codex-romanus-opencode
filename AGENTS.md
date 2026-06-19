# Codex Romanus — Istruzioni per gli Agenti

## Struttura

Questo progetto utilizza un team ibrido di 12 agenti: 6 divinità romane + 6 figure storiche dell'antica Roma.
L'agente predefinito e @iuppiter-orchestrator.

## Regole di governance

- 🔴 **LEX AGENTIUM**: Ogni agente DEVE caricare la skill `lex-agentium` all'inizio di OGNI task (FASE 0 — PRE-FLIGHT). Usa: `skill name="lex-agentium"`
- Solo Iuppiter puo delegare task ad altri agenti.
- Iuppiter non scrive mai codice sorgente.
- Nessun subagent puo invocare altri subagent.
- Ogni agente deve aggiornare docs/codex-romanus/progress.md dopo ogni step significativo.

- @iuppiter-orchestrator — Orchestrator del team (primary)
- @minerva-architect — Architect
- @vulcanus-senior-dev — Senior Developer
- @catone-quality — Quality/Tooling
- @janus-security — Security Auditor
- @agrippa-devops — DevOps/Infrastructure
- @scipione-perf — Performance Engineer
- @ovidio-frontend — Frontend Developer
- @plinioilvecchio-seo — SEO Specialist
- @mercurius-junior-dev — Junior Developer
- @diana-tester — Tester
- @tacito-docs — Documenter

## Progress tracking

I file docs/codex-romanus/planning.md, docs/codex-romanus/progress.md e docs/codex-romanus/decisions.md
vengono aggiornati da ogni agente durante la sessione.

## MCP del Team

Questo progetto utilizza il **Model Context Protocol (MCP)** con 6 server integrati:

| Server | Scopo |
|--------|-------|
| **Tabularium** | Governance centralizzata, memoria team, qualità, metriche |
| **Ianus Liminalis** | Filesystem con backup atomico e audit trail |
| **Speculum** | Ricerca web senza API key (DuckDuckGo) |
| **Context7** | Documentazione aggiornata librerie (remoto) |
| **Imago** | Generazione immagini AI via ComfyUI (txt2img, img2img, upscale) |

Tutti i tool e le risorse sono automaticamente disponibili all'LLM.

## Tabularium MCP Server

Tabularium è un server MCP che espone dati strutturati e azioni controllate sul progetto.

### Resources (lettura dati)

| URI | Cosa restituisce |
|-----|-----------------|
| `tabularium://agents/list` | Elenco agenti attivi |
| `tabularium://agents/{name}` | Configurazione di un agente |
| `tabularium://models/available` | Modelli disponibili (Go e Zen) |
| `tabularium://models/assignments` | Mappa agente → modello |
| `tabularium://project/tasks` | Task da progress.md |
| `tabularium://project/tasks?status=in_progress` | Solo task in corso |
| `tabularium://project/decisions` | ADR registrate |
| `tabularium://advisory/report` | Consulenza modelli |
| `tabularium://skills/list` | Skill disponibili |
| `tabularium://memory/sessions` | Sessioni passate |
| `tabularium://memory/sessions/{id}` | Dettaglio sessione |
| `tabularium://memory/sessions/{id}/events` | Eventi di una sessione |
| `tabularium://memory/knowledge` | Knowledge base (lezioni, FAQ, pattern) |
| `tabularium://memory/search?q=...` | Ricerca full-text e semantica |
| `tabularium://memory/suggest?context=...` | Suggerimenti automatici |
| `tabularium://memory/context` | Contesto corrente del team |
| `tabularium://decisions` | ADR registrate (elenco completo) |
| `tabularium://decisions/active` | Solo ADR attive (proposed + accepted) |
| `tabularium://decisions/search?q=...` | Ricerca ADR per testo |
| `tabularium://design` | Design Token Vault (23 token Roman Dark) |
| `tabularium://quality/scorecard` | Quality Scorecard A-F (default 7gg) |
| `tabularium://quality/scorecard?days=30` | Scorecard con finestra personalizzata |
| `tabularium://journal` | File Change Journal (ultime entry) |
| `tabularium://metrics` | Metriche time-series |
| `tabularium://seo/sitemap?baseUrl=...&paths=...` | Genera sitemap XML |
| `tabularium://seo/breadcrumb?name=...&url=...` | Genera BreadcrumbList JSON-LD |
| `tabularium://seo/organization?name=...&url=...` | Genera Organization JSON-LD |
| `tabularium://graph/{type}/{id}/neighbors` | Vicini di un nodo nel knowledge graph |
| `tabularium://graph/overview` | Panoramica completa del grafo |
| `tabularium://agents/status` | Stato heartbeat in tempo reale di tutti gli agenti |
| `tabularium://agents/status/{name}` | Heartbeat di un agente specifico |
| `tabularium://agents/{name}/inbox` | Messaggi DM pendenti per un agente |
| `tabularium://channels/{name}/history` | Storico messaggi di un canale |
| `tabularium://a11y` | A11y Audit Trail (10 criteri WCAG) |
| `tabularium://project/map` | Mappa struttura del progetto |
| `tabularium://project/docs` | Doc Freshness Analyzer (score aggiornamento) |
| `tabularium://project/summary` | Riepilogo generale del progetto |
| `tabularium://project/meta` | Metadati progetto |

Usa `resources/read` per leggere le risorse.
Esempio: `read_resource("tabularium://agents/list")`

### Tools (azioni) — Nomi REALI dei tool MCP

| Tool | Cosa fa |
|------|---------|
| `tabularium_agent_config` | Gestisce configurazione agenti in opencode.json |
| `tabularium_agent_status` | Heartbeat: imposta busy/idle + current_task |
| `tabularium_agent_list_agents` | Elenca agenti con stato heartbeat |
| `tabularium_agent_send` | Invia messaggio a canale o DM |
| `tabularium_agent_delete_message` | Cancella un messaggio (solo dal mittente) |
| `tabularium_agent_event_history` | Storico eventi con filtri per tipo/agente/canale |
| `tabularium_agent_inbox` | Legge messaggi in arrivo |
| `tabularium_agent_mark_read` | Segna un messaggio DM come letto |
| `tabularium_agent_search_messages` | Ricerca full-text nei messaggi (FTS5) |
| `tabularium_decision_lifecycle` | Registra/accetta/depreca ADR |
| `tabularium_decision_log` | Consulta registro ADR |
| `tabularium_tabularium_memory` | Memoria team: store, query, snapshot, knowledge_suggest, semantic_search, link_decisions, trend_report, oracle_predict |
| `tabularium_tabularium_memory_compact` | Condensa eventi recenti in knowledge con safe guards |
| `tabularium_tabularium_memory_purge` | Elimina eventi raw storici con condenser automatico |
| `tabularium_tabularium_memory_purge_schedule` | Gestisce scheduling PURGE periodico |
| `tabularium_journal_log` | Registra modifica file nel journal |
| `tabularium_journal_query` | Interroga il file change journal |
| `tabularium_metrics_store` | Salva metrica time-series |
| `tabularium_metrics_query` | Query metriche con aggregazioni |
| `tabularium_metrics_trend` | Trend metriche su finestra temporale |
| `tabularium_quality_gate_run` | Esegue quality gate (lint→TSC→test→coverage→audit) |
| `tabularium_regression_detect` | Rileva regressioni su metriche |
| `tabularium_skill_manager` | Elenca/verifica/legge skill degli agenti |
| `tabularium_task_list` | Elenca/filtra task del progetto |
| `tabularium_task_scaffold` | Genera scaffolding da template |
| `tabularium_utility` | Health check, info sistema, cache, validazione |
| `tabularium_db_maintenance` | Manutenzione SQLite (check, vacuum, checkpoint, FTS rebuild) |
| `tabularium_ianus_ingest` | Importa journal Ianus in Tabularium |
| `tabularium_graph_add_edge` | Aggiunge relazione nel knowledge graph |
| `tabularium_graph_query` | Navica il knowledge graph (BFS/DFS) |
| `tabularium_graph_get_related` | Entità correlate nel grafo |
| `tabularium_graph_auto_link` | Auto-link entità per similarità |
| `tabularium_graph_get_path` | Shortest path tra due entità |
| `tabularium_graph_remove_edge` | Rimuove relazione dal grafo |
| `tabularium_alert_list` | Elenca alert (quality/perf/security) |
| `tabularium_alert_acknowledge` | Prende in carico un alert |
| `tabularium_alert_resolve` | Risolve un alert |
| `tabularium_incident_create` | Registra incidente |
| `tabularium_incident_list` | Elenca incidenti |
| `tabularium_incident_update` | Mitiga o risolve incidente |
| `tabularium_bug_report` | Registra bug nel tracker |
| `tabularium_bug_query` | Interroga bug con filtri |
| `tabularium_bug_trend` | Analisi trend bug |
| `tabularium_cache_warmup` | Gestisce preriscaldamento cache |
| `tabularium_secret_scan` | Scansiona directory per segreti hardcodati |
| `tabularium_secret_list` | Elenca segreti trovati |
| `tabularium_secret_update_status` | Aggiorna stato finding segreto |
| `tabularium_sbom_capture` | Cattura snapshot dipendenze (SBOM) |
| `tabularium_sbom_diff` | Confronta due snapshot SBOM |
| `tabularium_sbom_list` | Elenca snapshot SBOM |
| `tabularium_channel_create` | Crea canale di comunicazione |
| `tabularium_channel_delete` | Elimina canale (non default) |
| `tabularium_channel_list` | Elenca canali |
| `tabularium_generate_changelog` | Genera CHANGELOG.md dagli eventi |
| `tabularium_generate_sitemap` | Genera sitemap.xml |
| `tabularium_validate_structured_data` | Valida JSON-LD strutturato |
| `tabularium_warmup_context` | Genera contesto pre-riscaldato |



I tool si invocano direttamente per nome (es. `tabularium_agent_status`), non con `call_tool()`.
### Prompts

| Prompt | Quando usarlo | Argomenti |
|--------|--------------|-----------|
| `session_start` | Contesto iniziale sessione: agenti attivi, task pendenti, stato progetto, warm-up context | agent, warmup_context, generate_warmup |
| `agent_handoff` | Passaggio task tra agenti: task completati, contesto, heartbeat, Oracle | from_agent, to_agent |
| `code_review` | Revisione strutturata: checklist security/style/architecture, ADR, validazione | agent, scope |
| `progress_report` | Report avanzamento: stato task, decisioni recenti, metriche per agente | period |

Usa `get_prompt("nome_prompt", { ...argomenti })` per caricare i prompt.

## Ianus Liminalis — Filesystem MCP Server

**Ianus Liminalis** è il server MCP per operazioni sul filesystem del progetto. Ispirato a Giano (dio delle soglie), media ogni accesso al disco con **backup atomico**, **audit trail** e **permission model a 5 tier**.

### Tool MCP (59)

| Dominio | Tool |
|---------|------|
| 📂 **Lettura** | `fs_read`, `fs_read_multiple`, `fs_search`, `fs_find`, `fs_stat`, `fs_stat_bulk`, `fs_list`, `fs_tree`, `fs_journal`, `diff_files` |
| ✏️ **Scrittura** | `fs_write`, `fs_edit`, `fs_append`, `fs_delete`, `fs_format`, `fs_undo`, `fs_backup`, `fs_rollback` |
| 📁 **Filesystem** | `fs_mkdir`, `fs_copy`, `fs_move`, `fs_symlink`, `fs_watch`, `fs_watch_exec`, `fs_archive`, `list_allowed_directories`, `fs_tail`, `fs_batch_search_replace` |
| 🔒 **Sicurezza** | `fs_lock`, `fs_unlock`, `fs_get_locks`, `fs_secret_scan`, `fs_permission_audit`, `fs_find_sensitive`, `fs_encrypt` |
| ⚡ **Produttività** | `fs_scaffold`, `fs_validate`, `fs_temp_sandbox`, `fs_template_render`, `fs_yaml_merge`, `fs_validate_config` |
| 🚀 **Avanzati** | `fs_diff_tree`, `fs_snapshot`, `fs_merge`, `fs_workflow`, `fs_hooks`, `fs_dupe_finder`, `fs_audit_report`, `fs_size_analyzer`, `fs_cache` |
| 🎨 **Frontend** | `fs_css_lint`, `fs_html_lint`, `fs_component_scaffold` |
| 🌐 **SEO** | `fs_meta_scanner`, `fs_sitemap_scanner` |
| 🧪 **Testing** | `fs_test_coverage`, `fs_fixture_loader` |
| 📖 **Documentazione** | `fs_doc_scaffold`, `fs_api_doc_extractor` |

### Resources MCP

| URI | Descrizione |
|-----|-------------|
| `ianus://files/{path}` | Contenuto file (permission-checked) |
| `ianus://tree/{path}` | Struttura directory |
| `ianus://journal` | Ultime 100 entry audit trail |
| `ianus://stats` | Statistiche server (uptime, operazioni) |

### Permission Model (5 tier)

| Tier | Agenti | Operazioni |
|------|--------|------------|
| 🔴 **Core Dev** | vulcanus, catone, agrippa, iuppiter | Tutte (read, write, edit, delete, backup, rollback) |
| 🟡 **Tester/Frontend** | ovidio, plinio, diana | Read, write, edit, delete, search, tree, stat, list, journal |
| 🟢 **Junior/Docs** | mercurius, tacito | Read, write, edit, search, tree, stat, list, journal |
| 🔵 **Read-only** | janus, scipione, minerva | Read, search, tree, stat, list, journal |

### Principio

**Usa Ianus per tutte le operazioni su file** invece di bash: ogni modifica è tracciata nel journal e protetta da backup automatico. La sezione `Ianus Liminalis — Filesystem Operations` nel prompt di ogni agente elenca i tool specifici per il suo ruolo.

## Strumenti Built-in (sempre disponibili)

Questi strumenti sono forniti dall'ambiente OpenCode e sono sempre accessibili a tutti gli agenti:

| Strumento | Cosa fa |
|-----------|---------|
| `bash` | Esegue comandi shell (PowerShell/cmd). Preferisci Ianus per operazioni file |
| `read` | Legge file e directory con offset/limit |
| `glob` | Cerca file per pattern (es. `**/*.ts`) |
| `grep` | Cerca pattern regex nel contenuto dei file |
| `websearch` | Ricerca web con crawling automatico. Supporta modalità live-crawl e deep search |
| `webfetch` | Recupera contenuto da URL remoto |
| `question` | Interagisce con l'utente per chiarimenti |
| `skill` | Carica skill specializzata |
| `todowrite` | Task tracking per la sessione corrente |
| `task` | Avvia subagent specializzato |
| `tokenscope` | Analisi consumo token della sessione corrente (plugin) |

> **Nota**: `read`, `edit`, `write`, `glob`, `grep` sono comodi per letture rapide, ma per scritture/modifiche/eliminazioni usa sempre Ianus Liminalis (`ianus-liminalis_fs_*`) che garantisce backup atomico e audit trail.

## Speculum — Ricerca Web integrata

**Speculum** è il server MCP per ricerche web e knowledge instant. Non richiede API key e fornisce 4 tool per accesso rapido a informazioni pubbliche.

### Tool disponibili

| Tool | Cosa fa |
|------|---------|
| `speculum_speculum_web_search(query, maxResults, region, timeRange)` | Ricerca web su DuckDuckGo Lite HTML. Fino a 20 risultati, filtri per regione e periodo |
| `speculum_speculum_web_fetch(url)` | Recupera contenuto web e lo estrae in formato leggibile (Mozilla Readability) |
| `speculum_speculum_knowledge(query)` | Instant Answer: abstract, infobox, related topics da Wikipedia/DuckDuckGo |
| `speculum_speculum_suggest(query)` | Autocomplete suggerimenti di ricerca |

### Configurazione

Definito come MCP locale in `opencode.json` (`mcp.speculum`). Il server è in `speculum/`.


## Context7 — Documentazione aggiornata librerie

Context7 è un MCP server remoto (Upstash) per documentazione **aggiornata e version-specifica** di librerie/API/framework. È configurato in `mcp.context7` in `opencode.json` come server remoto (`type: "remote"`, `url: "https://mcp.context7.com/mcp"`).

**Regola ferrea**: Quando la richiesta coinvolge librerie, API, framework o tool esterni, gli agenti DEVONO usare Context7 PRIMA di rispondere. Non affidarti al training data — le API cambiano.



### Tool disponibili

| Tool | Cosa fa |
|------|---------|
| `context7_resolve-library-id(libraryName, query)` | Trova l'ID Context7 di una libreria |
| `context7_query-docs(libraryId, query)` | Recupera documentazione + esempi di codice |

### Flusso d'uso

> > ## 📜 Lex Agentium — Quick Reference (obbligatorio)
>
> **FASE 0 — PRE-FLIGHT** (prima di iniziare)
> 1. `skill(name="lex-agentium")` — OBBLIGATORIO
> 2. `tabularium_agent_status(status="busy", current_task="<verbo + oggetto>")`
> 3. `todowrite()` se multi-step
> 4. `tabularium_agent_inbox()` — messaggi in attesa?
> 5. Se task > 5 min: broadcast 📋 su #general
>
> **FASE 1 — EXECUTION** (durante il lavoro)
> - Try-catch su ogni tool call
> - `tabularium_journal_log` dopo ogni modifica file
> - Keep-alive heartbeat ogni 60s se task > 3 min
> - Bloccato? → ESCALATION, non proseguire
>
> **FASE 2 — COMPLETION** (prima di finire)

> - [ ] `npx tsc --noEmit` → 0 errori
> - [ ] Test pass (se presenti)
> - [ ] Entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
> - [ ] Riga di riepilogo in `progress.md` (fs_edit)
> - [ ] Knowledge harvest ≥ 1 entry
> - [ ] Journal: tutte le modifiche registrate
> - [ ] Step monitorati (se step limit → resume packet con task_id)
>
> **FASE 3 — ESCALATION** (se bloccato)
> → Broadcast 🚨 + DM a @iuppiter-orchestrator + progress/YYYY-MM-DD.md ❌ (entry)
>   + progress.md ❌ (riga riepilogo) + ATTENDI
>
> **Sanzioni**: 3+ medie = warning + skill obbligatoria | 1 grave = incidente
>
> *Full protocol: docs/codex-romanus/LEX-AGENTIUM.md | Skill: .opencode/skills/lex-agentium/*
1. Chiama `context7_resolve-library-id` con il nome della libreria (es. "Next.js", "React", "Prisma")
2. Usa l'ID restituito (es. `/vercel/next.js`) per chiamare `context7_query-docs` con la domanda specifica

### Esempio

```markdown
context7_resolve-library-id(libraryName="Next.js", query="App Router dynamic routes")
→ /vercel/next.js

context7_query-docs(libraryId="/vercel/next.js", query="How to implement dynamic routes")
→ Documentazione ufficiale + esempi di codice pronti all'uso
```

### Versione specifica

Aggiungi la versione nel library ID per documentazione version-specifica: `/vercel/next.js/v15.1.8`

## Imago — Generazione immagini AI

**Imago** è il server MCP per generazione immagini AI via ComfyUI. Supporta 3 workflow predefiniti: txt2img, img2img e upscale.

### Tool disponibili

| Tool | Cosa fa |
|------|---------|
| `imago_generate_image(workflow, params, wait)` | Genera immagine: txt2img, img2img o upscale |
| `imago_regenerate(prompt_id, params, wait)` | Rigenera da job precedente con parametri modificati |
| `imago_view_image(asset_id/filename)` | Mostra thumbnail WebP di un'immagine generata |
| `imago_list_models(type)` | Elenca modelli/checkpoints installati |
| `imago_get_system_stats()` | Info sistema ComfyUI (OS, Python, GPU, VRAM) |
| `imago_get_queue()` | Mostra coda di esecuzione attuale |
| `imago_get_job_status(prompt_id)` | Stato di un job in coda |
| `imago_get_defaults()` / `imago_set_defaults(key, value)` | Configurazione predefinita |
| `imago_cancel_job(prompt_id)` | Cancella job dalla coda |

## Principi Generali

1. **Usa Tabularium** per leggere e scrivere dati del progetto — preferisci i suoi tool ai comandi shell generici.
2. **Non modificare file manualmente** quando esiste un tool Tabularium per farlo (es. usa `tabularium_agent_config` invece di editare `opencode.json` a mano).
3. **Validazione automatica**: prima di ogni modifica importante, esegui `tabularium_utility` (action=validate) o `tabularium_quality_gate_run`.
4. **Memoria del team**: Tabularium persiste automaticamente sessioni, eventi e decisioni. Usa `tabularium://memory/*` per consultare lo storico e `tabularium_tabularium_memory` per salvare contesto.
5. **Backup**: Tabularium crea backup automatici prima di ogni scrittura. Non disabilitarli.
6. **Database safety**: MAI cancellare, resettare, ricreare o modificare il **file fisico** `memory.db` (o qualsiasi file `.db`) sul disco senza autorizzazione esplicita dell'utente (Dominus). Fermati e chiedi sempre prima di procedere. La perdita del database cancella dati storici irreversibili. Questa regola vale SOLO per il file fisico — le normali operazioni CRUD via tool MCP di Tabularium (decision_lifecycle, memory store, metrics, ecc.) sono consentite senza richiedere autorizzazione.
7. **AGENTS.md**: questo file è portatile. Copialo in nuovi progetti per avere il team Codex Romanus pronto all'uso.
8. **Integrazione progetto ospitante**: `arae/` e `tabularium/` sono tool esterni, non codice del progetto. Usa i template in `templates/host-*.json` per escluderli da TypeScript, ESLint e VS Code. Il file `.codex-romanus.rc` contiene i metadati di installazione. Vedi [README.md#integrazione](README.md#-integrazione-in-un-progetto-esistente).

## 🔴 Iuppiter — Heartbeat Obbligatorio

**Regola ferrea**: all'inizio di OGNI attività, PRIMA di qualsiasi tool call, Iuppiter DEVE eseguire:

```json
tabularium_agent_status agent="iuppiter-orchestrator" status="busy" current_task="<cosa stai facendo>"
```

Alla fine di ogni attività:
```json
tabularium_agent_status agent="iuppiter-orchestrator" status="idle"
```

Se non lo fai, la dashboard mostra "offline" e Dominus non vede cosa stai facendo.
Mantieni `current_task` sempre popolato mentre lavori.
