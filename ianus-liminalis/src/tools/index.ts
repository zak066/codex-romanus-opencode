/**
 * Tool registry — Ianus Liminalis
 *
 * Aggrega tutti i tool MCP filesystem e registra gli handler
 * ListToolsRequestSchema e CallToolRequestSchema sul server.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDeps } from './types.js';
import { toolRegistry } from './registry.js';
import { registerMoveFile } from './move-file.js';
import { registerCopyFile } from './copy-file.js';
import { registerFindFile } from './find-file.js';
import { registerAppendFile } from './append-file.js';
import { registerLockFile, registerUnlockFile, registerGetLocks } from './lock-file.js';
import { registerSecretScan } from './secret-scan.js';
import { registerPermissionAudit } from './permission-audit.js';
import { registerFindSensitive } from './find-sensitive.js';
import { registerValidateConfig } from './validate-config.js';

import { registerReadMultipleFile } from './read-multiple-file.js';
import { registerMkdirFile } from './mkdir-file.js';

import { registerTemplateRender } from './template-render.js';
import { registerYamlMerge } from './yaml-merge.js';
import { registerTestCoverage } from './test-coverage.js';
import { registerFixtureLoader } from './fixture-loader.js';

// 📖 Documentation tools — Tacito
import { registerDocScaffold } from './doc-scaffold.js';
import { registerApiDocExtractor } from './api-doc-extractor.js';

import { registerReadFile } from './read-file.js';
import { registerWriteFile } from './write-file.js';
import { registerEditFile } from './edit-file.js';
import { registerDeleteFile } from './delete-file.js';
import { registerSearchFile } from './search-file.js';
import { registerTreeFile } from './tree-file.js';
import { registerStatFile } from './stat-file.js';
import { registerListFile } from './list-file.js';
import { registerBackupFile } from './backup-file.js';
import { registerRollbackFile } from './rollback-file.js';
import { registerJournalQuery } from './journal-query.js';
import { registerWatchFile } from './watch-file.js';
import { registerListAllowedDirs } from './list-allowed-dirs.js';
import { registerDiffFiles } from './diff-files.js';

import { registerCssLint } from './css-lint.js';
// 🧠 LLM Cache tool (ADR-006)
import { registerLLMCacheTool } from './llm-cache-tool.js';


import { registerHtmlLint } from './html-lint.js';
import { registerComponentScaffold } from './component-scaffold.js';


import { registerUndoFile } from './undo-file.js';
import { registerFormatFile } from './format-file.js';
import { registerTailFile } from './tail-file.js';
import { registerBatchSearchReplace } from './batch-search-replace.js';
import { registerTempSandbox } from './temp-sandbox.js';
import { registerStatBulk } from './stat-bulk.js';
import { registerScaffoldFile } from './scaffold-file.js';
import { registerValidateFile } from './validate-file.js';

import { registerSymlink } from './symlink.js';
import { registerArchive } from './archive.js';

// 🚀 Advanced tools — Fase 5
import { registerHooks } from './hooks.js';
import { registerDupeFinder } from './dupe-finder.js';
import { registerAuditReport } from './audit-report.js';
import { registerSizeAnalyzer } from './size-analyzer.js';
import { registerEncrypt } from './encrypt.js';
import { registerCache } from './cache.js';
import { registerDiffTree } from './diff-tree.js';
import { registerSnapshot } from './snapshot.js';
import { registerMerge } from './merge.js';
import { registerWorkflow } from './workflow.js';
import { registerWatchExec } from './watch-exec.js';

// 🌐 SEO tools (Naturalis)
import { registerMetaScanner } from './meta-scanner.js';
import { registerSitemapScanner } from './sitemap-scanner.js';

export function registerAllTools(server: Server, deps: ToolDeps): void {
  registerLockFile(server, deps);
  registerUnlockFile(server, deps);
  registerGetLocks(server, deps);

  // Each register function pushes its definition + handler into the shared registry
  // 🧠 LLM Cache tool (ADR-006)
  registerLLMCacheTool(server, deps);


  registerReadFile(server, deps);
  registerWriteFile(server, deps);
  registerEditFile(server, deps);
  registerDeleteFile(server, deps);
  registerSearchFile(server, deps);
  registerTreeFile(server, deps);
  registerStatFile(server, deps);
// 🏗️ DevOps & Infrastruttura tools
  registerTemplateRender(server, deps);
  registerYamlMerge(server, deps);
  registerSymlink(server, deps);
  registerArchive(server, deps);
  registerMoveFile(server, deps);
  registerCopyFile(server, deps);
  registerFindFile(server, deps);
  registerAppendFile(server, deps);
  registerReadMultipleFile(server, deps);
  registerMkdirFile(server, deps);

  registerUndoFile(server, deps);
  registerFormatFile(server, deps);
  registerTailFile(server, deps);
  registerBatchSearchReplace(server, deps);
  registerTempSandbox(server, deps);
  registerStatBulk(server, deps);

  registerScaffoldFile(server, deps);
  registerValidateFile(server, deps);

  // 🚀 Advanced tools — Fase 5
  registerDiffTree(server, deps);
  registerSnapshot(server, deps);
  registerMerge(server, deps);
  registerWorkflow(server, deps);
  registerWatchExec(server, deps);
  registerHooks(server, deps);
  registerDupeFinder(server, deps);
  registerAuditReport(server, deps);
  registerSizeAnalyzer(server, deps);
  registerEncrypt(server, deps);
  registerCache(server, deps);

  // 🔒 Security tools
  registerSecretScan(server, deps);

  // 🧪 Testing & Verification tools — Diana
  registerTestCoverage(server, deps);
  registerFixtureLoader(server, deps);

  // 📖 Documentation tools — Tacito
  registerDocScaffold(server, deps);
  registerApiDocExtractor(server, deps);

  registerPermissionAudit(server, deps);
  registerFindSensitive(server, deps);
  registerValidateConfig(server, deps);

  registerListFile(server, deps);

  // 🎨 Frontend tools — Ovidio
  registerCssLint(server, deps);
  registerHtmlLint(server, deps);
  registerComponentScaffold(server, deps);


  registerBackupFile(server, deps);
  registerRollbackFile(server, deps);
  registerJournalQuery(server, deps);
  registerWatchFile(server, deps);
  registerListAllowedDirs(server, deps);
  registerDiffFiles(server, deps);

  // 🌐 SEO tools — Plinio il Vecchio (Naturalis)
  registerMetaScanner(server, deps);
  registerSitemapScanner(server, deps);

  const allTools = toolRegistry.getAll();

  // Handler per tools/list: restituisce l'elenco dei tool registrati
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
      },
      annotations: t.annotations ?? {},
    })),
  }));

  // Handler per tools/call: dispatches alla funzione handler del tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolRegistry.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: "${request.params.name}"` }],
        isError: true,
      };
    }

    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Tool "${request.params.name}" error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
}
