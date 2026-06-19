/**
 * fs_workflow — Ianus Liminalis
 *
 * Esegue una sequenza di operazioni dichiarative (pipe multi-tool)
 * definite in un file JSON workflow. Supporta placeholder {{VAR}}
 * sostituiti con variabili passate dal chiamante.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowStep {
  name: string;
  tool: string;
  params: Record<string, unknown>;
  onError?: 'abort' | 'skip' | 'continue';
}

interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface WorkflowStepResult {
  name: string;
  tool: string;
  status: 'success' | 'skipped' | 'error';
  duration: number;
  result?: Record<string, unknown>;
  error?: string;
}

interface WorkflowResult {
  workflow: string;
  name: string;
  success: boolean;
  steps: WorkflowStepResult[];
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Placeholder substitution
// ---------------------------------------------------------------------------

/**
 * Sostituisce placeholder {{VAR}} in una stringa.
 * Supporto ricorsivo annidato.
 */
function substitute(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const [key, val] of Object.entries(vars)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(pattern, val);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, vars));
  }

  if (value !== null && typeof value === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = substitute(v, vars);
    }
    return obj;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerWorkflow(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_workflow',
    description:
      'Execute a declarative workflow from a JSON file. Each step specifies a tool name and parameters. Placeholders {{VAR}} are substituted from the vars parameter. Supports abort, skip, or continue on error per step.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'string',
          description: 'Path to the workflow JSON file (relative to workspace)',
        },
        vars: {
          type: 'object',
          description:
            'Variables for {{placeholder}} substitution in the workflow (e.g., { "PROJECT": "/path", "ENV": "production" })',
          additionalProperties: { type: 'string' },
        },
        dryRun: {
          type: 'boolean',
          default: false,
          description: 'Simulate execution without actually running steps (default: false)',
        },
        agent: {
          type: 'string',
          description: 'Agent name (optional, default: "ianus")',
        },
      },
      required: ['workflow'],
    },
    handler: async (args) => {
      const workflowPath = args.workflow as string | undefined;
      if (!workflowPath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "workflow"' }], isError: true };
      }

      const vars = (args.vars as Record<string, string>) ?? {};
      const dryRun = (args.dryRun as boolean) ?? false;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — read sul workflow file
      const permCheck = await deps.permission.checkOperation(callerAgent, 'read', workflowPath, deps.workspaceRoot);
      if (!permCheck.allowed) {
        return { content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }], isError: true };
      }

      try {
        // Leggi e parsai workflow
        const safeWorkflowPath = resolveSafePath(workflowPath, deps.workspaceRoot);
        const rawContent = await readFile(safeWorkflowPath, 'utf-8');
        let workflowConfig: WorkflowDefinition;

        try {
          workflowConfig = JSON.parse(rawContent) as WorkflowDefinition;
        } catch {
          return {
            content: [{ type: 'text', text: `Invalid JSON in workflow file: "${workflowPath}"` }],
            isError: true,
          };
        }

        // Validazione struttura base
        if (!workflowConfig.name) {
          return { content: [{ type: 'text', text: 'Workflow missing required field: "name"' }], isError: true };
        }
        if (!Array.isArray(workflowConfig.steps) || workflowConfig.steps.length === 0) {
          return { content: [{ type: 'text', text: 'Workflow must contain at least one step in "steps" array' }], isError: true };
        }

        // Sostituisci placeholder in tutto il workflow
        const substitutedSteps = substitute(workflowConfig.steps, vars) as WorkflowStep[];

        // Variabili standard predefinite
        const defaultVars: Record<string, string> = {
          WORKSPACE: deps.workspaceRoot,
        };
        const allVars = { ...defaultVars, ...vars };

        const stepResults: WorkflowStepResult[] = [];
        let overallSuccess = true;
        const startTime = Date.now();

        for (let idx = 0; idx < substitutedSteps.length; idx++) {
          const step = substitutedSteps[idx];
          const stepStart = Date.now();

          // Apply substitution to params too
          const resolvedParams = substitute(step.params, allVars) as Record<string, unknown>;

          if (dryRun) {
            stepResults.push({
              name: step.name,
              tool: step.tool,
              status: 'skipped',
              duration: 0,
              result: { dryRun: true, params: resolvedParams },
            });
            continue;
          }

          // Trova il tool nel registry
          const toolDef = toolRegistry.get(step.tool);
          if (!toolDef) {
            const errMsg = `Unknown tool: "${step.tool}"`;
            stepResults.push({
              name: step.name,
              tool: step.tool,
              status: 'error',
              duration: Date.now() - stepStart,
              error: errMsg,
            });
            overallSuccess = false;

            const onError = step.onError ?? 'abort';
            if (onError === 'abort') break;
            // Per skip/continue, il passo è già stato registrato come errore
            // quindi proseguiamo al prossimo step
            continue;
          }

          try {
            // Esegui il tool handler
            const response = await toolDef!.handler(resolvedParams);

            const resultData: Record<string, unknown> = {};
            // Estrai il JSON dalla risposta se possibile
            if (response.content && response.content.length > 0) {
              const textContent = response.content[0];
              if (textContent.type === 'text') {
                try {
                  const parsed = JSON.parse(textContent.text);
                  Object.assign(resultData, parsed);
                } catch {
                  resultData.text = textContent.text;
                }
              }
            }

            if (response.isError) {
              stepResults.push({
                name: step.name,
                tool: step.tool,
                status: 'error',
                duration: Date.now() - stepStart,
                error: (resultData.text as string) || 'Unknown error',
              });
              overallSuccess = false;

              const onError = step.onError ?? 'abort';
              if (onError === 'abort') break;
              if (onError === 'skip') continue;
              if (onError === 'continue') continue;
            } else {
              stepResults.push({
                name: step.name,
                tool: step.tool,
                status: 'success',
                duration: Date.now() - stepStart,
                result: resultData,
              });
            }
          } catch (err) {
            stepResults.push({
              name: step.name,
              tool: step.tool,
              status: 'error',
              duration: Date.now() - stepStart,
              error: (err as Error).message,
            });
            overallSuccess = false;

            const onError = step.onError ?? 'abort';
            if (onError === 'abort') break;
            if (onError === 'skip') continue;
            if (onError === 'continue') continue;
          }
        }

        const totalDuration = Date.now() - startTime;

        // Log journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'workflow',
          path: workflowPath,
          details: {
            name: workflowConfig.name,
            success: overallSuccess,
            stepsTotal: substitutedSteps.length,
            stepsExecuted: stepResults.length,
            totalDuration,
            dryRun,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  workflow: workflowPath,
                  name: workflowConfig.name,
                  success: overallSuccess,
                  steps: stepResults,
                  totalDuration,
                } satisfies WorkflowResult,
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Workflow error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
