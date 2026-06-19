---
name: lex-agentium
description: |
  Lex Agentium v1.0 — Protocollo obbligatorio per TUTTI gli agenti Codex Romanus.
  4 fasi: Pre-flight, Execution, Completion, Escalation.
  Carica questa skill all'inizio di OGNI task per attivare il protocollo.
---

# Lex Agentium v1.0 — Codex Romanus

> ⚠️ **REGOLA FERREA**: Questo protocollo è OBBLIGATORIO per ogni task.
> Ignorarlo = violazione registrata in Tabularium = scorecard impattata.
> Carica questa skill PRIMA di iniziare qualsiasi attività.

---

## ▸ FASE 0 — PRE-FLIGHT (prima di qualsiasi azione)

### Sequenza obbligatoria — non saltare passi

```
1. tabularium_agent_status(status="busy", current_task="<verbo + oggetto>")
2. todowrite(todos=[...])                              # se multi-step
3. skill(name="lex-agentium")                          # OBBLIGATORIO: caricare il protocollo
4. skill(name="<skill-pertinente>")                      # se necessario (skill di dominio)
5. tabularium_agent_inbox(agent="<tuo-nome>")           # messaggi in attesa?
6. [se task > 5 min] tabularium_agent_send(channel="#general", content="📋 PRE-FLIGHT...")
```

### ❌ Errori comuni pre-flight

- Iniziare a scrivere codice PRIMA di heartbeat ❌
- Dimenticare todowrite e perdersi a metà ❌
- Ignorare la inbox e perdere comunicazioni urgenti ❌

---

## ▸ FASE 1 — EXECUTION (durante il lavoro)

### Regole d'oro

| # | Regola | Perché |
|---|--------|--------|
| 1 | **Try-catch su ogni tool call** | Errori MCP sono silenziosi |
| 2 | **journal_log dopo ogni modifica file** | Audit trail obbligatorio |
| 3 | **Keep-alive ogni 60s se task > 3 min** | Altrimenti heartbeat scade (timeout 180s) |
| 4 | **Escalation immediata se bloccato** | Non aspettare, non improvvisare |
| 5 | **Leggi prima, poi scrivi. Mai inventare.** | Dati falsi = bug |

### Keep-alive pattern

```json
// Se il task dura più di 3 minuti, ogni 60 secondi:
tabularium_agent_status(agent="<nome>", status="busy")
// current_task viene preservato se non specificato
```

### Journal log pattern

```json
// DOPO ogni fs_write / fs_edit / fs_delete / fs_append
tabularium_journal_log(
  file_path="<path>",
  agent="<nome>",
  change_type="created|modified|deleted",
  summary="<cosa e perché>"
)
```

---

## ▸ FASE 2 — COMPLETION (prima di dichiarare finito)

### Checklist obbligatoria — TUTTI i punti

```
[ ] TypeScript: npx tsc --noEmit → 0 errori
[ ] Test: npx vitest run → tutti pass (se applicabile)
[ ] Entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
[ ] Riga di riepilogo aggiunta in `progress.md` (fs_edit)
[ ] Knowledge harvest: ≥ 1 entry in Tabularium
[ ] Journal: tutte le modifiche registrate
[ ] Metriche: aggiornate (se applicabile)
[ ] Broadcast COMPLETION su #general
[ ] Heartbeat → idle
[ ] Blocchi: nessuno irrisolto
[ ] Step monitorati (se step limit imminente → resume packet preparato con task_id)
```

### Dual-write pattern (progress.md + progress/YYYY-MM-DD.md)

Dopo ogni task, usa il **dual-write pattern**:
1. **SCRIVI** l'entry dettagliata in `progress/YYYY-MM-DD.md` (con `fs_append`)
2. **AGGIUNGI** la riga di riepilogo in `progress.md` (con `fs_edit`)

#### Entry dettagliata (`progress/YYYY-MM-DD.md`)

```markdown
## {YYYY-MM-DD HH:MM} | {agent} | {task} {✅/⚠️/❌}

- **Task**: {descrizione}
- **Durata**: {N} min

### Dettaglio
{2-3 righe}

### File
- Creati: {lista}
- Modificati: {lista}

### Blocchi
{nessuno / descrizione}

### Verifiche
- [✅] TSC | [✅] Test | [✅] HB | [✅] Journal | [✅] KB

### Prossimi passi
{...}
```

### Knowledge harvest pattern

```json
tabularium_tabularium_memory(
  action="store",
  type="knowledge",
  category="pattern|tip|pitfall|lesson|faq",
  title="<titolo chiaro>",
  body="<cosa ho imparato, perché è importante, come applicarlo>",
  source_task_id="<id task se applicabile>",
  tags=["<tag1>", "<tag2>"]
)
```

### Broadcast COMPLETION pattern

```json
tabularium_agent_send(
  channel="#general",
  content="✅ **COMPLETION** — @{agent} ha completato {task} — {esito}"
)
```

---

## ▸ FASE 3 — ESCALATION (se bloccato)

### Trigger — Escalare SUBITO se:

1. ❌ Errore bloccante che non sai risolvere
2. ⚠️ Warning critico che richiede decisione architetturale
3. 🔄 Task ambiguo o specifiche non chiare
4. ⏱ Task stimato > 30 min non pianificato
5. 🔗 Dipendenza bloccante da altro agente

### Procedura

```
1. tabularium_agent_send(channel="#general", content="🚨 ESCALATION...")
2. tabularium_agent_send(channel="iuppiter-orchestrator", content="...dettaglio...")
3. tabularium_agent_status(status="busy", current_task="BLOCKED: <descrizione>")
4. Dual-write: entry dettagliata in `progress/YYYY-MM-DD.md` con ❌ + riga riepilogo in `progress.md`
5. Attendere istruzioni — NON proseguire
```

### ❌ Cosa NON fare in escalation

- Ignorare e proseguire ❌
- Delegare ad altri agenti ❌
- Cancellare tracce dell'errore ❌
- Dichiarare "fatto" senza risolvere ❌

---

## ▸ REGOLE D'ORO (riassunto)

| # | Regola | Gravità |
|---|--------|:-------:|
| 1 | Heartbeat ALL'INIZIO e ALLA FINE di ogni task | 🔴 |
| 2 | Dual-write progress (daily file + indice) per ogni task | 🟡 |
| 3 | Broadcast su #general per ogni completamento | 🟡 |
| 4 | Knowledge harvest: almeno 1 entry per sessione | 🟢 |
| 5 | Journal log per ogni modifica file | 🟡 |
| 6 | Escalation immediata se bloccato | 🔴 |
| 7 | Mai delegare (solo Iuppiter può) | 🔴 |
| 8 | Leggere prima, scrivere dopo. Mai inventare. | 🔴 |
| 9 | TypeScript 0 errori prima di completare | 🟡 |
| 10 | Usare Ianus per file, non bash | 🟡 |

---

## ▸ SANZIONI

| Violazioni consecutive | Conseguenza |
|:----------------------:|-------------|
| 1-2 lievi | Nessuna, ma registrato in metrica |
| 3+ medie in sessione | Iuppiter invia DM warning + skill obbligatoria |
| 1 grave | Incidente creato + alert a Catone |
| 3+ gravi | Review obbligatoria da Catone + notifica a Dominus |

---

## ▸ ESEMPI

### Task semplice (< 5 min) — Fix typo in README

```
✅ Pattern per task brevi:
1. tabularium_agent_status(status="busy", current_task="Fix typo README")
2. fs_edit (o fs_write) → fix typo
3. tabularium_journal_log(change_type="modified", summary="Fix typo riga 23")
4. Dual-write: entry dettagliata in `progress/YYYY-MM-DD.md` + riga in `progress.md`
5. tabularium_agent_status(status="idle")
```

### Task complesso (> 15 min) — Nuovo endpoint API

```
| `tabularium_memory_purge_schedule` | PURGE scheduling (check/register/status) |\n| `tabularium_memory_compact` | COMPACT tool (status/run/estimate) |\n| `tabularium_memory_purge` | Memory purge (dry-run/execute) |
✅ Pattern per task complessi:
1. tabularium_agent_status(status="busy", current_task="Implementare POST /api/users")
2. todowrite(3 passi)
3. Broadcast PRE-FLIGHT su #general
4. [Passo 1] Route + controller → journal_log
5. [Passo 2] Validazione + error handling → journal_log
6. [Passo 3] Test (keep-alive dopo 3 min) → journal_log
7. npx tsc --noEmit → 0 errori
8. npx vitest run → pass
9. Dual-write: entry dettagliata in `progress/YYYY-MM-DD.md` + riga in `progress.md`
10. Knowledge harvest: 1 entry
11. Broadcast COMPLETION su #general
12. tabularium_agent_status(status="idle")
```

---

## ▸ QUICK REFERENCE (da includere in AGENTS.md)

```
## 📜 Lex Agentium — Quick Reference (obbligatorio)
>
> **FASE 0 — PRE-FLIGHT** (prima di iniziare)
> 1. `tabularium_agent_status(status="busy", current_task="<verbo + oggetto>")`
> 2. `todowrite()` se multi-step
> 3. `tabularium_agent_inbox()` — messaggi in attesa?
> 4. Se task > 5 min: broadcast 📋 su #general
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
> - [ ] Entry dettagliata in `progress/YYYY-MM-DD.md`
[ ] Riga di riepilogo in `progress.md`
> - [ ] Knowledge harvest ≥ 1 entry
> - [ ] Journal: tutte le modifiche registrate
> - [ ] Broadcast ✅ COMPLETION su #general
> - [ ] `tabularium_agent_status(status="idle")`
>
> **FASE 3 — ESCALATION** (se bloccato)
> → Broadcast 🚨 + DM a @iuppiter-orchestrator + progress/YYYY-MM-DD.md ❌ (entry dettagliata) + progress.md ❌ (riga riepilogo) + ATTENDI
>
> **Sanzioni**: 1-2 lievi = registrato | 3+ medie = warning + skill obbligatoria | 1 grave = incidente
>
> *Full protocol: docs/codex-romanus/LEX-AGENTIUM.md | Skill: .opencode/skills/lex-agentium/*
```

---

## ▸ ERRORI FREQUENTI (pitfall)

| Errore | Perché è pericoloso | Cosa fare invece |
|--------|---------------------|------------------|
| Iniziare a scrivere codice prima del heartbeat | Nessuno sa che stai lavorando | Heartbeat SEMPRE primo |
| Usare bash per editare file | No backup, no audit trail | Usa Ianus (fs_*) |
| Non fare todowrite per task multi-step | Ci si perde a metà | todowrite all'inizio |
| Ignorare errori MCP e proseguire | Bug silenziosi | Try-catch su ogni tool call |
| Dichiarare completato senza broadcast | Team non sa che hai finito | Broadcast SEMPRE |
| Non fare knowledge harvest | La conoscenza si perde | ≥ 1 entry per sessione |

---

## ▸ DOCUMENTI CORRELATI

| Documento | Link |
|-----------|------|
| Lex Agentium (protocollo completo) | `docs/codex-romanus/LEX-AGENTIUM.md` |
| Planning | `docs/codex-romanus/planning.md` |
| Progress tracking (indice) | `docs/codex-romanus/progress.md` |
| Progress tracking (daily files) | `docs/codex-romanus/progress/YYYY-MM-DD.md` |
| AGENTS.md | `/AGENTS.md` |

### Tool reference

| Tool | Scopo |
|------|-------|
| `tabularium_agent_status` | Heartbeat (busy/idle) |
| `tabularium_agent_send` | Broadcast su canali/DM |
| `tabularium_agent_inbox` | Leggere messaggi DM |
| `tabularium_journal_log` | Registrare modifiche file |
| `tabularium_tabularium_memory` | Knowledge store |
| `ianus-liminalis_fs_*` | Operazioni su file (backup automatico) |
| `tabularium_metrics_store` | Metriche time-series |
| `tabularium_quality_gate_run` | Quality gate |
| `tabularium_decision_lifecycle` | Gestione ADR |
