/**
 * prompts/session-start.prompt.ts
 * Prompt MCP per l'avvio di una sessione di lavoro.
 * Fornisce il contesto iniziale, i task pendenti e lo stato degli agenti.
 * Include knowledge pertinenti per l'agente in avvio, se disponibili.
 * Supporta warm-up context opzionale (FABRICA — Fase 7.5).
 */

import type { PromptHandler, PromptResult } from '../types/mcp.js';
import type { WarmupContext } from '../core/warmup-engine.js';
import { parseProgress } from '../core/progress-parser.js';
import { getPrimaryAgent, getAllAgents } from '../core/agent-reader.js';

export const sessionStartHandler: PromptHandler = {
  name: 'session_start',
  description:
    'Prompt di avvio sessione. Fornisce contesto iniziale: agenti attivi, task pendenti, stato del progetto e warm-up context opzionale.',
  arguments: [
    {
      name: 'agent',
      description: "Nome dell'agente che avvia la sessione (opzionale)",
      required: false,
    },
    {
      name: 'warmup_context',
      description: 'Contesto pre-riscaldato in formato JSON (opzionale, generato da warmup_context tool)',
      required: false,
    },
    {
      name: 'generate_warmup',
      description: 'Se "true", genera automaticamente il warmup context all\'avvio',
      required: false,
    },
  ],

  handler: async (args?: Record<string, string>): Promise<PromptResult> => {
    const agentName = args?.agent ?? 'unknown';
    const primary = await getPrimaryAgent();
    const taskList = await parseProgress();
    const agents = await getAllAgents();
    const pendingTasks = taskList.tasks.filter((t) => t.status === 'pending');
    const inProgressTasks = taskList.tasks.filter((t) => t.status === 'in_progress');

    // Carica knowledge pertinenti per l'agente (try/catch per graceful fallback)
    let knowledgeLines: string[] = [];
    try {
      const { suggestKnowledgeForAgent } = await import('../core/knowledge-manager.js');
      const knowledge = suggestKnowledgeForAgent(agentName, 3);
      if (knowledge.length > 0) {
        knowledgeLines = [
          ``,
          `## Knowledge base — Suggerimenti per ${agentName}`,
          ...knowledge.map(
            (k) =>
              `- [${k.category}] **${k.title}** (score: ${k.relevance_score})${
                k.tags && k.tags.length > 0 ? ` [${k.tags.join(', ')}]` : ''
              }`
          ),
        ];
      }
    } catch {
      // Knowledge base non disponibile o vuota — procedi senza
    }

    // Carica decisioni simili per contesto (try/catch per graceful fallback)
    let similarDecisionsLines: string[] = [];
    try {
      const { semanticSearch } = await import('../core/semantic-search.js');
      const focus = agentName !== 'unknown' ? agentName : 'codex-romanus';
      const similarDecisions = await semanticSearch(focus, 'decision', 3);
      if (similarDecisions.length > 0) {
        similarDecisionsLines = [
          ``,
          `### Decisioni Simili`,
          `Decisioni correlate al contesto corrente di **${agentName}**:`,
          ...similarDecisions.map(
            (d) => `- **${d.snippet.substring(0, 120)}** (score: ${d.score.toFixed(3)})`
          ),
        ];
      }
    } catch {
      // Ricerca semantica non disponibile — procedi senza decisioni simili
    }

    // Carica insights dall'Oracolo (try/catch per graceful fallback)
    let oracleLines: string[] = [];
    try {
      const { analyzeAgentProductivity, analyzeErrorTrends } = await import('../core/trend-analyzer.js');
      const agentProd = analyzeAgentProductivity().find((a) => a.agent === agentName);
      const errorTrends = analyzeErrorTrends().slice(0, 3);

      if (agentProd || errorTrends.length > 0) {
        const parts: string[] = [``, `## Oracle Insights`];

        if (agentProd) {
          parts.push(
            `- **Produttività**: ${agentProd.tasksCompleted} task completati, ${agentProd.decisionsMade} decisioni, ${agentProd.sessionsCount} sessioni`,
            `- **Ora più attiva**: ${agentProd.mostActiveHour}:00`,
            `- **Knowledge contribuite**: ${agentProd.knowledgeContributed}`
          );
        }

        if (errorTrends.length > 0) {
          parts.push(`- **Trend errori**:`);
          for (const err of errorTrends) {
            const icon = err.trending === 'increasing' ? '🔺' : err.trending === 'decreasing' ? '✅' : '➡️';
            parts.push(`  - ${icon} "${err.pattern.substring(0, 80)}" (×${err.occurrences}, ${err.trending})`);
          }
        }

        oracleLines = parts;
      }
    } catch {
      // Oracolo non disponibile — procedi senza insights
    }

    // Warm-up Context: da argomento JSON o generazione automatica
    let warmupContext: WarmupContext | null = null;

    // Se generate_warmup === "true", genera automaticamente
    if (args?.generate_warmup === 'true') {
      try {
        const { generateWarmupContext } = await import('../core/warmup-engine.js');
        warmupContext = await generateWarmupContext();
      } catch {
        // Warmup non disponibile — procedi senza
      }
    }

    // Se warmup_context è fornito come JSON string, parsalo (sovrascrive generate_warmup)
    if (args?.warmup_context) {
      try {
        const parsed = JSON.parse(args.warmup_context) as WarmupContext;
        if (parsed && typeof parsed === 'object' && parsed.generatedAt) {
          warmupContext = parsed;
        }
      } catch {
        // JSON malformato — ignora silenziosamente
      }
    }

    // Formatta il warmup context se presente
    let warmupLines: string[] = [];
    if (warmupContext) {
      warmupLines = buildWarmupSection(warmupContext);
    }

    const contextMessage = [
      `# Sessione Codex Romanus — Avvio`,
      ``,
      `## Agente attivo`,
      `- **Nome**: ${agentName}`,
      `- **Agente primario**: ${primary?.latinName ?? 'N/A'} (${primary?.emoji ?? ''}) [${primary?.model ?? 'unknown'}]`,
      ``,
      `## Stato progetto`,
      `- **Task totali**: ${taskList.tasks.length}`,
      `- **In corso**: ${inProgressTasks.length}`,
      `- **In attesa**: ${pendingTasks.length}`,
      `- **Completati**: ${taskList.summary.completed}`,
      `- **Bloccati**: ${taskList.summary.blocked}`,
      ``,
      `## Team attivo`,
      ...agents.map(
        (a) =>
          `- ${a.emoji} **${a.latinName}** (${a.name}) — ${a.role} [${a.mode}]`
      ),
      ``,
      `## Task prioritari`,
      ...(pendingTasks.length > 0
        ? pendingTasks.slice(0, 5).map((t) => `- [ ] ${t.task} @${t.agent} [${t.priority ?? 'medium'}]`)
        : ['- Nessun task in attesa']),
      ...knowledgeLines,
      ...similarDecisionsLines,
      ...oracleLines,
      ...warmupLines,
      ``,
      `_Tabularium MCP Server — Inizia la sessione con il contesto aggiornato._`,
    ].join('\n');

    return {
      description: 'Prompt di avvio sessione Codex Romanus',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: contextMessage },
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Helper: Warm-up Context section builder
// ---------------------------------------------------------------------------

/**
 * Costruisce le righe di testo per la sezione Warm-up Context.
 * Formatta i dati di recentChanges, openBugs, recentAdrs e metricsSnapshot
 * in un blocco markdown leggibile.
 *
 * @param ctx - WarmupContext da formattare
 * @returns Array di stringhe pronte per il join nel prompt
 */
function buildWarmupSection(ctx: WarmupContext): string[] {
  const lines: string[] = [``, `## Warm-up Context`, `_Generato ${ctx.age}_`];

  // Recent Changes
  if (ctx.recentChanges.length > 0) {
    lines.push(``, `### Ultime modifiche`);
    for (const change of ctx.recentChanges) {
      lines.push(`- **${change.file}** — ${change.summary} (@${change.agent})`);
    }
  }

  // Open Bugs
  if (ctx.openBugs.length > 0) {
    lines.push(``, `### Bug aperti (${ctx.openBugs.length})`);
    for (const bug of ctx.openBugs) {
      lines.push(`- [${bug.severity}] **${bug.title}** — ${bug.component} (\`${bug.id}\`)`);
    }
  }

  // Recent ADRs
  if (ctx.recentAdrs.length > 0) {
    lines.push(``, `### ADR recenti`);
    for (const adr of ctx.recentAdrs) {
      lines.push(`- **${adr.id}**: ${adr.title} [${adr.status}]`);
    }
  }

  // Metrics Snapshot
  if (ctx.metricsSnapshot.length > 0) {
    lines.push(``, `### Scorecard`);

    const grade = ctx.metricsSnapshot[0]?.grade ?? 'N/A';
    const totalScore = ctx.metricsSnapshot.reduce((acc, m) => acc + m.score, 0);
    const avgScore = (totalScore / ctx.metricsSnapshot.length).toFixed(1);

    lines.push(`- **Grado complessivo**: ${grade} (media: ${avgScore})`);
    lines.push(`- **Breakdown per dominio**:`);

    for (const metric of ctx.metricsSnapshot) {
      lines.push(`  - ${metric.domain}: ${metric.score} pts`);
    }
  }

  // Memory Health (PURGE status — ADR-037a Livello 3)
  if (ctx.purgeHealth) {
    lines.push(``, `### Memory Health`);
    const ph = ctx.purgeHealth;
    const ageText = ph.ageDays === null ? 'Mai eseguito' : `${ph.ageDays} giorni fa`;
    lines.push(`- **Ultimo PURGE**: ${ageText} ${ph.icon}`);
    lines.push(`- **Soglia**: ${ph.threshold} giorni`);
    if (ph.overdue && ph.overdueDays !== null) {
      lines.push(`- ⚠️ **Overdue**: ${ph.overdueDays} giorno(i) oltre soglia`);
    }
    lines.push(`- **${ph.recommendation}**`);
  }

  // Se non ci sono dati disponibili
  if (
    ctx.recentChanges.length === 0 &&
    ctx.openBugs.length === 0 &&
    ctx.recentAdrs.length === 0 &&
    ctx.metricsSnapshot.length === 0
  ) {
    lines.push(``, `_Nessun dato disponibile per il warm-up contestuale._`);
  }

  return lines;
}
