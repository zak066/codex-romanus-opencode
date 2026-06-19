/**
 * Resource: ianus://journal
 *
 * Espone le ultime 100 entry del journal JSONL in formato JSON.
 */

import type { ToolDeps } from '../tools/types.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResourceHandler } from './ianus-files.js';
import type { JournalEntry } from '../core/journal-logger.js';

const JOURNAL_DIR = '.ianus-journal';
const JOURNAL_FILE = 'journal.jsonl';
const MAX_ENTRIES = 100;

export const journalResourceHandler: ResourceHandler = {
  uriTemplate: 'ianus://journal',
  name: 'Journal log',
  description: 'Ultime 100 entry del journal operativo',

  match(uri: string): string | null {
    return uri === 'ianus://journal' ? '' : null;
  },

  async read(uri: string, deps: ToolDeps) {
    const journalPath = join(deps.workspaceRoot, JOURNAL_DIR, JOURNAL_FILE);

    let entries: JournalEntry[] = [];
    try {
      const raw = await readFile(journalPath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      entries = lines
        .map((line) => {
          try {
            return JSON.parse(line) as JournalEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is JournalEntry => e !== null);
    } catch {
      // Journal file doesn't exist — return empty
    }

    entries.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const recent = entries.slice(0, MAX_ENTRIES);

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ entries: recent, total: recent.length }, null, 2),
    };
  },
};
