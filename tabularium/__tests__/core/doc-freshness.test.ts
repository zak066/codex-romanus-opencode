/**
 * __tests__/core/doc-freshness.test.ts
 * Test per core/doc-freshness.ts
 *
 * Verifica:
 * - Scansione ricorsiva di .md e .ts
 * - Matching per stem (nome base senza estensione)
 * - Calcolo punteggio
 * - Determinazione stato (fresh/stale/missing)
 * - Report aggregato
 */

import * as fs from 'fs';
import * as path from 'path';
import { analyzeDocFreshness } from '../../src/core/doc-freshness.js';

// ──────────────────────────────────────────────
//  Helper: crea struttura temporanea per i test
// ──────────────────────────────────────────────

interface TestFile {
  /** Percorso relativo (es. 'docs/guida.md' o 'src/core/modulo.ts') */
  relPath: string;
  /** Contenuto del file */
  content?: string;
  /** Timestamp opzionale per mtime */
  mtime?: Date;
}

/**
 * Crea una struttura di directory e file temporanea per i test.
 * Restituisce il path della root temporanea.
 */
function createTestStructure(files: TestFile[]): string {
  const tmpDir = path.resolve(
    __dirname,
    '..',
    '..',
    'tmp',
    `doc-freshness-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  for (const file of files) {
    const fullPath = path.join(tmpDir, file.relPath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, file.content ?? '', 'utf-8');

    if (file.mtime) {
      fs.utimesSync(fullPath, file.mtime, file.mtime);
    }
  }

  return tmpDir;
}

/**
 * Pulisce la struttura temporanea.
 */
function cleanupTestStructure(tmpDir: string): void {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Crea un file con un timestamp specifico.
 */
function createFileWithMtime(
  dir: string,
  relPath: string,
  mtime: Date,
  content?: string
): void {
  const fullPath = path.join(dir, relPath);
  const parent = path.dirname(fullPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(fullPath, content ?? '', 'utf-8');
  fs.utimesSync(fullPath, mtime, mtime);
}

// ──────────────────────────────────────────────
//  Suite di test
// ──────────────────────────────────────────────

describe('DocFreshness', () => {
  afterEach(() => {
    // Pulisci tmp dopo ogni test
    const tmpRoot = path.resolve(__dirname, '..', '..', 'tmp');
    if (fs.existsSync(tmpRoot)) {
      const entries = fs.readdirSync(tmpRoot);
      for (const entry of entries) {
        const full = path.join(tmpRoot, entry);
        if (fs.statSync(full).isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    }
  });

  // =============================================
  //  Test: struttura vuota
  // =============================================

  it('restituisce report vuoto se docsDir e srcDir non esistono', () => {
    const report = analyzeDocFreshness(
      './path-inesistente/docs',
      './path-inesistente/src'
    );

    expect(report).toBeDefined();
    expect(report.totalDocs).toBe(0);
    expect(report.freshCount).toBe(0);
    expect(report.staleCount).toBe(0);
    expect(report.missingCount).toBe(0);
    expect(report.overallScore).toBe(100);
    expect(report.generatedAt).toBeDefined();
    expect(report.entries).toEqual([]);
  });

  // =============================================
  //  Test: matching per stem
  // =============================================

  it('associa .md a .ts per stem (nome base senza estensione)', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/api/endpoints.md',
        content: '# API Endpoints',
        mtime: twoDaysAgo, // 2 giorni fa
      },
      {
        relPath: 'src/api/endpoints.ts',
        content: 'export function get() {}',
        mtime: twoDaysAgo, // stessa data
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.totalDocs).toBe(1);
      expect(report.entries[0].status).toBe('fresh');
      expect(report.entries[0].score).toBeGreaterThanOrEqual(90);
      expect(report.entries[0].sourceFiles).toHaveLength(1);
      expect(report.entries[0].sourceFiles[0].path).toContain('endpoints.ts');
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: documentazione fresca (< 7 giorni)
  // =============================================

  it('classifica come fresh un .md aggiornato meno di 7 giorni fa', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/guida.md',
        content: '# Guida',
        mtime: threeDaysAgo,
      },
      {
        relPath: 'src/guida.ts',
        content: '// codice',
        mtime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 giorni fa, più vecchio
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.totalDocs).toBe(1);
      expect(report.entries[0].status).toBe('fresh');
      expect(report.freshCount).toBe(1);
      expect(report.staleCount).toBe(0);
      expect(report.missingCount).toBe(0);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: documentazione stantia (7-30 giorni)
  // =============================================

  it('classifica come stale un .md aggiornato 7-30 giorni fa', () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000
    );

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/modulo.md',
        content: '# Modulo',
        mtime: fourteenDaysAgo,
      },
      {
        relPath: 'src/modulo.ts',
        content: 'export function foo() {}',
        mtime: fourteenDaysAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.entries[0].status).toBe('stale');
      expect(report.staleCount).toBe(1);
      expect(report.freshCount).toBe(0);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: documentazione mancante
  // =============================================

  it('classifica come missing se non esiste .md corrispondente', () => {
    const now = new Date();
    const tmpDir = createTestStructure([
      {
        relPath: 'src/core/utils.ts',
        content: 'export function util() {}',
        mtime: now,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      // Dovrebbe esserci un entry per utils (stem "utils" ha .ts ma no .md)
      const missingEntry = report.entries.find(
        (e) => e.status === 'missing'
      );
      expect(missingEntry).toBeDefined();
      expect(missingEntry!.filePath).toContain('utils.md');
      expect(report.missingCount).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: .md più vecchio del .ts → stale
  // =============================================

  it('classifica stale se .ts è più recente del .md corrispondente', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/api.md',
        content: '# API',
        mtime: twoDaysAgo, // 2 giorni fa → fresh per età
      },
      {
        relPath: 'src/api.ts',
        content: 'export function newFeature() {}',
        mtime: oneHourAgo, // 1 ora fa → più recente del .md
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      // .md ha solo 2 giorni (< 7), ma .ts è più recente → stale
      expect(report.entries[0].status).toBe('stale');
      expect(report.entries[0].score).toBeGreaterThanOrEqual(70);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: punteggio 100 se mtime < 7 giorni
  // =============================================

  it('calcola punteggio 100 se aggiornato meno di 7 giorni fa', () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/perfetto.md',
        content: '# Perfetto',
        mtime: oneDayAgo,
      },
      {
        relPath: 'src/perfetto.ts',
        content: '// code',
        mtime: oneDayAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.entries[0].score).toBe(100);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: punteggio scalato con penalty
  // =============================================

  it('penalizza il punteggio di 10 punti ogni 7 giorni', () => {
    const now = new Date();
    // 15 giorni fa → 2 periodi completi di 7 giorni → 100 - 20 = 80
    const fifteenDaysAgo = new Date(
      now.getTime() - 15 * 24 * 60 * 60 * 1000
    );

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/vecchio.md',
        content: '# Vecchio',
        mtime: fifteenDaysAgo,
      },
      {
        relPath: 'src/vecchio.ts',
        content: '// code',
        mtime: fifteenDaysAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      // 15 giorni / 7 = 2 periodi → 100 - 20 = 80
      expect(report.entries[0].score).toBe(80);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: punteggio minimo 0
  // =============================================

  it('non scende sotto 0 come punteggio minimo', () => {
    const now = new Date();
    // 1000 giorni fa → molti periodi → sottozero, ma min 0
    const longAgo = new Date(
      now.getTime() - 1000 * 24 * 60 * 60 * 1000
    );

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/antico.md',
        content: '# Antico',
        mtime: longAgo,
      },
      {
        relPath: 'src/antico.ts',
        content: '// code',
        mtime: longAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.entries[0].score).toBe(0);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: .md > 30 giorni senza aggiornamenti → missing
  // =============================================

  it('classifica come missing se .md ha più di 30 giorni', () => {
    const now = new Date();
    const fortyDaysAgo = new Date(
      now.getTime() - 40 * 24 * 60 * 60 * 1000
    );

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/abbandonato.md',
        content: '# Abbandonato',
        mtime: fortyDaysAgo,
      },
      {
        relPath: 'src/abbandonato.ts',
        content: '// code',
        mtime: fortyDaysAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.entries[0].status).toBe('missing');
      // 40/7 = 5 periodi → 100 - 50 = 50
      expect(report.entries[0].score).toBe(50);
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: multiple source files
  // =============================================

  it('gestisce più file .ts per lo stesso .md', () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const tmpDir = createTestStructure([
      {
        relPath: 'docs/api.md',
        content: '# API',
        mtime: oneDayAgo,
      },
      {
        relPath: 'src/api.ts',
        content: '// main',
        mtime: oneDayAgo,
      },
      {
        relPath: 'src/api-helpers.ts',
        content: '// helpers',
        mtime: oneDayAgo,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      // "api" matcherà sia `api.ts` che `api-helpers.ts` tramite stem
      // `api-helpers` ha stem diverso da `api`, quindi non matcha
      const apiEntry = report.entries.find(
        (e) =>
          e.filePath.includes('api.md') &&
          !e.filePath.includes('api-helpers')
      );

      // api e api-helpers sono stem diversi, quindi dovrebbero essere
      // entries separate
      const helpersEntry = report.entries.find(
        (e) => e.filePath.includes('api-helpers')
      );

      expect(apiEntry).toBeDefined();
      expect(apiEntry!.sourceFiles).toHaveLength(1);
      expect(apiEntry!.sourceFiles[0].path).toContain('api.ts');
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: report aggregato
  // =============================================

  it('calcola correttamente le statistiche aggregate', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(
      now.getTime() - 15 * 24 * 60 * 60 * 1000
    );
    const fortyDaysAgo = new Date(
      now.getTime() - 40 * 24 * 60 * 60 * 1000
    );

    const tmpDir = createTestStructure([
      // fresh
      {
        relPath: 'docs/fresco.md',
        content: '# Fresco',
        mtime: twoDaysAgo,
      },
      {
        relPath: 'src/fresco.ts',
        content: '// code',
        mtime: twoDaysAgo,
      },
      // stale
      {
        relPath: 'docs/stantio.md',
        content: '# Stantio',
        mtime: fifteenDaysAgo,
      },
      {
        relPath: 'src/stantio.ts',
        content: '// code',
        mtime: fifteenDaysAgo,
      },
      // missing (>30gg)
      {
        relPath: 'docs/mancante.md',
        content: '# Mancante',
        mtime: fortyDaysAgo,
      },
      {
        relPath: 'src/mancante.ts',
        content: '// code',
        mtime: fortyDaysAgo,
      },
      // nessun .md
      {
        relPath: 'src/orfano.ts',
        content: 'export function orphan() {}',
        mtime: now,
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      expect(report.totalDocs).toBe(4); // fresco + stantio + mancante + orfano
      expect(report.freshCount).toBe(1);
      expect(report.staleCount).toBe(1);
      expect(report.missingCount).toBe(2); // mancante (>30gg) + orfano (nessun .md)
      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
      expect(report.generatedAt).toBeDefined();
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });

  // =============================================
  //  Test: file .md senza .ts corrispondente
  // =============================================

  it('include .md senza .ts corrispondente come entry con sourceFiles vuoto', () => {
    const now = new Date();
    const tmpDir = createTestStructure([
      {
        relPath: 'docs/readme.md',
        content: '# README',
        mtime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ]);

    try {
      const report = analyzeDocFreshness(
        path.join(tmpDir, 'docs'),
        path.join(tmpDir, 'src')
      );

      const mdOnlyEntry = report.entries.find(
        (e) => e.filePath.includes('readme.md')
      );
      expect(mdOnlyEntry).toBeDefined();
      expect(mdOnlyEntry!.sourceFiles).toHaveLength(0);
      expect(mdOnlyEntry!.status).toBe('fresh');
    } finally {
      cleanupTestStructure(tmpDir);
    }
  });
});
