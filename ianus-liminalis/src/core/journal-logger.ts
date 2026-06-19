/**
 * Journal Logger — Ianus Liminalis
 *
 * Helper per scrivere eventi nel file journal JSONL.
 * Il journal è salvato in {workspaceRoot}/.ianus-journal/journal.jsonl.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const JOURNAL_DIR = '.ianus-journal';
const JOURNAL_FILE = 'journal.jsonl';

export interface JournalEntry {
  id: string;
  timestamp: string;
  agent: string;
  operation: string;
  path: string;
  details?: Record<string, unknown>;
}

/**
 * Scrive una riga JSONL nel file journal.
 * Crea la directory .ianus-journal se non esiste.
 */
export async function logToJournal(
  workspaceRoot: string,
  entry: Omit<JournalEntry, 'id' | 'timestamp'>,
): Promise<void> {
  const dir = join(workspaceRoot, JOURNAL_DIR);
  const file = join(dir, JOURNAL_FILE);
  await mkdir(dir, { recursive: true });
  const line =
    JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    }) + '\n';
  await appendFile(file, line, 'utf-8');
}
