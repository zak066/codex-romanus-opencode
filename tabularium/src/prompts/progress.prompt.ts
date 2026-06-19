/**
 * prompts/progress.prompt.ts
 * Prompt MCP per il report di avanzamento periodico.
 * Genera un riepilogo dello stato del progetto per il team.
 */

import type { PromptHandler, PromptResult } from '../types/mcp.js';
import { parseProgress } from '../core/progress-parser.js';
import { parseDecisions } from '../core/decisions-parser.js';
import { getAllAgents } from '../core/agent-reader.js';

export const progressHandler: PromptHandler = {
  name: 'progress_report',
  description:
    'Prompt per generare un report di avanzamento. Include stato task, decisioni recenti e metriche.',
  arguments: [
    {
      name: 'period',
      description: "Periodo del report (es. 'daily', 'weekly', 'sprint')",
      required: false,
    },
  ],

  handler: async (args?: Record<string, string>): Promise<PromptResult> => {
    const period = args?.period ?? 'daily';
    const taskList = await parseProgress();
    const decisionLog = await parseDecisions();
    const agents = await getAllAgents();

    // PURGE Memory Health (ADR-037a Livello 3) — graceful degradation
    let purgeStatusLine = '| Ultimo PURGE | ❓ non disponibile |';
    try {
      const { getLastPurgeAgeDays, getScheduleConfig } = await import('../core/schedule-purge.js');
      const ageDays = getLastPurgeAgeDays();
      const config = getScheduleConfig();
      if (ageDays === null) {
        purgeStatusLine = `| Ultimo PURGE | 🔴 Mai eseguito (soglia: ${config.olderThan}g) |`;
      } else if (ageDays > config.olderThan) {
        purgeStatusLine = `| Ultimo PURGE | 🔴 ${ageDays} giorni fa (overdue da ${ageDays - config.olderThan}g) |`;
      } else if (ageDays > config.olderThan - 5) {
        purgeStatusLine = `| Ultimo PURGE | 🟡 ${ageDays} giorni fa (soglia: ${config.olderThan}g) |`;
      } else {
        purgeStatusLine = `| Ultimo PURGE | 🟢 ${ageDays} giorni fa (soglia: ${config.olderThan}g) |`;
      }
    } catch {
      // PURGE health non disponibile — linea con fallback
    }

    // Riepilogo per agente
    const agentSummaries = agents.map((agent) => {
      const agentTasks = taskList.tasks.filter((t) => t.agent === agent.name);
      const completed = agentTasks.filter((t) => t.status === 'completed').length;
      const inProgress = agentTasks.filter((t) => t.status === 'in_progress').length;
      const pending = agentTasks.filter((t) => t.status === 'pending').length;
      const blocked = agentTasks.filter((t) => t.status === 'blocked').length;
      return {
        agent: agent.name,
        latinName: agent.latinName,
        emoji: agent.emoji,
        completed,
        inProgress,
        pending,
        blocked,
        total: agentTasks.length,
      };
    });

    const progressReport = [
      `# Report Avanzamento — ${period.toUpperCase()}`,
      ``,
      `**Generato**: ${new Date().toISOString()}`,
      `**Ultimo aggiornamento progress**: ${taskList.updatedAt}`,
      ``,
      `## Riepilogo Generale`,
      `| Metrica | Valore |`,
      `|---------|--------|`,
      `| Task totali | ${taskList.summary.total} |`,
      `| Pending | ${taskList.summary.pending} |`,
      `| In corso | ${taskList.summary.in_progress} |`,
      `| Completati | ${taskList.summary.completed} |`,
      `| Bloccati | ${taskList.summary.blocked} |`,
      `| Cancellati | ${taskList.summary.cancelled} |`,
      purgeStatusLine,
      ``,
      `## Per Agente`,
      `| Agente | Totale | In Corso | Completati | In Attesa | Bloccati |`,
      `|--------|--------|----------|------------|-----------|----------|`,
      ...agentSummaries.map(
        (a) =>
          `| ${a.emoji} ${a.latinName} | ${a.total} | ${a.inProgress} | ${a.completed} | ${a.pending} | ${a.blocked} |`
      ),
      ``,
      `## Decisioni Recenti`,
      ...(decisionLog.decisions.length > 0
        ? decisionLog.decisions.slice(-5).map(
            (d) => `- **${d.adr_id}**: ${d.title} — ${d.decision.substring(0, 80)}${d.decision.length > 80 ? '...' : ''}`
          )
        : ['- Nessuna decisione registrata']),
      ``,
      `## Progresso`,
      `- Percentuale completamento: ${taskList.summary.total > 0 ? Math.round((taskList.summary.completed / taskList.summary.total) * 100) : 0}%`,
      `- Task bloccati che richiedono attenzione: ${taskList.summary.blocked}`,
      ``,
      `_Report generato da Tabularium MCP Server — ${period} report._`,
    ].join('\n');

    return {
      description: `Report di avanzamento — ${period}`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: progressReport },
        },
      ],
    };
  },
};
