import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env') });
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PermissionChecker } from './core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import type { ToolDeps } from './tools/types.js';

const workspaceRoot = resolve(process.env.IANUS_WORKSPACE_ROOT || '.');
const backupDir = resolve(workspaceRoot, process.env.IANUS_BACKUP_DIR || '.ianus-backups');
const retentionDays = parseInt(process.env.IANUS_BACKUP_RETENTION_DAYS || '5', 10);

const server = new Server(
  { name: 'ianus-liminalis', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

async function main() {
  // Carica permessi
  const permission = await PermissionChecker.load(
    resolve(workspaceRoot, '.ianus-permissions.json'),
  ).catch(() => new PermissionChecker({ version: 1, defaultEffect: 'deny', rules: [] }));

  const backup = new BackupManager({ backupDir, retentionDays });

  const deps: ToolDeps = { workspaceRoot, permission, backup };
  registerAllTools(server, deps);
  registerAllResources(server, deps);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ianus-liminalis: connected via stdio');
}

main().catch(console.error);
