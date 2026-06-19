/**
 * core/doc-freshness.ts
 * Analizza la freschezza della documentazione confrontando i file .md in docs/
 * con i file .ts in src/. Per ogni documento calcola un punteggio (0-100) basato
 * sulla data dell'ultima modifica e sul suo ritardo rispetto ai sorgenti.
 *
 * @module core/doc-freshness
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export interface SourceFileInfo {
  path: string;
  lastModified: string;
}

export type DocStatus = 'fresh' | 'stale' | 'missing';

export interface DocFreshnessEntry {
  /** Percorso del file di documentazione (.md) */
  filePath: string;
  /** Data ISO dell'ultima modifica del file .md */
  lastModified: string;
  /** File sorgente (.ts) associati */
  sourceFiles: SourceFileInfo[];
  /** Stato: fresh (<7gg), stale (7-30gg), missing (>30gg o nessun .md) */
  status: DocStatus;
  /** Giorni dall'ultimo aggiornamento del .md */
  daysSinceUpdate: number;
  /** Punteggio 0-100 */
  score: number;
}

export interface DocFreshnessReport {
  entries: DocFreshnessEntry[];
  totalDocs: number;
  freshCount: number;
  staleCount: number;
  missingCount: number;
  overallScore: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Soglia in giorni per considerare un documento fresh (0-6) */
const FRESH_THRESHOLD_DAYS = 7;

/** Soglia in giorni per considerare un documento stale (7-30) */
const STALE_THRESHOLD_DAYS = 30;

/** Penalità in punti per ogni periodo di 7 giorni di ritardo */
const PENALTY_PER_PERIOD = 10;

/** Periodo base per il calcolo della penalità (7 giorni) */
const PENALTY_PERIOD_DAYS = 7;

/** Punteggio massimo */
const MAX_SCORE = 100;

/** Punteggio minimo */
const MIN_SCORE = 0;

// ---------------------------------------------------------------------------
// Funzioni interne
// ---------------------------------------------------------------------------

/**
 * Scansiona ricorsivamente una directory alla ricerca di file con determinate
 * estensioni. Salta node_modules e dist.
 *
 * @param dirPath - Percorso assoluto della directory
 * @param extensions - Estensioni da includere (es. ['.md', '.ts'])
 * @returns Array di percorsi assoluti dei file trovati
 */
function collectFiles(dirPath: string, extensions: string[]): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Restituisce lo stem (nome base senza estensione) di un file.
 *
 * @param filePath - Percorso assoluto del file
 * @returns Stem del file
 */
function getStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Raggruppa un array di percorsi per stem (nome base senza estensione).
 *
 * @param files - Array di percorsi assoluti
 * @returns Map stem → percorsi
 */
function groupByStem(files: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const file of files) {
    const stem = getStem(file);
    const existing = map.get(stem);
    if (existing) {
      existing.push(file);
    } else {
      map.set(stem, [file]);
    }
  }

  return map;
}

/**
 * Calcola il punteggio di freschezza basato sui giorni dall'ultimo
 * aggiornamento. Formula: 100 - floor(days / 7) * 10, min 0.
 *
 * @param daysSinceUpdate - Giorni dall'ultimo aggiornamento
 * @returns Punteggio 0-100
 */
function calculateScore(daysSinceUpdate: number): number {
  if (daysSinceUpdate < 0) {
    return MAX_SCORE;
  }

  const periods = Math.floor(daysSinceUpdate / PENALTY_PERIOD_DAYS);
  const score = MAX_SCORE - periods * PENALTY_PER_PERIOD;
  return Math.max(MIN_SCORE, score);
}

/**
 * Determina lo stato di un documento in base ai giorni dall'aggiornamento.
 *
 * @param daysSinceUpdate - Giorni dall'ultima modifica
 * @param hasDoc - Se il file .md esiste
 * @returns Stato del documento
 */
function determineStatus(daysSinceUpdate: number, hasDoc: boolean): DocStatus {
  if (!hasDoc) {
    return 'missing';
  }

  if (daysSinceUpdate > STALE_THRESHOLD_DAYS) {
    return 'missing';
  }

  if (daysSinceUpdate >= FRESH_THRESHOLD_DAYS) {
    return 'stale';
  }

  return 'fresh';
}

/**
 * Crea l'array di informazioni sui file sorgente per un dato set di percorsi.
 *
 * @param filePaths - Percorsi dei file sorgente
 * @returns Array di SourceFileInfo
 */
function buildSourceFileInfos(filePaths: string[]): SourceFileInfo[] {
  return filePaths.map((fp) => {
    let lastModified: string;
    try {
      const stat = fs.statSync(fp);
      lastModified = stat.mtime.toISOString();
    } catch {
      lastModified = new Date(0).toISOString();
    }

    return {
      path: fp,
      lastModified,
    };
  });
}

/**
 * Ottiene la data ISO dell'ultima modifica di un file.
 * Se il file non esiste, restituisce la data epoch (01-01-1970).
 *
 * @param filePath - Percorso del file
 * @returns Data ISO dell'ultima modifica
 */
function getFileModifiedTime(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Analizza la freschezza della documentazione confrontando i file .md
 * con i file .ts del progetto.
 *
 * La funzione:
 * 1. Scansiona ricorsivamente docsDir per i file .md
 * 2. Scansiona ricorsivamente srcDir per i file .ts
 * 3. Abbina i file per stem (nome base senza estensione)
 * 4. Per ogni coppia, confronta le date e calcola punteggio e stato
 * 5. Include anche i file .ts senza corrispondente .md come 'missing'
 *
 * @param docsDir - Directory dei documenti (default: 'docs/')
 * @param srcDir - Directory dei sorgenti (default: 'src/')
 * @returns DocFreshnessReport completo
 */
export function analyzeDocFreshness(
  docsDir?: string,
  srcDir?: string
): DocFreshnessReport {
  const docsPath = path.resolve(docsDir || 'docs');
  const srcPath = path.resolve(srcDir || 'src');

  // Raccogli tutti i file
  const mdFiles = collectFiles(docsPath, ['.md']);
  const tsFiles = collectFiles(srcPath, ['.ts']);

  // Raggruppa per stem (nome base senza estensione)
  const mdByStem = groupByStem(mdFiles);
  const tsByStem = groupByStem(tsFiles);

  // Unisce tutti gli stem presenti (sia da .md che da .ts)
  const allStems = new Set([
    ...mdByStem.keys(),
    ...tsByStem.keys(),
  ]);

  const entries: DocFreshnessEntry[] = [];

  for (const stem of allStems) {
    const matchingMds = mdByStem.get(stem) || [];
    const matchingTss = tsByStem.get(stem) || [];
    const hasDoc = matchingMds.length > 0;

    if (hasDoc) {
      // Per ogni file .md associato a questo stem
      for (const mdFile of matchingMds) {
        const mdStat = fs.statSync(mdFile);
        const daysSinceUpdate =
          (Date.now() - mdStat.mtime.getTime()) / (1000 * 60 * 60 * 24);
        const roundedDays = Math.round(daysSinceUpdate * 100) / 100;

        // Verifica se almeno un .ts è più recente del .md
        const hasNewerSource = matchingTss.some((tsFile) => {
          try {
            const tsStat = fs.statSync(tsFile);
            return tsStat.mtime > mdStat.mtime;
          } catch {
            return false;
          }
        });

        // Lo stato base dall'età
        let status = determineStatus(roundedDays, true);
        // Se un sorgente è più recente, forza stale
        if (status === 'fresh' && hasNewerSource) {
          status = 'stale';
        }

        const score = calculateScore(roundedDays);

        entries.push({
          filePath: mdFile,
          lastModified: mdStat.mtime.toISOString(),
          sourceFiles: buildSourceFileInfos(matchingTss),
          status,
          daysSinceUpdate: roundedDays,
          score,
        });
      }
    } else {
      // Nessun .md per questo stem → missing
      // Usa il primo .ts come riferimento per ipotizzare la posizione del .md
      const firstTs = matchingTss[0];
      const hypotheticalMdPath = path.join(
        docsPath,
        `${stem}.md`
      );

      const score = 0;

      entries.push({
        filePath: hypotheticalMdPath,
        lastModified: getFileModifiedTime(hypotheticalMdPath),
        sourceFiles: buildSourceFileInfos(matchingTss),
        status: 'missing',
        daysSinceUpdate: Infinity,
        score,
      });
    }
  }

  // Statistiche aggregate
  const totalDocs = entries.length;
  const freshCount = entries.filter((e) => e.status === 'fresh').length;
  const staleCount = entries.filter((e) => e.status === 'stale').length;
  const missingCount = entries.filter((e) => e.status === 'missing').length;

  // Punteggio overall: media dei punteggi, arrotondata
  const overallScore =
    totalDocs > 0
      ? Math.round(
          entries.reduce((acc, e) => acc + e.score, 0) / totalDocs
        )
      : 100;

  return {
    entries: entries.sort((a, b) => {
      // Ordina: prima i missing, poi gli stale, poi i fresh
      const statusOrder: Record<DocStatus, number> = {
        missing: 0,
        stale: 1,
        fresh: 2,
      };
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      return a.filePath.localeCompare(b.filePath);
    }),
    totalDocs,
    freshCount,
    staleCount,
    missingCount,
    overallScore,
    generatedAt: new Date().toISOString(),
  };
}
