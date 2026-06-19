/**
 * prompts/index.ts
 * Registro centrale dei MCP Prompts.
 * Ogni prompt fornisce template testuali per guidare il flusso di lavoro degli agenti.
 * Il router supporta:
 *   - ListPrompts: restituisce i metadati di tutti i prompt registrati
 *   - GetPrompt: dispatches al prompt corretto in base al nome e ne genera il contenuto
 */

import type { PromptHandler, PromptResult } from '../types/mcp.js';
import { sessionStartHandler } from './session-start.prompt.js';
import { handoffHandler } from './handoff.prompt.js';
import { reviewHandler } from './review.prompt.js';
import { progressHandler } from './progress.prompt.js';

/**
 * Elenco completo degli handler prompt registrati.
 * Mappati per nome per lookup O(1).
 */
const PROMPT_HANDLERS: Map<string, PromptHandler> = new Map(
  [
    sessionStartHandler,  // session_start
    handoffHandler,       // agent_handoff
    reviewHandler,        // code_review
    progressHandler,      // progress_report
  ].map((h) => [h.name, h])
);

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

/**
 * Restituisce tutti i prompt registrati (metadati per ListPromptsRequest).
 */
export function registerPrompts(): Array<{
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}> {
  return Array.from(PROMPT_HANDLERS.values()).map((h) => ({
    name: h.name,
    description: h.description,
    arguments: h.arguments,
  }));
}

/**
 * Risolve ed esegue un prompt per nome.
 *
 * Se il prompt non esiste, restituisce un messaggio informativo.
 * Se l'handler lancia un'eccezione, la cattura e restituisce un errore safe.
 * Questo garantisce che il server MCP non crashi mai a causa di un prompt.
 *
 * @param name - Nome del prompt da generare
 * @param args - Argomenti opzionali del prompt
 * @returns PromptResult con description e messages
 */
export async function executePrompt(
  name: string,
  args?: Record<string, string>
): Promise<PromptResult> {
  if (!name) {
    return {
      description: 'Error: prompt name is required',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'Error: prompt name is required' },
        },
      ],
    };
  }

  const handler = PROMPT_HANDLERS.get(name);

  if (!handler) {
    return {
      description: `Unknown prompt: ${name}`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Prompt '${name}' not found. Available prompts: ${Array.from(PROMPT_HANDLERS.keys()).join(', ')}` },
        },
      ],
    };
  }

  try {
    return await handler.handler(args);
  } catch (error) {
    return {
      description: `Error executing prompt '${name}'`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Prompt '${name}' failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
      ],
    };
  }
}
