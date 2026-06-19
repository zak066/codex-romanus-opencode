/**
 * Structured logger for MCP server.
 *
 * Writes JSON-formatted log lines to stderr (safe for stdio MCP transport).
 * Never writes to stdout, which would break the MCP protocol.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = 'info';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

/**
 * Set the minimum log level. Messages below this level are suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Log a structured message to stderr.
 *
 * @param level - Severity level
 * @param message - Human-readable message
 * @param meta - Optional structured metadata (JSON-serializable)
 */
export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) {
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  };

  // Always write to stderr — stdout is reserved for MCP protocol
  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * Convenience methods for each log level.
 */

export function error(message: string, meta?: Record<string, unknown>): void {
  log('error', message, meta);
}

export function warn(message: string, meta?: Record<string, unknown>): void {
  log('warn', message, meta);
}

export function info(message: string, meta?: Record<string, unknown>): void {
  log('info', message, meta);
}

export function debug(message: string, meta?: Record<string, unknown>): void {
  log('debug', message, meta);
}
