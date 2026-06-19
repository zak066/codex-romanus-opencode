/**
 * Tools — Registrazione centralizzata di tutti i tool MCP.
 *
 * Ogni fase del progetto aggiunge qui la propria funzione di registrazione.
 * Fase 4 (F4): WorkflowExecuteTools
 * Fase 5 (F5): GenerationTools
 * Fase 6 (F6): SystemTools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComfyClient } from '../comfyui/client.js';
import type { WorkflowManager } from '../services/workflow-manager.js';
import type { AssetRegistry } from '../services/asset-registry.js';
import type { ImageHandler } from '../services/image-handler.js';
import { registerWorkflowExecuteTools } from './workflow-execute.js';
import { registerSystemTools } from './system.js';
import { registerGenerationTools } from './generation.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolDeps {
  comfyClient: ComfyClient;
  workflowManager: WorkflowManager;
  assetRegistry: AssetRegistry;
  imageHandler?: ImageHandler;
}

// ─── Register All ────────────────────────────────────────────────────────────

/**
 * Registra tutti i tool MCP disponibili sul server.
 *
 * A ogni fase del progetto corrisponde una funzione di registrazione
 * invocata qui.
 *
 * @param server Istanza McpServer su cui registrare i tool
 * @param deps   Dipendenze iniettate
 */
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  // F4 — Workflow Execution
  registerWorkflowExecuteTools(server, deps);

  // F5 — Generation Tools
  registerGenerationTools(server, deps);

  // F6 — System Tools
  registerSystemTools(server, deps);
}
