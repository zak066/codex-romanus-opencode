import type { PermissionChecker } from '../core/permission.js';
import type { BackupManager } from '@codex-romanus/fs-backup';

export interface ToolDeps {
  workspaceRoot: string;
  permission: PermissionChecker;
  backup: BackupManager;
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
  };
}
