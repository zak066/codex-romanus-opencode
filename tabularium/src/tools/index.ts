/**
 * tools/index.ts
 * Registro centrale dei MCP Tools.
 * Ogni tool espone una funzionalita' operativa per la governance del progetto.
 * Il router supporta:
 *   - ListTools: restituisce i metadati di tutti i tool registrati
 *   - CallTool: dispatches al tool corretto in base al nome e ne esegue la logica
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { taskToolHandler } from './task.tool.js';
import { decisionToolHandler } from './decision.tool.js';
import { agentConfigToolHandler } from './agent-config.tool.js';
import { utilityToolHandler } from './utility.tool.js';
import { dbMaintenanceTool } from './utility.tool.js';

import { skillToolHandler } from './skill.tool.js';
import { memoryPurgeToolHandler } from './purge.tool.js';
import { memoryCompactToolHandler } from './compact.tool.js';
import { scheduleToolHandler } from './schedule.tool.js';

import { memoryToolHandler } from './memory.tool.js';
import {
  metricsStoreToolHandler,
  metricsQueryToolHandler,
  metricsTrendToolHandler,
} from './metrics.tool.js';
import {
  alertListToolHandler,
  alertAcknowledgeToolHandler,
  alertResolveToolHandler,
} from './alert.tool.js';
import { cacheWarmupToolHandler } from './cache-warmup.tool.js';

import { changelogToolHandler } from './changelog.tool.js';
import { regressionDetectToolHandler, qualityGateRunToolHandler } from './quality.tool.js';
import {
  bugReportToolHandler,
  bugQueryToolHandler,
  bugTrendToolHandler,
} from './bug.tool.js';
import {
  journalLogToolHandler,
  journalQueryToolHandler,
} from './journal.tool.js';
import { taskScaffoldToolHandler } from './template.tool.js';
import { warmupContextToolHandler } from './warmup.tool.js';
import {
  secretScanToolHandler,
  secretListToolHandler,
  secretUpdateStatusToolHandler,
} from './secret.tool.js';
import {
  sbomCaptureToolHandler,
  sbomListToolHandler,
  sbomDiffToolHandler,
} from './sbom.tool.js';
import {
  generateSitemapToolHandler,
  validateStructuredDataToolHandler,
} from './seo.tool.js';
import { decisionLifecycleToolHandler } from './adr.tool.js';
import {
  incidentCreateToolHandler,
  incidentListToolHandler,
  incidentUpdateToolHandler,
} from './incident.tool.js';
import {
  agentSendToolHandler,
  agentInboxToolHandler,
  agentStatusToolHandler,
  agentListAgentsToolHandler,
  channelCreateToolHandler,
  channelListToolHandler,
  agentDeleteMessageToolHandler,
  channelDeleteToolHandler,
  agentSearchMessagesToolHandler,
  agentMarkReadToolHandler,
  agentEventHistoryToolHandler,
} from './messaging.tool.js';

import { ianusIngestToolHandler } from './ianus.tool.js';

import {
  graphAddEdgeToolHandler,
  graphRemoveEdgeToolHandler,
  graphQueryToolHandler,
  graphGetRelatedToolHandler,
  graphAutoLinkToolHandler,
  graphGetPathToolHandler,
} from './graph.tool.js';

import { qualityGateStreamToolHandler } from './quality-gate-stream.tool.js';
import { trendReportToolHandler } from './trend-report.tool.js';
import { bugUpdateToolHandler } from './bug-update.tool.js';
import { alertEvaluateToolHandler } from './alert-evaluate.tool.js';
import { dbHealthToolHandler } from './db-health.tool.js';
import { knowledgeInjectToolHandler } from './knowledge-inject.tool.js';
import { cacheMetricsToolHandler } from './cache-metrics.tool.js';
import { docHealthToolHandler } from './doc-health.tool.js';
import { toolAnalyticsToolHandler } from './tool-analytics.tool.js';
import { configWriteToolHandler } from './config-write.tool.js';

// ── BATCH 2 — Nuovi tool (6) ───────────────────────────────────────────────
import { benchmarkRunToolHandler } from './benchmark-run.tool.js';
import { benchmarkIngestToolHandler } from './benchmark-ingest.tool.js';
import { queryProfileToolHandler } from './query-profile.tool.js';
import { logExplorerToolHandler } from './log-explorer.tool.js';
import { configHistoryToolHandler } from './config-history.tool.js';
import {
  dependencyScanToolHandler,
  vulnAssessmentToolHandler,
  policyAuditToolHandler,
  remediationToolHandler,
  postureReportToolHandler,
} from './dependency-scan.tool.js';


/**
 * Elenco completo degli handler tool registrati.
 * Mappati per nome per lookup O(1).
 */
const TOOL_HANDLERS: Map<string, ToolHandler> = new Map(
  [
    taskToolHandler,           // task_list
    decisionToolHandler,       // decision_log
    agentConfigToolHandler,    // agent_config
    utilityToolHandler,        // utility
    dbMaintenanceTool,         // db_maintenance
    skillToolHandler,          // skill_manager
    memoryPurgeToolHandler,    // tabularium_memory_purge
    memoryCompactToolHandler,  // tabularium_memory_compact
    scheduleToolHandler,       // tabularium_memory_purge_schedule
    memoryToolHandler,         // tabularium_memory
    metricsStoreToolHandler,   // metrics_store
    metricsQueryToolHandler,   // metrics_query
    metricsTrendToolHandler,   // metrics_trend
    alertListToolHandler,      // alert_list
    alertAcknowledgeToolHandler,  // alert_acknowledge
    alertResolveToolHandler,   // alert_resolve
    regressionDetectToolHandler,  // regression_detect
    qualityGateRunToolHandler,    // quality_gate_run
    changelogToolHandler,      // generate_changelog
    bugReportToolHandler,      // bug_report
    bugQueryToolHandler,       // bug_query
    bugTrendToolHandler,       // bug_trend
    journalLogToolHandler,     // journal_log
    journalQueryToolHandler,   // journal_query
    taskScaffoldToolHandler,   // task_scaffold
    warmupContextToolHandler,  // warmup_context
    cacheWarmupToolHandler,    // cache_warmup
    generateSitemapToolHandler,   // generate_sitemap
    validateStructuredDataToolHandler, // validate_structured_data
    secretScanToolHandler,     // secret_scan
    secretListToolHandler,     // secret_list
    agentSendToolHandler,      // agent_send
    agentInboxToolHandler,     // agent_inbox
    agentStatusToolHandler,    // agent_status
    agentListAgentsToolHandler,  // agent_list_agents
    channelCreateToolHandler,  // channel_create
    channelListToolHandler,    // channel_list
    agentDeleteMessageToolHandler,  // agent_delete_message
    channelDeleteToolHandler,      // channel_delete
    agentSearchMessagesToolHandler, // agent_search_messages
    agentMarkReadToolHandler,       // agent_mark_read
    agentEventHistoryToolHandler,   // agent_event_history

    secretUpdateStatusToolHandler, // secret_update_status
    sbomCaptureToolHandler,    // sbom_capture
    sbomDiffToolHandler,       // sbom_diff
    sbomListToolHandler,       // sbom_list
    decisionLifecycleToolHandler, // decision_lifecycle
    incidentCreateToolHandler,    // incident_create
    incidentListToolHandler,      // incident_list
    incidentUpdateToolHandler,    // incident_update
    ianusIngestToolHandler,       // ianus_ingest
    graphAddEdgeToolHandler,      // graph_add_edge
    graphRemoveEdgeToolHandler,   // graph_remove_edge
    graphQueryToolHandler,        // graph_query
    graphGetRelatedToolHandler,   // graph_get_related
    graphAutoLinkToolHandler,     // graph_auto_link
    graphGetPathToolHandler,      // graph_get_path

    // ── BATCH 1 — Nuovi tool (10) ────────────────────────────────────────
    qualityGateStreamToolHandler,  // quality_gate_stream
    trendReportToolHandler,        // trend_report
    bugUpdateToolHandler,          // bug_update
    alertEvaluateToolHandler,      // alert_evaluate
    dbHealthToolHandler,           // db_health
    knowledgeInjectToolHandler,    // knowledge_inject
    cacheMetricsToolHandler,       // cache_metrics
    docHealthToolHandler,          // doc_health
    toolAnalyticsToolHandler,      // tool_analytics
    configWriteToolHandler,        // config_write

    // ── BATCH 2 — Nuovi tool (6) ────────────────────────────────────────
    benchmarkRunToolHandler,         // tabularium_benchmark_run
    benchmarkIngestToolHandler,      // tabularium_benchmark_ingest
    queryProfileToolHandler,         // tabularium_query_profile
    logExplorerToolHandler,          // tabularium_log_explorer
    configHistoryToolHandler,        // tabularium_config_history
    dependencyScanToolHandler,       // tabularium_dependency_scan
    vulnAssessmentToolHandler,       // tabularium_vuln_assessment
    policyAuditToolHandler,          // tabularium_policy_audit
    remediationToolHandler,          // tabularium_remediation
    postureReportToolHandler,        // tabularium_posture_report
  ].map((h) => [h.name, h])
);

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

/**
 * Restituisce tutti i tool registrati (metadati per ListToolsRequest).
 */
export function registerTools(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Array.from(TOOL_HANDLERS.values()).map((h) => ({
    name: h.name,
    description: h.description,
    inputSchema: h.inputSchema,
  }));
}

/**
 * Risolve ed esegue un tool per nome.
 *
 * Se il tool non esiste, restituisce un risultato con isError=true.
 * Se l'handler lancia un'eccezione, la cattura e la restituisce come errore.
 * Questo garantisce che il server MCP non crashi mai a causa di un tool.
 *
 * @param name - Nome del tool da eseguire
 * @param args - Argomenti del tool (oggetto chiave-valore)
 * @returns ToolResult con content e flag isError
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (!name) {
    return {
      content: [{ type: 'text', text: 'Error: tool name is required' }],
      isError: true,
    };
  }

  const handler = TOOL_HANDLERS.get(name);

  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await handler.handler(args);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool '${name}' failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
