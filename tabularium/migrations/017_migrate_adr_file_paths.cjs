/**
 * migrations/017_migrate_adr_file_paths.cjs
 * Popola la colonna file_path per le ADR esistenti nel database.
 * Eseguire DOPO la migration 016 (aggiunta colonna file_path).
 *
 * ADR-035: dynamic file_path in adr_status — elimina mappa statica adr-content.ts
 */

const Database = require('better-sqlite3');
const path = require('path');

// Percorso corretto: risali da migrations/ a tabularium/
const DB_PATH = path.resolve(__dirname, '..', 'memory.db');

console.log('');
console.log('===========================================');
console.log('  Tabularium — ADR-035 File Path Migration');
console.log('===========================================');
console.log(`[DB] ${DB_PATH}`);
console.log('');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const FILE_PATHS = {
  'adr_005': 'docs/adr/adr-005-arae.md',
  'adr_006': 'docs/adr/adr-006-advisory.md',
  'adr_007': 'docs/adr/adr-007-memoria.md',
  'adr_008': 'docs/adr/adr-008-web-search.md',
  'adr_009': 'docs/adr/adr-009-filesystem-mcp.md',
  'adr_010': 'docs/adr/adr-010-metrics-engine.md',
  'adr_011': 'docs/adr/adr-011-automata.md',
  'adr_012': 'docs/adr/adr-012-adr-lifecycle.md',
  'adr_013': 'docs/adr/adr-013-design-tokens.md',
  'adr_014': 'docs/adr/adr-014-a11y-audit.md',
  'adr_015': 'docs/adr/adr-015-seo-builder.md',
  'adr_016': 'docs/adr/adr-016-secret-scanner.md',
  'adr_017': 'docs/adr/adr-017-sbom-tracker.md',
  'adr_018': 'docs/adr/adr-018-doc-freshness.md',
  'adr_019': 'docs/adr/adr-019-incident-manager.md',
  'adr_020': 'docs/archive/RIORGANIZZAZIONE-PIANO.md',
  'adr_021': 'docs/adr/adr-021-integration.md',
  'adr_022': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_023': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_024': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_025': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_026': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_028': 'docs/archive/NUNTIUS-ARCHITETTURA.md',
  'adr_029': 'docs/archive/TABULARIUM-MESSAGING-DESIGN.md',
  'adr_030': 'docs/archive/TABULARIUM-KNOWLEDGE-GRAPH-DESIGN.md',
  'adr_031': 'docs/archive/TABULARIUM-DASHBOARD-DESIGN.md',
  'adr_032': 'docs/adr/adr-032-retention-policy.md',
  'adr_033': 'docs/adr/adr-033-deprecate-speculum.md',
  'adr_034': 'docs/adr/adr-034-deprecate-sevenmau.md',
};

const updateStmt = db.prepare('UPDATE adr_status SET file_path = ? WHERE id = ?');

let updated = 0;
let skipped = 0;

const transaction = db.transaction(() => {
  for (const [adrId, filePath] of Object.entries(FILE_PATHS)) {
    const result = updateStmt.run(filePath, adrId);
    if (result.changes > 0) {
      console.log(`[+] ${adrId} → ${filePath}`);
      updated++;
    } else {
      console.log(`[~] ${adrId} → skipped (already set or not found)`);
      skipped++;
    }
  }
});

try {
  transaction();
} catch (err) {
  console.error('[ERROR]', err.message);
  process.exit(1);
}

// Verifica
console.log('');
console.log('--- Verifica ---');
const check = db.prepare('SELECT id, title, file_path FROM adr_status WHERE file_path IS NOT NULL').all();
console.log(`ADR con file_path popolato: ${check.length}`);
console.log('');
check.forEach(row => {
  console.log(`  ${row.id}: ${row.file_path}`);
});

// Report finale
console.log('');
console.log('===========================================');
console.log(`  Aggiornati: ${updated} | Saltati: ${skipped}`);
console.log('===========================================');

db.close();