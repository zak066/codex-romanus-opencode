/**
 * resources/index.ts
 * Registro centrale delle MCP Resources.
 * Ogni resource espone dati dalla configurazione opencode e file docs/codex-romanus/.
 * Il router supporta:
 *   - ListResources: restituisce i metadati di tutte le resource registrate
 *   - ReadResource: dispatches all'handler corretto in base all'URI
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { agentResourceHandler } from './agents.resource.js';
import { modelResourceHandler } from './models.resource.js';
import { projectResourceHandler } from './project.resource.js';
import { advisoryResourceHandler } from './advisory.resource.js';
import { skillResourceHandler } from './skills.resource.js';
import { memoryResourceHandler, resolveMemoryUri } from './memory.resource.js';
import { metricsResourceHandler, resolveMetricsUri } from './metrics.resource.js';
import { scorecardResourceHandler, resolveScorecardUri } from './scorecard.resource.js';
import { journalResourceHandler, resolveJournalUri } from './journal.resource.js';
import { projectMapResourceHandler } from './project-map.resource.js';
import { seoResourceHandler, resolveSeoUri } from './seo.resource.js';
import { decisionsResourceHandler, resolveDecisionsUri } from './decisions.resource.js';
import { designTokenResourceHandler, resolveDesignTokenUri } from './design-tokens.resource.js';
import { a11yResourceHandler, resolveA11yUri } from './a11y.resource.js';
import { messagingResourceHandler, resolveMessagingUri } from './messaging.resource.js';
import { graphResourceHandler, resolveGraphUri } from './graph.resource.js';

import { docFreshnessResourceHandler, resolveDocFreshnessUri } from './doc-freshness.resource.js';

/**
 * Elenco completo degli handler resource registrati.
 * L'ordine determina la priorita' di matching: l'URI piu' specifico prima.
 */
const RESOURCE_HANDLERS: ResourceHandler[] = [
  agentResourceHandler,       // tabularium://agents
  modelResourceHandler,       // tabularium://models
  projectMapResourceHandler,  // tabularium://project/map (prima di project per URI specifico)
  docFreshnessResourceHandler, // tabularium://project/docs
  projectResourceHandler,     // tabularium://project
  advisoryResourceHandler,    // tabularium://advisory
  skillResourceHandler,       // tabularium://skills
  memoryResourceHandler,      // tabularium://memory
  metricsResourceHandler,     // tabularium://metrics
  scorecardResourceHandler,   // tabularium://quality/scorecard
  journalResourceHandler,     // tabularium://journal
  seoResourceHandler,         // tabularium://seo
  decisionsResourceHandler,   // tabularium://decisions
  designTokenResourceHandler, // tabularium://design
  graphResourceHandler,      // tabularium://graph
  messagingResourceHandler,   // tabularium://agents/status

  a11yResourceHandler,        // tabularium://a11y
];

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

/**
 * Restituisce tutte le resource registrate (metadati per ListResourcesRequest).
 */
export function registerResources(): Array<{
  uri: string;
  description: string;
  mimeType: string;
}> {
  return RESOURCE_HANDLERS.map((h) => ({
    uri: h.uri,
    name: h.name,
    description: h.description,
    mimeType: h.mimeType,
  }));
}

/**
 * Risolve una resource per URI ed esegue il suo handler.
 *
 * La risoluzione tenta prima un match esatto; in caso fallisca, usa
 * il matching prefix (es. `tabularium://agents/list` risolve su
 * `tabularium://agents`). Questo permette di leggere anche sotto-URI
 * non esplicitamente registrati.
 *
 * @param uri - URI della resource da leggere
 * @returns Array di ResourceContent prodotti dall'handler
 * @throws Se nessun handler corrisponde all'URI
 */
export async function resolveResource(uri: string): Promise<ResourceContent[]> {
  if (!uri) {
    throw new Error('Resource URI cannot be empty');
  }

  // 0) URI-aware handling per sotto-URI dinamici
  if (uri.startsWith('tabularium://memory')) {
    return await resolveMemoryUri(uri);
  }
  if (uri.startsWith('tabularium://quality/scorecard')) {
    return await resolveScorecardUri(uri);
  }

  if (uri.startsWith('tabularium://journal')) {
    return await resolveJournalUri(uri);
  }

  if (uri.startsWith('tabularium://metrics')) {
    return await resolveMetricsUri(uri);
  }

  if (uri.startsWith('tabularium://project/map')) {
    return await projectMapResourceHandler.handler();
  }

  if (uri.startsWith('tabularium://project/docs')) {
    return await resolveDocFreshnessUri(uri);
  }

  if (uri.startsWith('tabularium://seo')) {
    return await resolveSeoUri(uri);
  }

  if (uri.startsWith('tabularium://decisions')) {
    return await resolveDecisionsUri(uri);
  }
  if (uri.startsWith('tabularium://design')) {
    return await resolveDesignTokenUri(uri);
  }

  // Knowledge Graph resources (V2d): dynamic routing for neighbors + overview
  if (uri.startsWith('tabularium://graph')) {
    return await resolveGraphUri(uri);
  }

  // Messaging resources (R1): must be checked before tabularium://agents exact/prefix match
  if (uri.startsWith('tabularium://agents/status') || uri.match(/^tabularium:\/\/agents\/[^/]+\/inbox$/)) {
    return await resolveMessagingUri(uri);
  }
  if (uri.startsWith('tabularium://channels/')) {
    return await resolveMessagingUri(uri);
  }

  if (uri.startsWith('tabularium://a11y')) {
    return await resolveA11yUri(uri);
  }

  // 1) Match esatto
  let handler = RESOURCE_HANDLERS.find((h) => h.uri === uri);

  // 2) Fallback: matching prefix (es. tabularium://agents/list → tabularium://agents)
  if (!handler) {
    handler = RESOURCE_HANDLERS.find((h) => uri.startsWith(h.uri + '/'));
  }

  if (!handler) {
    throw new Error(`Resource not found for URI: ${uri}`);
  }

  try {
    return await handler.handler();
  } catch (error) {
    throw new Error(
      `Handler error for resource '${uri}' (matched by '${handler.uri}'): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}
