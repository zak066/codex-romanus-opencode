#!/usr/bin/env node
/**
 * scripts/clean-old-heartbeats.mjs
 *
 * Pulisce gli alias heartbeat vecchi dal database Tabularium.
 * Rimuove le entry con agent_name IN ('diana', 'vulcanus', 'iuppiter')
 * che sono stati sostituiti da nomi canonicali.
 *
 * Uso:
 *   node scripts/clean-old-heartbeats.mjs
 *
 * Migration associata: migrations/015-clean-old-heartbeat-aliases.sql
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// better-sqlite3 è un modulo CJS, usiamo createRequire
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = resolve(projectRoot, 'memory.db');
const OLD_ALIASES = ['diana', 'vulcanus', 'iuppiter'];

function main() {
  console.log(`🔧 Clean Old Heartbeat Aliases`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Aliases da rimuovere: ${OLD_ALIASES.join(', ')}`);
  console.log('');

  let db;
  try {
    db = new Database(DB_PATH);

    // Verifica che la tabella esista
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='agent_heartbeats'`
    ).get();

    if (!tableCheck) {
      console.log('⚠️  Tabella agent_heartbeats non trovata. Niente da pulire.');
      return;
    }

    // Conta quante righe verranno rimosse
    const countRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM agent_heartbeats WHERE agent_name IN (${OLD_ALIASES.map(() => '?').join(',')})`
    ).get(...OLD_ALIASES);

    const count = countRow ? countRow.cnt : 0;

    if (count === 0) {
      console.log('✅ Nessun alias vecchio trovato. Database già pulito.');
      return;
    }

    // Mostra le righe che verranno rimosse
    console.log(`📋 Entry da rimuovere (${count} totali):`);
    const rows = db.prepare(
      `SELECT agent_name, status, last_seen, current_task FROM agent_heartbeats
       WHERE agent_name IN (${OLD_ALIASES.map(() => '?').join(',')})`
    ).all(...OLD_ALIASES);

    for (const row of rows) {
      console.log(`   - ${row.agent_name}: status=${row.status}, last_seen=${row.last_seen}, task=${row.current_task ?? 'N/A'}`);
    }

    // Esegue la cancellazione in transazione
    const deleteStmt = db.prepare(
      `DELETE FROM agent_heartbeats WHERE agent_name IN (${OLD_ALIASES.map(() => '?').join(',')})`
    );

    const removeTransaction = db.transaction(() => {
      const info = deleteStmt.run(...OLD_ALIASES);
      return info.changes;
    });

    const removed = removeTransaction();

    console.log('');
    console.log(`✅ Pulizia completata: ${removed} righe rimosse`);
    console.log(`   Alias rimossi: ${OLD_ALIASES.join(', ')}`);

    // Verifica finale
    const remaining = db.prepare(
      `SELECT COUNT(*) AS cnt FROM agent_heartbeats WHERE agent_name IN (${OLD_ALIASES.map(() => '?').join(',')})`
    ).get(...OLD_ALIASES);

    if (remaining && remaining.cnt === 0) {
      console.log(`✅ Verifica: nessun alias residuo`);
    }

    // Mostra la situazione aggiornata
    console.log('');
    console.log('📊 Stato heartbeat attuale:');
    const allRows = db.prepare('SELECT agent_name, status, last_seen FROM agent_heartbeats ORDER BY agent_name').all();
    for (const row of allRows) {
      console.log(`   - ${row.agent_name}: ${row.status} (${row.last_seen})`);
    }

  } catch (err) {
    console.error('❌ Errore durante la pulizia:', err.message);
    process.exit(1);
  } finally {
    if (db) db.close();
  }
}

main();
