/**
 * progress-parser.ts
 * Parser per il file docs/codex-romanus/progress.md.
 * Tiene traccia dello stato di avanzamento dei task per agente.
 * Supporta qualsiasi numero di task e agenti — dinamico.
 *
 * @module core/progress-parser
 */

import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { Task, TaskList, TaskPriority, TaskStatus } from '../types/task.js';
import { progressCache } from './cache.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Path di default per docs/codex-romanus/progress.md. */
const DEFAULT_PROGRESS_PATH = path.resolve(process.cwd(), 'docs', 'codex-romanus', 'progress.md');

/** Regex per riconoscere una riga task nel markdown. */
const TASK_LINE_REGEX = /^-\s*\[([ xX!>-])\]\s*(.+?)(?:\s*@(\w[\w.-]*))?(?:\s*\[(high|medium|low)\])?\s*$/;

/** Regex per estrarre la data di ultimo aggiornamento. */
const UPDATED_REGEX = /Updated[:\s]+(\d{4}-\d{2}-\d{2}[T\s].*)/i;

// ---------------------------------------------------------------------------
// Funzioni interne (helpers)
// ---------------------------------------------------------------------------

/**
 * Controlla esistenza file (async).
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte il marker della checkbox in uno stato TaskStatus.
 *
 * | Marker | Status       |
 * |--------|--------------|
 * | spazio | pending      |
 * | x / X  | completed    |
 * | !      | blocked      |
 * | >      | in_progress  |
 * | -      | cancelled    |
 *
 * @param marker - Carattere dentro le parentesi quadre del checkbox
 * @returns TaskStatus corrispondente
 */
function markerToStatus(marker: string): TaskStatus {
  switch (marker) {
    case 'x':
    case 'X':
      return 'completed';
    case '!':
      return 'blocked';
    case '>':
      return 'in_progress';
    case '-':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Estrae i task dal contenuto markdown del file progress.md.
 * Formato atteso per ogni riga:
 *
 * ```
 * - [x] Descrizione task @nome-agente [priority]
 * ```
 *
 * @param content - Contenuto del file markdown
 * @returns Array di task parsati
 */
function extractTasksFromMarkdown(content: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const match = trimmed.match(TASK_LINE_REGEX);
    if (!match) continue;

    const [, marker, taskText, agent, priority] = match;
    const status = markerToStatus(marker.trim());

    tasks.push({
      agent: agent ?? 'unassigned',
      task: taskText.trim(),
      status,
      priority: (priority as TaskPriority) ?? 'medium',
    });
  }

  return tasks;
}

/**
 * Calcola il riepilogo dei task per stato.
 *
 * @param tasks - Array di task parsati
 * @returns Oggetto summary con conteggi per stato
 */
function computeSummary(tasks: Task[]): TaskList['summary'] {
  const summary: TaskList['summary'] = {
    total: tasks.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'pending':
        summary.pending++;
        break;
      case 'in_progress':
        summary.in_progress++;
        break;
      case 'completed':
        summary.completed++;
        break;
      case 'blocked':
        summary.blocked++;
        break;
      case 'cancelled':
        summary.cancelled++;
        break;
    }
  }

  return summary;
}

/**
 * Estrae la data di ultimo aggiornamento dal contenuto del file.
 * Cerca una riga tipo `Updated: 2024-01-15 10:30:00`.
 *
 * @param content - Contenuto del file markdown
 * @returns Data ISO o undefined
 */
function extractLastUpdated(content: string): string | undefined {
  const match = content.match(UPDATED_REGEX);
  if (!match) return undefined;

  // Normalizza: rimpiazza spazio tra data e ora con T per ISO
  const raw = match[1].trim();
  return raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Carica e parsa il file docs/codex-romanus/progress.md.
 * Restituisce la lista dei task con riepilogo e timestamp.
 * Se il file non esiste, restituisce una lista vuota (non lancia errore).
 *
 * Utilizza cache in-memory con TTL di 30 secondi.
 *
 * @param filePath - Percorso alternativo a progress.md (opzionale)
 * @returns TaskList con tasks, updatedAt e summary
 *
 * @example
 * ```ts
 * const taskList = await parseProgress();
 * console.log(taskList.summary);
 * ```
 */
export async function parseProgress(filePath?: string): Promise<TaskList> {
  const resolvedPath = filePath ?? DEFAULT_PROGRESS_PATH;

  // Cache check
  const cacheKey = `progress:${resolvedPath}`;
  const cached = progressCache.get(cacheKey) as TaskList | undefined;
  if (cached) return cached;

  try {
    const exists = await fileExists(resolvedPath);
    if (!exists) {
      const empty: TaskList = {
        tasks: [],
        updatedAt: new Date().toISOString(),
        summary: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, cancelled: 0 },
      };
      progressCache.set(cacheKey, empty);
      return empty;
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const tasks = extractTasksFromMarkdown(content);
    const summary = computeSummary(tasks);
    const updatedAt = extractLastUpdated(content) ?? new Date().toISOString();

    const result: TaskList = { tasks, updatedAt, summary };
    progressCache.set(cacheKey, result);

    return result;
  } catch (err) {
    throw new Error(
      `Failed to parse progress file at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/**
 * Ottiene solo il riepilogo dei task, più leggero della lista completa.
 *
 * @param filePath - Percorso alternativo a progress.md (opzionale)
 * @returns Solo summary e updatedAt
 *
 * @example
 * ```ts
 * const { summary, updatedAt } = await getProgressSummary();
 * ```
 */
export async function getProgressSummary(filePath?: string): Promise<{
  summary: TaskList['summary'];
  updatedAt: string;
}> {
  const taskList = await parseProgress(filePath);
  return { summary: taskList.summary, updatedAt: taskList.updatedAt };
}

/**
 * Restituisce i task filtrati per agente.
 *
 * @param agentName - Nome dell'agente
 * @param filePath - Percorso alternativo a progress.md (opzionale)
 * @returns Task filtrati per l'agente specificato
 */
export async function getTasksByAgent(
  agentName: string,
  filePath?: string
): Promise<Task[]> {
  const taskList = await parseProgress(filePath);
  return taskList.tasks.filter((t) => t.agent === agentName);
}

/**
 * Restituisce i task filtrati per stato.
 *
 * @param status - Stato del task da filtrare
 * @param filePath - Percorso alternativo a progress.md (opzionale)
 * @returns Task con lo stato specificato
 */
export async function getTasksByStatus(
  status: TaskStatus,
  filePath?: string
): Promise<Task[]> {
  const taskList = await parseProgress(filePath);
  return taskList.tasks.filter((t) => t.status === status);
}
