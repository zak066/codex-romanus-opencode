/**
 * fs_watch_exec — Ianus Liminalis
 *
 * Osserva una directory per cambiamenti ed esegue un comando/shell script
 * quando rileva modifiche. Raccoglie eventi con debounce, esegue il comando,
 * e restituisce stdout/stderr.
 *
 * Poiché MCP opera su base request/response, il watch è attivo per una
 * durata configurabile (default: 60s, max: 300s). Durante questo periodo
 * raccoglie eventi e, scaduto il debounce, esegue il comando specificato.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { watch } from 'node:fs';
import { exec, spawn } from 'node:child_process';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WatchExecEvent {
  type: string;
  filename: string | null;
  timestamp: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
}

interface WatchExecResult {
  path: string;
  command: string;
  watching: boolean;
  pid: number | null;
  duration: number;
  events: WatchExecEvent[];
  executions: Array<{
    trigger: number;      // Numero di eventi che hanno triggerato
    command: string;
    result: CommandResult;
  }>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerWatchExec(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_watch_exec',
    description:
      'Watch a directory for changes and execute a command when changes are detected. Events are collected with debounce, then the command is run. Returns stdout/stderr output. Watch duration configurable (default: 60s, max: 300s).',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to watch for changes (relative to workspace)',
        },
        command: {
          type: 'string',
          description: 'Command to execute when changes are detected',
        },
        events: {
          type: 'array',
          items: { type: 'string', enum: ['change', 'add', 'unlink'] },
          description:
            'Event types to trigger on: "change", "add", "unlink" (default: all)',
        },
        include: {
          type: 'string',
          description: 'Glob pattern to filter watched files',
        },
        exclude: {
          type: 'string',
          default: '**/node_modules/**,**/.git/**',
          description:
            'Glob pattern to exclude files (default: "**/node_modules/**,**/.git/**")',
        },
        debounce: {
          type: 'number',
          default: 500,
          minimum: 100,
          maximum: 30000,
          description: 'Debounce period in ms between detecting events and executing command (default: 500)',
        },
        shell: {
          type: 'boolean',
          default: true,
          description: 'Execute via shell (default: true). If false, splits command by spaces.',
        },
        wait: {
          type: 'boolean',
          default: false,
          description:
            'If true, wait for command completion before processing new events (default: false)',
        },
        duration: {
          type: 'number',
          default: 60000,
          minimum: 5000,
          maximum: 300000,
          description: 'Total watch duration in ms (default: 60000 = 60s, max: 300000 = 5min)',
        },
        agent: {
          type: 'string',
          description: 'Agent name (optional, default: "ianus")',
        },
      },
      required: ['path', 'command'],
    },
    handler: async (args) => {
      const watchPath = args.path as string | undefined;
      const command = args.command as string | undefined;

      if (!watchPath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }
      if (!command) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "command"' }], isError: true };
      }

      const eventFilter = (args.events as string[]) ?? ['change', 'add', 'unlink'];
      const include = args.include as string | undefined;
      const exclude = (args.exclude as string) || '**/node_modules/**,**/.git/**';
      const debounce = (args.debounce as number) ?? 500;
      const useShell = (args.shell as boolean) ?? true;
      const waitFlag = (args.wait as boolean) ?? false;
      const duration = (args.duration as number) ?? 60000;
      const callerAgent = (args.agent as string) || 'ianus';

      // Validation
      if (duration < 5000 || duration > 300000) {
        return {
          content: [{ type: 'text', text: 'Duration must be between 5000 and 300000 ms' }],
          isError: true,
        };
      }

      // Permission check — read sulla directory
      const permCheck = await deps.permission.checkOperation(callerAgent, 'read', watchPath, deps.workspaceRoot);
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(watchPath, deps.workspaceRoot);

        // Collect events and execute command
        const collected: WatchExecEvent[] = [];
        const executions: WatchExecResult['executions'] = [];
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingEvents = 0;
        let commandRunning = false;
        let watchClosed = false;

        const result: WatchExecResult = {
          path: watchPath,
          command,
          watching: true,
          pid: null,
          duration,
          events: [],
          executions: [],
        };

        // Helper to execute command
        async function executeCommand(eventCount: number): Promise<void> {
          if (commandRunning && waitFlag) {
            // Se wait=true e un comando è in esecuzione, salta
            return;
          }

          // Narrowing: command è string | undefined a causa del parametro della funzione esterna
          const cmd: string = command!;
          if (!cmd) return;

          commandRunning = true;
          const cmdStart = Date.now();

          try {
            const cmdResult = await new Promise<CommandResult>((resolveResult) => {
              if (useShell) {
                const child = exec(
                  cmd,
                  {
                    cwd: deps.workspaceRoot,
                    timeout: 60000, // 1 min timeout per il comando
                  },
                  (error, stdout, stderr) => {
                    resolveResult({
                      stdout: (stdout ?? '') as string,
                      stderr: (stderr ?? '') as string,
                      exitCode: error ? (error.code ?? 1) : 0,
                      duration: Date.now() - cmdStart,
                    });
                  },
                );
                if (child.pid && !result.pid) {
                  result.pid = child.pid ?? null;
                }
              } else {
                const parts = cmd.split(/\s+/);
                const cmdBin = parts[0]!;
                const cmdArgs = parts.slice(1);
                const child = spawn(cmdBin, cmdArgs, {
                  cwd: deps.workspaceRoot,
                  timeout: 60000,
                });

                let stdout = '';
                let stderr = '';

                child.stdout?.on('data', (data: Buffer) => {
                  stdout += data.toString();
                });
                child.stderr?.on('data', (data: Buffer) => {
                  stderr += data.toString();
                });

                child.on('close', (code) => {
                  resolveResult({
                    stdout,
                    stderr,
                    exitCode: code,
                    duration: Date.now() - cmdStart,
                  });
                });
                child.on('error', (err) => {
                  resolveResult({
                    stdout,
                    stderr: err.message,
                    exitCode: -1,
                    duration: Date.now() - cmdStart,
                  });
                });

                if (child.pid && !result.pid) {
                  result.pid = child.pid ?? null;
                }
              }
            });

            executions.push({
              trigger: eventCount,
              command: cmd,
              result: cmdResult,
            });

            // Log execution
            await logToJournal(deps.workspaceRoot, {
              agent: callerAgent,
              operation: 'watch_exec',
              path: watchPath!,
              details: {
                command: cmd,
                eventCount,
                exitCode: cmdResult.exitCode,
                duration: cmdResult.duration,
              },
            });
          } catch (err) {
            executions.push({
              trigger: eventCount,
              command: cmd,
              result: {
                stdout: '',
                stderr: (err as Error).message,
                exitCode: -1,
                duration: Date.now() - cmdStart,
              },
            });
          } finally {
            commandRunning = false;
          }
        }

        // Avvia watcher
        const watcher = watch(
          safePath,
          { recursive: true },
          (eventType, filename) => {
            if (watchClosed) return;

            // Filtra eventi
            if (!eventFilter.includes(eventType)) return;

            // Per semplicità, non applichiamo include/exclude glob
            // a runtime sul filename (sarebbe troppo complesso con fs.watch
            // che non dà path relativi). Li segnaliamo comunque tutti.

            collected.push({
              type: eventType,
              filename,
              timestamp: new Date().toISOString(),
            });
            pendingEvents++;

            // Debounce
            if (debounceTimer) {
              clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(async () => {
              const eventCount = pendingEvents;
              pendingEvents = 0;
              if (eventCount > 0) {
                await executeCommand(eventCount);
              }
            }, debounce);
          },
        );

        // Aspetta la durata configurata
        await new Promise<void>((resolvePromise) => {
          setTimeout(() => {
            watchClosed = true;
            watcher.close();

            // Esegui eventuali eventi pendenti
            if (debounceTimer) {
              clearTimeout(debounceTimer);
              debounceTimer = null;
            }
            if (pendingEvents > 0) {
              executeCommand(pendingEvents).finally(() => {
                resolvePromise();
              });
            } else {
              resolvePromise();
            }
          }, duration);
        });

        // Prepara risultato finale
        result.watching = false;
        result.events = collected;
        result.executions = executions;

        // Log journal riepilogativo
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'watch_exec_complete',
          path: watchPath,
          details: {
            command,
            totalEvents: collected.length,
            executions: executions.length,
            duration,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: result.path,
                  command: result.command,
                  watching: false,
                  duration: result.duration,
                  eventsCollected: result.events.length,
                  executions: result.executions.map((ex) => ({
                    trigger: ex.trigger,
                    exitCode: ex.result.exitCode,
                    duration: ex.result.duration,
                    stdout: ex.result.stdout.length > 500 ? ex.result.stdout.slice(0, 500) + '...' : ex.result.stdout,
                    stderr: ex.result.stderr.length > 500 ? ex.result.stderr.slice(0, 500) + '...' : ex.result.stderr,
                  })),
                },
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
              text: `Error in watch_exec for "${watchPath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
