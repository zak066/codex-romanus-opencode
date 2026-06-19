/**
 * prompts/review.prompt.ts
 * Prompt MCP per la revisione del codice e delle decisioni.
 * Guida l'agente nella code review strutturata.
 */

import type { PromptHandler, PromptResult } from '../types/mcp.js';
import { parseDecisions } from '../core/decisions-parser.js';
import { validateConfig } from '../core/validator.js';

export const reviewHandler: PromptHandler = {
  name: 'code_review',
  description:
    'Prompt per la revisione strutturata del codice. Include checklist, ADR rilevanti e validazione.',
  arguments: [
    {
      name: 'agent',
      description: "Agente che esegue la review",
      required: true,
    },
    {
      name: 'scope',
      description: "Ambito della review (es. 'full', 'security', 'style')",
      required: false,
    },
  ],

  handler: async (args?: Record<string, string>): Promise<PromptResult> => {
    const agent = args?.agent ?? 'unknown';
    const scope = args?.scope ?? 'full';
    const decisionLog = await parseDecisions();
    const validationErrors = await validateConfig();

    const reviewMessage = [
      `# Code Review — ${scope.toUpperCase()}`,
      ``,
      `## Esecutore`,
      `- Agente: **${agent}**`,
      `- Ambito: **${scope}**`,
      `- Data: ${new Date().toISOString().split('T')[0]}`,
      ``,
      `## Checklist`,
    ];

    if (scope === 'full' || scope === 'security') {
      reviewMessage.push(
        `### Security`,
        `- [ ] Nessun secret hardcodato (API key, token, password)`,
        `- [ ] Input validation presente per tutti gli endpoint`,
        `- [ ] Dipendenze aggiornate (nessuna CVE nota)`,
        `- [ ] Permessi minimi necessari`,
        ``
      );
    }

    if (scope === 'full' || scope === 'style') {
      reviewMessage.push(
        `### Code Quality`,
        `- [ ] TypeScript strict mode attivo`,
        `- [ ] Nomi significativi per variabili e funzioni`,
        `- [ ] Funzioni piccole e con singola responsabilità`,
        `- [ ] Test coverage >= 80%`,
        ``
      );
    }

    if (scope === 'full' || scope === 'architecture') {
      reviewMessage.push(
        `### Architettura`,
        `- [ ] Nessuna dipendenza circolare`,
        `- [ ] Moduli coerenti con la struttura del progetto`,
        `- [ ] ADR aggiornate per decisioni recenti`,
        ``
      );
    }

    reviewMessage.push(
      `## ADR rilevanti`,
      ...(decisionLog.decisions.length > 0
        ? decisionLog.decisions.slice(-3).map(
            (d) => `- **${d.adr_id}**: ${d.title} (di @${d.agent})`
          )
        : ['- Nessuna ADR registrata']),
      ``,
      `## Validazione configurazione`,
      validationErrors.length === 0
        ? `- ✅ Configurazione valida`
        : `- ⚠️ ${validationErrors.length} problemi trovati:\n${validationErrors.map((e) => `  - [${e.severity}] ${e.field}: ${e.message}`).join('\n')}`,
      ``,
      `_Review generata da Tabularium MCP Server._`,
    );

    return {
      description: `Code review prompt — ${scope}`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: reviewMessage.join('\n') },
        },
      ],
    };
  },
};
