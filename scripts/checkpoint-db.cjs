#!/usr/bin/env node
/**
 * scripts/checkpoint-db.cjs
 *
 * Forces checkpoint of SQLite WAL journal into the main database file.
 * Run BEFORE git commit to prevent data loss when memory.db-wal
 * has uncheckpointed transactions.
 *
 * Usage: node scripts/checkpoint-db.cjs
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', 'tabularium', 'memory.db');

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[checkpoint-db] \u2139\ufe0f  Database not found: ${DB_PATH}`);
    return 0;
  }

  let db;
  try {
    // Resolve better-sqlite3 from tabularium/node_modules/
    // (the monorepo layout keeps dependencies there)
    const betterSqlite3Path = path.resolve(__dirname, '..', 'tabularium', 'node_modules', 'better-sqlite3');
    if (!fs.existsSync(betterSqlite3Path)) {
      console.error(`[checkpoint-db] \u274c better-sqlite3 not found at ${betterSqlite3Path}`);
      console.error(`[checkpoint-db] \u2139\ufe0f  Run: cd tabularium && npm install`);
      return 1;
    }

    const Database = require(betterSqlite3Path);
    db = new Database(DB_PATH);

    // PRAGMA wal_checkpoint returns: [busy, log, checkpointed]
    // - busy: 0 = OK, 1 = checkpoint was blocked by another connection
    // - log: total pages in WAL
    // - checkpointed: pages transferred to main DB
    // First try PASSIVE checkpoint (won't block if database is in use)
    // If Tabularium is running, PASSIVE may not full-checkpoint, so we continue
    // to TRUNCATE which forces a full checkpoint when no other connection is active.
    let [row] = db.pragma('wal_checkpoint(PASSIVE)');
    if (row.busy === 0 && row.log === row.checkpointed) {
      // PASSIVE was sufficient
    } else {
      // Try TRUNCATE for full checkpoint
      [row] = db.pragma('wal_checkpoint(TRUNCATE)');
    }
    const busy = row.busy;
    const log = row.log;
    const checkpointed = row.checkpointed;

    if (busy === 0 && checkpointed === log && log > 0) {
      console.log(`[checkpoint-db] \u2705 WAL fully checkpointed: ${checkpointed} pages flushed to memory.db`);
    } else if (busy === 0 && log === 0) {
      console.log(`[checkpoint-db] \u2139\ufe0f  No WAL to checkpoint (database is clean)`);
    } else if (busy === 0 && checkpointed < log) {
      console.log(`[checkpoint-db] \u26a0\ufe0f  Partial checkpoint: ${checkpointed}/${log} pages`);
    } else if (busy === 1) {
      console.log(`[checkpoint-db] \u26a0\ufe0f  Checkpoint blocked by another connection (${checkpointed}/${log} pages checkpointed)`);
    } else if (busy === 2) {
      console.log(`[checkpoint-db] \u274c Checkpoint failed: database in WAL mode but no checkpoint possible`);
    }

    db.close();
    return 0;
  } catch (err) {
    // Ensure db is closed on error
    if (db) {
      try { db.close(); } catch (_) { /* ignore close errors during cleanup */ }
    }
    console.error(`[checkpoint-db] \u274c Error: ${err.message}`);
    return 1;
  }
}

const code = main();
process.exit(code);
