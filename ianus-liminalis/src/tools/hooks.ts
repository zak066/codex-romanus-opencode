/**
 * fs_hooks - Ianus Liminalis
 *
 * Pre/Post hook system per operazioni filesystem.
 * Mantiene una mappa in-memory di hook registrati (non persistente tra riavvii).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// Types
interface HookDefinition {
  name: string;
  type: 'pre' | 'post';
  operation: string;
  pattern: string;
  command: string;
  shell: boolean;
}

interface HookResult {
  name: string;
  type: string;
  success: boolean;
  output?: string;
  error?: string;
}

// In-memory hook store
const hooks = new Map<string, HookDefinition>();

// Helpers
function executeCommand(command: string, shell: boolean): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
      output: (err as { stdout?: string }).stdout?.toString().trim(),
    };
  }
}

function matchesHook(hook: HookDefinition, operation: string, filePath: string): boolean {
  if (hook.operation !== '*' && hook.operation !== operation) return false;
  return minimatch(filePath, hook.pattern, { dot: true });
}

// Action Handlers
function handleRegister(args: Record<string, unknown>) {
  const hookRaw = args.hook as Record<string, unknown> | undefined;
  if (!hookRaw || !hookRaw.name || !hookRaw.type || !hookRaw.operation || !hookRaw.pattern || !hookRaw.command) {
    return {
      content: [{ type: 'text', text: 'Missing required hook fields: name, type, operation, pattern, command' }],
      isError: true,
    };
  }

  const hook: HookDefinition = {
    name: String(hookRaw.name),
    type: hookRaw.type as 'pre' | 'post',
    operation: String(hookRaw.operation),
    pattern: String(hookRaw.pattern),
    command: String(hookRaw.command),
    shell: hookRaw.shell !== false,
  };

  if (hook.type !== 'pre' && hook.type !== 'post') {
    return {
      content: [{ type: 'text', text: 'Invalid hook type: must be "pre" or "post"' }],
      isError: true,
    };
  }

  if (hooks.has(hook.name)) {
    return {
      content: [{ type: 'text', text: `Hook "${hook.name}" is already registered` }],
      isError: true,
    };
  }

  hooks.set(hook.name, hook);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          registered: true,
          name: hook.name,
          type: hook.type,
          operation: hook.operation,
          pattern: hook.pattern,
        }),
      },
    ],
  };
}

function handleUnregister(args: Record<string, unknown>) {
  const name = args.name as string | undefined;
  if (!name) {
    return {
      content: [{ type: 'text', text: 'Missing required parameter: "name"' }],
      isError: true,
    };
  }

  const removed = hooks.delete(name);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ unregistered: removed, name }),
      },
    ],
  };
}

function handleList(args: Record<string, unknown>) {
  const operation = args.operation as string | undefined;
  let allHooks = Array.from(hooks.values());
  if (operation) {
    allHooks = allHooks.filter((h) => h.operation === operation || h.operation === '*');
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          hooks: allHooks.map((h) => ({
            name: h.name,
            type: h.type,
            operation: h.operation,
            pattern: h.pattern,
            command: h.command,
          })),
        }),
      },
    ],
  };
}

function handleRun(args: Record<string, unknown>) {
  const operation = args.operation as string | undefined;
  const filePath = args.path as string | undefined;

  if (!operation || !filePath) {
    return {
      content: [{ type: 'text', text: 'Missing required parameters: "operation" and "path"' }],
      isError: true,
    };
  }

  const allHooks = Array.from(hooks.values());
  const matching = allHooks.filter((h) => matchesHook(h, operation, filePath));

  if (matching.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ executed: [] }),
        },
      ],
    };
  }

  const results: HookResult[] = matching.map((hook) => {
    const { success, output, error } = executeCommand(hook.command, hook.shell);
    return {
      name: hook.name,
      type: hook.type,
      success,
      output,
      error,
    };
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ executed: results }),
      },
    ],
  };
}

// Registration
export function registerHooks(_server: Server, _deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_hooks',
    description:
      'Register, unregister, list, and run pre/post hooks on filesystem operations. ' +
      'Hooks are stored in-memory and are lost on restart. ' +
      'Supports glob pattern matching for triggering on specific paths.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['register', 'unregister', 'list', 'run'],
          description: 'Action to perform',
        },
        hook: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique hook name' },
            type: { type: 'string', enum: ['pre', 'post'], description: 'Pre or post operation' },
            operation: { type: 'string', description: 'Operation: "write" | "delete" | "move" | "edit" | "*"' },
            pattern: { type: 'string', description: 'Glob path pattern to match' },
            command: { type: 'string', description: 'Command/script to execute' },
            shell: { type: 'boolean', default: true, description: 'Execute via shell (default: true)' },
          },
          description: 'Hook definition (required for register)',
        },
        name: { type: 'string', description: 'Hook name (for unregister)' },
        operation: { type: 'string', description: 'Filter by operation (for list/run, optional)' },
        path: { type: 'string', description: 'File path (for run)' },
      },
      required: ['action'],
    },
    handler: async (args) => {
      const action = args.action as string;

      switch (action) {
        case 'register':
          return handleRegister(args);
        case 'unregister':
          return handleUnregister(args);
        case 'list':
          return handleList(args);
        case 'run':
          return handleRun(args);
        default:
          return {
            content: [{ type: 'text', text: `Unknown action: "${action}". Use: register, unregister, list, run` }],
            isError: true,
          };
      }
    },
  });
}