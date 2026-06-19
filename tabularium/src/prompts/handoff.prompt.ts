/**
 * prompts/handoff.prompt.ts
 * Prompt MCP per il passaggio di consegne tra agenti (handoff).
 * Include task completati, contesto, heartbeat, raccomandazioni e knowledge pertinenti.
 */

import type { PromptHandler, PromptResult } from '../types/mcp.js';
import type { PurgeHealth } from '../core/warmup-engine.js';
import { parseProgress } from '../core/progress-parser.js';
import { getAgentByName } from '../core/agent-reader.js';
import { getHeartbeat, upsertHeartbeat } from '../messaging/db-heartbeats.js';

export const handoffHandler: PromptHandler = {
  name: 'agent_handoff',
  description:
    'Prompt per il passaggio di consegne tra agenti. Include task completati, contesto e raccomandazioni.',
  arguments: [
    {
      name: 'from_agent',
      description: "Agente che passa le consegne",
      required: true,
    },
    {
      name: 'to_agent',
      description: "Agente che riceve le consegne",
      required: true,
    },
  ],

  handler: async (args?: Record<string, string>): Promise<PromptResult> => {
    const fromAgent = args?.from_agent ?? 'unknown';
    const toAgent = args?.to_agent ?? 'unknown';

    const from = await getAgentByName(fromAgent);
    const to = await getAgentByName(toAgent);
    const taskList = await parseProgress();

    const fromTasks = taskList.tasks.filter((t) => t.agent === fromAgent);
    const toPendingTasks = taskList.tasks.filter(
      (t) => t.agent === toAgent && t.status === 'pending'
    );

    // Carica knowledge pertinenti per l'agente destinatario (try/catch per graceful fallback)
    let knowledgeLines: string[] = [];
    try {
      const { suggestKnowledgeForAgent } = await import('../core/knowledge-manager.js');
      const knowledge = suggestKnowledgeForAgent(toAgent, 3);
      if (knowledge.length > 0) {
        knowledgeLines = [
          ``,
          `## Knowledge base — Suggerimenti per ${toAgent}`,
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

    // Carica predizioni dell'Oracolo per il task in arrivo (try/catch per graceful fallback)
    let oracleLines: string[] = [];
    try {
      const { predictForTask } = await import('../core/oracle-engine.js');
      const oraclePrediction = await predictForTask(toAgent, `handoff from ${fromAgent}`);

      if (oraclePrediction.confidence > 0) {
        const parts: string[] = [``, `## Oracle — Raccomandazioni per ${toAgent}`];

        if (oraclePrediction.recommendedModel) {
          parts.push(`- **Modello raccomandato**: ${oraclePrediction.recommendedModel}`);
        }

        if (oraclePrediction.relevantKnowledge.length > 0) {
          parts.push(`- **Knowledge pertinente**:`);
          for (const k of oraclePrediction.relevantKnowledge.slice(0, 3)) {
            parts.push(`  - ${k.title.substring(0, 100)}`);
          }
        }

        if (oraclePrediction.commonPitfalls.length > 0) {
          parts.push(`- **Pitfalls da evitare**:`);
          for (const p of oraclePrediction.commonPitfalls.slice(0, 3)) {
            parts.push(`  - ⚠️ ${p.substring(0, 120)}`);
          }
        }

        parts.push(`- **Confidenza**: ${oraclePrediction.confidence}%`);
        oracleLines = parts;
      }
    } catch {
      // Oracolo non disponibile — procedi senza raccomandazioni
    }

    // Legge PURGE memory health (ADR-037a Livello 3)
    let memoryHealthLines: string[] = [];
    try {
      const { getLastPurgeAgeDays, getScheduleConfig } = await import('../core/schedule-purge.js');
      const config = getScheduleConfig();
      const ageDays = getLastPurgeAgeDays();
      const threshold = config.olderThan;

      let icon: string;
      let statusText: string;
      if (ageDays === null) {
        icon = '🔴';
        statusText = 'Mai eseguito';
      } else if (ageDays > threshold) {
        icon = '🔴';
        statusText = `${ageDays} giorni fa (overdue da ${ageDays - threshold}g)`;
      } else if (ageDays > threshold - 5) {
        icon = '🟡';
        statusText = `${ageDays} giorni fa (warning)`;
      } else {
        icon = '🟢';
        statusText = `${ageDays} giorni fa`;
      }

      memoryHealthLines = [
        ``,
        `## Memory Health`,
        `- **Ultimo PURGE**: ${statusText} ${icon}`,
        `- **Soglia**: ${threshold} giorni`,
      ];
    } catch {
      // PURGE health non disponibile — skip
    }

    // Legge heartbeat dei due agenti (try/catch per graceful fallback)
    let heartbeatLines: string[] = [];
    try {
      const fromHb = getHeartbeat(fromAgent);
      const toHb = getHeartbeat(toAgent);
      if (fromHb || toHb) {
        const lines: string[] = [``, `## Heartbeat — Stato agenti`];
        if (fromHb) {
          lines.push(`- **${fromAgent}**: ${fromHb.status} (ultimo: ${fromHb.last_seen})`);
        } else {
          lines.push(`- **${fromAgent}**: heartbeat non registrato`);
        }
        if (toHb) {
          lines.push(`- **${toAgent}**: ${toHb.status} (ultimo: ${toHb.last_seen})`);
        } else {
          lines.push(`- **${toAgent}**: heartbeat non registrato`);
        }
        heartbeatLines = lines;
      }
    } catch {
      // Heartbeat non disponibile — procedi senza
    }

    // Auto-set heartbeat del destinatario come 'busy'
    try {
      upsertHeartbeat(toAgent, 'busy', `Handoff: in attesa da ${fromAgent}`);
    } catch (err) {
      console.error(`[handoff] Failed to auto-set heartbeat for ${toAgent}:`, err);
    }

    const handoffMessage = [
      `# Handoff: ${from?.latinName ?? fromAgent} \u2192 ${to?.latinName ?? toAgent}`,
      ``,
      `## Da`,
      `- ${from?.emoji ?? '\u{1F916}'} **${from?.latinName ?? fromAgent}** \u2014 ${from?.role ?? 'N/A'}`,
      ``,
      `## A`,
      `- ${to?.emoji ?? '\u{1F916}'} **${to?.latinName ?? toAgent}** \u2014 ${to?.role ?? 'N/A'}`,
      ``,
      `## Task completati da ${fromAgent}`,
      ...(fromTasks.filter((t) => t.status === 'completed').length > 0
        ? fromTasks
            .filter((t) => t.status === 'completed')
            .map((t) => `- [x] ${t.task}`)
        : ['- Nessun task completato in questa sessione']),
      ``,
      `## Task in attesa per ${toAgent}`,
      ...(toPendingTasks.length > 0
        ? toPendingTasks.map((t) => `- [ ] ${t.task} [${t.priority ?? 'medium'}]`)
        : ['- Nessun task in attesa']),
      ``,
      `## Contesto del progetto`,
      `- **Task totali**: ${taskList.tasks.length}`,
      `- **In corso**: ${taskList.summary.in_progress}`,
      `- **Completati**: ${taskList.summary.completed}`,
      ...heartbeatLines,
      ...memoryHealthLines,

      ...knowledgeLines,
      ...oracleLines,
      ``,
      `## \u26A0\uFE0F Requisito: Heartbeat \u2014 Obbligatorio`,
      ``,
      `Per mantenere la dashboard aggiornata in tempo reale, DEVI eseguire questi due passaggi:`,
      ``,
      `**All'inizio del task:**`,
      `\`\`\``,
      `tabularium_agent_status agent="${toAgent}" status="busy" current_task="breve descrizione del task"`,
      `\`\`\``,
      ``,
      `**Al termine del task (prima di aggiornare progress.md):**`,
      `\`\`\``,
      `tabularium_agent_status agent="${toAgent}" status="idle"`,
      `\`\`\``,
      ``,
      `> \u2757 Se non lo fai, nella dashboard risulterai OFFLINE per tutto il tempo di lavoro.`,
      ``,
      `## Raccomandazioni`,
      `1. Verifica i file modificati con ` + '`git status`',
      `2. Leggi ` + '`docs/codex-romanus/progress.md`' + ` per lo stato aggiornato`,
      `3. Consulta eventuali ADR in ` + '`docs/codex-romanus/decisions.md`',
      ``,
      `_Handoff eseguito da Tabularium MCP Server._`,
    ].join('\n');

    return {
      description: `Handoff da ${fromAgent} a ${toAgent}`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: handoffMessage },
        },
      ],
    };
  },
};
