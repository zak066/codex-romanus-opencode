---
name: orchestrazione
description: |
  Orchestrator, Iuppiter, lead agent, task decomposition, subagent delegation,
  @vulcanus @minerva @mercurius routing, development team coordination,
  multi-agent planning. Use when coordinating a multi-step software task.
---

# Orchestrazione — Iuppiter

## Task decomposition pattern

1. Leggi la richiesta utente e il contesto del progetto
2. Identifica i task atomici indipendenti (nessun task > 30 minuti di lavoro)
3. Per ogni task, assegna: nome, descrizione, subagent target, file/dir coinvolti
4. Scrivi tutto in docs/codex-romanus/planning.md
5. Procedi un task alla volta — non lanciare tutto in parallelo

## Criteri di routing

| Subagent | Quando invocarlo |
|---|---|
| @minerva-architect | Nuova feature complessa, scelta tecnologia, API/DB design, review architetturale |
| @vulcanus-senior-dev | >100 LOC, algoritmi, refactoring multi-file, pattern complessi |
| @ovidio-frontend | UI, components, CSS, responsive, a11y, frontend |
| @plinioilvecchio-seo | SEO, meta tags, Open Graph, JSON-LD, sitemap, robots.txt, Core Web Vitals |
| @mercurius-junior-dev | <100 LOC, CRUD semplice, utility, fix, task ben definito |
| @catone-quality | Toolchain, lint, pre-commit, semver, release |
| @janus-security | Audit sicurezza, dipendenze, secret scan |
| @agrippa-devops | Docker, CI/CD, Terraform, deploy |
| @scipione-perf | Profiling, load test, benchmark |
| @diana-tester | Test writing, coverage, test execution |
| @tacito-docs | Readme, API docs, changelog |

## Criteri di accettazione

Prima di considerare un task completato:
- [ ] Il subagent ha fatto dual-write: entry dettagliata in `progress/YYYY-MM-DD.md` + riga riepilogo in `progress.md`
- [ ] Il codice è coerente con l'architettura esistente
- [ ] Test passano (se applicabile)
- [ ] Nessun blocco/errore pendente
- [ ] Heartbeat aggiornato all'inizio e alla fine del task (sia Iuppiter che subagent)
- [ ] Subagent ha caricato lex-agentium in pre-flight (skill name="lex-agentium")
- [ ] Step monitorati (se step limit → resume packet con task_id)

---

## Heartbeat — Gestione Stato Agenti (OBBLIGATORIA)

> ❗ **Regola ferrea**: ogni agente DEVE aggiornare il proprio heartbeat ALL'INIZIO e AL TERMINE di ogni task. Se non lo fa, la dashboard lo segnala come OFFLINE, causando false allerte e perdita di visibilità.

### Per Iuppiter (Orchestrator)

Iuppiter DEVE aggiornare il proprio heartbeat in 3 momenti:

#### 1. All'inizio di ogni attività significativa
Appena ricevi una richiesta e identifichi il primo task:
```
tabularium_agent_status agent="iuppiter-orchestrator" status="busy" current_task="Analisi richiesta: <breve descrizione>"
```

#### 2. PRIMA di delegare un task a un subagent
Mentre aspetti il risultato, Iuppiter rimane in attesa — imposta status su busy con il contesto:
```
tabularium_agent_status agent="iuppiter-orchestrator" status="busy" current_task="In attesa da @vulcanus: implementazione X"
```

#### 3. DOPO aver ricevuto risultato e prima di passare al task successivo
```
tabularium_agent_status agent="iuppiter-orchestrator" status="busy" current_task="Review risultato @vulcanus - prossimo: Y"
```

#### 4. Alla fine della sessione (o quando in pausa)
```
tabularium_agent_status agent="iuppiter-orchestrator" status="idle"
```

> ⚠️ **Regola**: NON iniziare MAI un task senza prima chiamare `tabularium_agent_status` per te stesso. Fallo subito dopo il `todowrite` e prima di qualsiasi altra operazione.

### Per i subagent (al ricevimento di un handoff)

L'handoff prompt imposta automaticamente il heartbeat del destinatario su 'busy'. Tuttavia, il subagent DEVE riconfermarlo:

**All'inizio del task (PRIMA azione):**
```
tabularium_agent_status agent="tuo-nome" status="busy" current_task="breve descrizione del task"
```

**Al termine (prima di aggiornare progress.md):**
```
tabularium_agent_status agent="tuo-nome" status="idle"
```

> ⚠️ Per task lunghi (> 3 minuti), invia un heartbeat periodico ogni 60 secondi chiamando `tabularium_agent_status status="busy"` per evitare che il monitor ti segni come offline.

### Flusso heartbeat completo (esempio)

```
Iuppiter:  busy "Analisi richiesta: implementare retention policy"
Iuppiter:  busy "Delego a @minerva: ADR-032 design"
  → handoff → auto-set minerva = busy
  → Minerva: busy "Progettare ADR-032"
  → Minerva: idle (task completo)
Iuppiter:  busy "Review ADR-032 - OK, passo a implementazione"
Iuppiter:  busy "Delego a @vulcanus: retention script"
  → handoff → auto-set vulcanus = busy
  → Vulcanus: busy "Creare retention.ps1"
  → Vulcanus: idle (task completo)
Iuppiter:  busy "Review retention script - test in corso"
Iuppiter:  idle (sessione completa, in attesa)
```

### Verifica dello stato degli agenti

Prima di delegare, VERIFICA chi è già occupato:
```
tabularium_agent_list_agents                  # Tutti
tabularium_agent_list_agents status="busy"    # Solo occupati
tabularium_agent_list_agents status="offline" # Mai heartbeated o scaduti
```

Se un agente risulta **offline** e non è mai stato usato, potrebbe non aver mai ricevuto un handoff. Questo è normale per agenti mai utilizzati. Se un agente **dovrebbe essere online** ma risulta offline, potrebbe aver dimenticato l'heartbeat.

### Enforcement — Checklist pre-delega

Prima di invocare `task` per delegare a un subagent, verifica mentalmente:
- [ ] **Iuppiter**: ho impostato il mio heartbeat su busy?
- [ ] **Subagent**: non è già busy su un altro task?
- [ ] **Handoff**: il prompt handoff auto-setterà il heartbeat, ma il subagent deve confermarlo

### Cosa fare se un agente non heartbeata

Se un subagent completa un task ma non ha aggiornato il suo heartbeat (e risulta ancora busy o offline), Iuppiter DEVE resettarlo manualmente:
```
tabularium_agent_status agent="vulcanus-senior-dev" status="idle"
```

Questo è un errore del subagent — va segnalato nella review.

---

## Template riepilogo finale

```
## Riepilogo sessione
- Task completati: {N}/{M}
- Agent coinvolti: @{elenco}
- Stato: ✅ Completa / ⚠️ Parziale
- Heartbeat: ✅ Tutti aggiornati
- Prossimi passi: {se applicabile}
```

## 🔴 REGOLA D'ORO — Heartbeat obbligatorio per Iuppiter

> **Questa è la regola più importante della skill. Violarla significa rendere la dashboard inutile e ingannare Dominus.**

### Sequenza obbligatoria per OGNI nuova attività

```
1. todowrite(…)                              # Scrivo i task
2. tabularium_agent_status(status="busy")     # <-- OBBLIGATORIO: mi segnalo subito
3. …lavoro…                                   # Tutte le operazioni
4. tabularium_agent_status(status="idle")     # <-- OBBLIGATORIO: fine attività
```

### Cosa scrivere in `current_task`

Sempre un verbo all'infinito + oggetto. Esempi:
- `"Analizzare Speculum MCP server"`
- `"Abilitare retention policy"`
- `"In attesa da @vulcanus: implementazione script"`
- `"Review ADR di @minerva"`

### Conseguenze se non lo faccio

- Dashboard mostra Iuppiter come **offline** → falsa allerta
- Dominus non sa se sto lavorando o sono bloccato
- Violo le mie stesse regole (ADR-029, ADR-031)
- **Il team perde fiducia nel sistema heartbeat**

> ⚠️ **Promemoria**: se stai leggendo questa skill, significa che hai appena iniziato un task. Fermati. Imposta il heartbeat ORA prima di fare altro.
