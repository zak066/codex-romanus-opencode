/**
 * core/memory-migrator.ts
 * Migrazione one-shot dai file Markdown (docs/codex-romanus/progress.md e decisions.md)
 * al database SQLite.
 *
 * Il migrator:
 * 1. Crea backup dei file originali in tabularium/backups/markdown-import-<timestamp>/
 * 2. Legge progress.md e crea una sessione fittizia "import" con eventi
 * 3. Legge decisions.md e popola decision_rationale
 *
 * @module core/memory-migrator
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './database.js';
import { createSession, closeSession } from './db-sessions.js';
import { insertEvent } from './db-events.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Directory dei file docs/codex-romanus */
const DEV_TEAM_DIR = path.resolve(process.cwd(), '..', 'docs', 'codex-romanus');

/** Directory dei backup */
const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risultato della migrazione */
export interface MigrationResult {
  sessionsImported: number;
  eventsImported: number;
  contextsImported: number;
}

// ---------------------------------------------------------------------------
// Migrator
// ---------------------------------------------------------------------------

/**
 * Esegue la migrazione dai file Markdown al database SQLite.
 *
 * Crea backup automatici dei file originali prima di procedere.
 * Crea una sessione fittizia 'import-<timestamp>' e popola eventi e decision_rationale.
 *
 * @returns Risultato della migrazione con conteggi
 * @throws Error se il database non è inizializzato
 */
export async function migrateFromMarkdown(): Promise<MigrationResult> {
  const db = getDatabase();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionId = `import-${timestamp}`;

  const result: MigrationResult = {
    sessionsImported: 0,
    eventsImported: 0,
    contextsImported: 0,
  };

  console.error(`[memory-migrator] Starting markdown import at ${timestamp}`);

  // Verifica esistenza directory docs/codex-romanus
  if (!fs.existsSync(DEV_TEAM_DIR)) {
    console.error(`[memory-migrator] docs/codex-romanus directory not found at ${DEV_TEAM_DIR}, skipping import`);
    return result;
  }

  // Crea backup directory
  const backupDir = path.join(BACKUPS_DIR, `markdown-import-${timestamp}`);
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  fs.mkdirSync(backupDir, { recursive: true });
  console.error(`[memory-migrator] Backup directory created: ${backupDir}`);

  // Backup dei file
  const filesToBackup = ['progress.md', 'decisions.md', 'planning.md'];
  for (const file of filesToBackup) {
    const srcPath = path.join(DEV_TEAM_DIR, file);
    if (fs.existsSync(srcPath)) {
      const destPath = path.join(backupDir, file);
      fs.copyFileSync(srcPath, destPath);
      console.error(`[memory-migrator] Backed up: ${file} -> ${backupDir}`);
    }
  }

  // Esegui la migrazione in una transazione
  const runImport = db.transaction(() => {
    // 1. Importa progress.md
    const progressPath = path.join(DEV_TEAM_DIR, 'progress.md');
    if (fs.existsSync(progressPath)) {
      const progressContent = fs.readFileSync(progressPath, 'utf-8');
      const importResult = importProgressToEvents(db, sessionId, progressContent);
      result.eventsImported += importResult.eventsCount;
      result.contextsImported += importResult.contextsCount;
      result.sessionsImported += 1;
    }

    // 2. Importa decisions.md
    const decisionsPath = path.join(DEV_TEAM_DIR, 'decisions.md');
    if (fs.existsSync(decisionsPath)) {
      const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8');
      const adrCount = importDecisionsToRationale(db, decisionsContent);
      result.eventsImported += adrCount;
    }

    // 3. Importa planning.md come contesto
    const planningPath = path.join(DEV_TEAM_DIR, 'planning.md');
    if (fs.existsSync(planningPath)) {
      const planningContent = fs.readFileSync(planningPath, 'utf-8');
      importPlanningToContext(db, sessionId, planningContent);
      result.contextsImported += 1;
    }
  });

  try {
    runImport();
    console.error(`[memory-migrator] Import completed successfully`);
    console.error(
      `[memory-migrator] Sessions: ${result.sessionsImported}, Events: ${result.eventsImported}, Contexts: ${result.contextsImported}`
    );
  } catch (err) {
    console.error(`[memory-migrator] Import failed:`, err);
    throw new Error(
      `Markdown import failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Funzioni di import specifiche
// ---------------------------------------------------------------------------

/**
 * Importa il contenuto di progress.md in eventi di sessione.
 * Ogni riga di task viene convertita in un evento.
 */
function importProgressToEvents(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  content: string
): { eventsCount: number; contextsCount: number } {
  let eventsCount = 0;
  let contextsCount = 0;

  // Crea la sessione di import usando sessionId passato
  db.prepare(`
    INSERT INTO sessions (id, agent_name, start_time, focus, status, metadata)
    VALUES (?, 'system', ?, 'import', 'completed', ?)
  `).run(sessionId, new Date().toISOString(), JSON.stringify({ importType: 'markdown', source: 'progress.md' }));

  // Salva il contenuto completo come contesto
  db.prepare(`
    INSERT INTO contexts (id, session_id, agent_name, created_at, context_type, content, source)
    VALUES (?, ?, 'system', ?, 'session_start', ?, 'file')
  `).run(
    `ctx_import_progress_${randomUUID().replace(/-/g, '').substring(0, 6)}`,
    sessionId,
    new Date().toISOString(),
    content
  );
  contextsCount++;

  // Parso le righe per trovare task
  const lines = content.split('\n');
  let currentAgent = 'system';

  for (const line of lines) {
    // Riconosce header di agente: "### agent-name | ..."
    const agentMatch = line.match(/^###\s+(\S+)/);
    if (agentMatch) {
      currentAgent = agentMatch[1];
      continue;
    }

    // Riconosce righe di task: `- [status] description (@agent)`
    const taskMatch = line.match(/^-\s+\[(\w+)\]\s+(.+?)(?:\s+\(@(\S+)\))?\s*$/);
    if (taskMatch) {
      const status = taskMatch[1];
      const description = taskMatch[2];
      const taskAgent = taskMatch[3] ?? currentAgent;

      // Mappa status markdown a event_type
      let eventType: string;
      switch (status) {
        case 'x':
        case 'done':
          eventType = 'task_completed';
          break;
        case 'failed':
          eventType = 'task_failed';
          break;
        case '-':
        case 'in_progress':
          eventType = 'task_started';
          break;
        default:
          eventType = 'task_started';
      }

      db.prepare(`
        INSERT INTO events (id, session_id, timestamp, agent_name, event_type, summary, details, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `evt_import_${randomUUID().replace(/-/g, '').substring(0, 6)}`,
        sessionId,
        new Date().toISOString(),
        taskAgent,
        eventType,
        description.substring(0, 280),
        JSON.stringify({ status, source: 'markdown-import' }),
        JSON.stringify(['import', 'progress'])
      );
      eventsCount++;
    }
  }

  // Chiudi la sessione
  db.prepare(`
    UPDATE sessions SET end_time = ?, status = 'completed'
    WHERE id = ?
  `).run(new Date().toISOString(), sessionId);

  return { eventsCount, contextsCount };
}

/**
 * Importa decisioni da decisions.md in decision_rationale.
 */
function importDecisionsToRationale(
  db: ReturnType<typeof getDatabase>,
  content: string
): number {
  let count = 0;

  // Parso le righe per trovare ADR
  const lines = content.split('\n');
  let currentAdrId = '';
  let currentTitle = '';
  let currentDecision = '';
  let currentMotivation = '';
  const currentAgent = 'system';
  let inDecision = false;
  let inMotivation = false;

  for (const line of lines) {
    // Riconosce ADR header: "## ADR-XXX: Title"
    const adrHeader = line.match(/^##\s+(ADR-\d+):\s*(.*)/i);
    if (adrHeader) {
      // Salva ADR precedente
      if (currentAdrId) {
        insertAdrRationale(db, currentAdrId, currentTitle, currentDecision, currentMotivation, currentAgent);
        count++;
      }

      currentAdrId = adrHeader[1].toUpperCase();
      currentTitle = adrHeader[2];
      currentDecision = '';
      currentMotivation = '';
      inDecision = false;
      inMotivation = false;
      continue;
    }

    // Riconosce "**Decisione:**"
    if (line.includes('**Decisione:**') || line.includes('**Decision:**')) {
      inDecision = true;
      inMotivation = false;
      currentDecision = line.replace(/\*\*Decisione?:\*\*\s*/, '').trim();
      continue;
    }

    // Riconosce "**Motivazione:**"
    if (line.includes('**Motivazione:**') || line.includes('**Motivation:**')) {
      inDecision = false;
      inMotivation = true;
      currentMotivation = line.replace(/\*\*Motivazionee?:\*\*\s*/, '').trim();
      continue;
    }

    if (inDecision && line.trim()) {
      currentDecision += ' ' + line.trim();
    }

    if (inMotivation && line.trim()) {
      currentMotivation += ' ' + line.trim();
    }
  }

  // Salva ultimo ADR
  if (currentAdrId) {
    insertAdrRationale(db, currentAdrId, currentTitle, currentDecision, currentMotivation, currentAgent);
    count++;
  }

  return count;
}

/**
 * Inserisce un record in decision_rationale.
 */
function insertAdrRationale(
  db: ReturnType<typeof getDatabase>,
  adrId: string,
  title: string,
  decision: string,
  motivation: string,
  agent: string
): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO decision_rationale (id, adr_id, created_at, agent_name, alternatives, tradeoffs, metrics, notes)
      VALUES (?, ?, ?, ?, '[]', '[]', '{}', ?)
    `).run(
      `adr_${adrId.toLowerCase().replace(/-/g, '_')}`,
      adrId,
      new Date().toISOString(),
      agent,
      `Titolo: ${title}\nDecisione: ${decision}\nMotivazione: ${motivation}`.trim()
    );
  } catch (err) {
    console.error(`[memory-migrator] Error inserting ADR ${adrId}:`, err);
  }
}

/**
 * Importa planning.md come contesto di sessione.
 */
function importPlanningToContext(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  content: string
): void {
  db.prepare(`
    INSERT INTO contexts (id, session_id, agent_name, created_at, context_type, content, source)
    VALUES (?, ?, 'system', ?, 'session_start', ?, 'file')
  `).run(
    `ctx_planning_${randomUUID().replace(/-/g, '').substring(0, 8)}`,
    sessionId,
    new Date().toISOString(),
    content
  );
}
