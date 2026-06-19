/**
 * core/benchmark-bridge.ts
 * Ponte tra i benchmark esistenti di Tabularium e il metrics engine.
 *
 * Permette di:
 * - Snapshotare singoli benchmark come metriche (domain="perf")
 * - Raccogliere tutti i benchmark da un file results.json
 * - Storeare automaticamente nel database tramite metrics-engine
 *
 * @module core/benchmark-bridge
 */

import fs from 'node:fs';
import path from 'node:path';
import { storeMetric } from './metrics-engine.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

/** Snapshot di un benchmark */
export interface BenchmarkSnapshot {
  name: string;
  value: number;
  unit: string;         // "ms", "ops/s", "MB/s"
  tags?: Record<string, string>;
}

/** Struttura del file results.json dei benchmark */
interface BenchmarkResultsFile {
  results: Array<{
    name: string;
    value: number;
    unit: string;
    tags?: Record<string, string>;
  }>;
}

// ---------------------------------------------------------------------------
// Store singolo benchmark
// ---------------------------------------------------------------------------

/**
 * Salva un benchmark come metrica di performance (domain="perf").
 *
 * Converte il nome del benchmark in un nome metrica valido:
 * - Sostituisce spazi e trattini con underscore
 * - Aggiunge l'unità come suffisso se non già presente
 *
 * @param name - Nome del benchmark (es. "sqlite-read")
 * @param value - Valore misurato
 * @param unit - Unità di misura ("ms", "ops/s", "MB/s")
 * @param tags - Tag opzionali (es. { agent, scenario })
 * @returns ID della metrica storeata
 */
export function snapshotBenchmark(
  name: string,
  value: number,
  unit: string,
  tags?: Record<string, string>
): string {
  // Normalizza nome metrica
  const cleanName = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '');

  // Aggiungi suffisso unità se non presente
  const unitSuffix = unitToSuffix(unit);
  const metricName = cleanName.endsWith(`_${unitSuffix}`)
    ? cleanName
    : `${cleanName}_${unitSuffix}`;

  // Aggiungi unità nei tag
  const fullTags: Record<string, string> = {
    ...(tags ?? {}),
    unit,
  };

  return storeMetric('perf', metricName, value, fullTags);
}

// ---------------------------------------------------------------------------
// Collezione batch
// ---------------------------------------------------------------------------

/**
 * Cerca e carica il file benchmarks/results.json all'interno del percorso
 * base di Tabularium, estrae le metriche e le salva nel database.
 *
 * Il file deve avere struttura:
 * ```json
 * {
 *   "results": [
 *     { "name": "sqlite-read", "value": 0.5, "unit": "ms" }
 *   ]
 * }
 * ```
 *
 * @returns Numero di benchmark storeati con successo
 */
export function collectAllBenchmarks(): number {
  // Determina il percorso base di Tabularium
  // Questo file è in src/core/, risali di 2 livelli
  const tabulariumRoot = path.resolve(__dirname, '..', '..');
  const resultsPath = path.join(tabulariumRoot, 'benchmarks', 'results.json');

  if (!fs.existsSync(resultsPath)) {
    console.error('[benchmark-bridge] No benchmarks/results.json found');
    return 0;
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(resultsPath, 'utf-8');
  } catch (err) {
    console.error('[benchmark-bridge] Failed to read results.json:', err);
    return 0;
  }

  let parsed: BenchmarkResultsFile;
  try {
    parsed = JSON.parse(fileContent) as BenchmarkResultsFile;
  } catch (err) {
    console.error('[benchmark-bridge] Failed to parse results.json:', err);
    return 0;
  }

  if (!parsed.results || !Array.isArray(parsed.results) || parsed.results.length === 0) {
    console.error('[benchmark-bridge] No results array in results.json');
    return 0;
  }

  let stored = 0;
  for (const result of parsed.results) {
    try {
      snapshotBenchmark(result.name, result.value, result.unit, result.tags);
      stored++;
    } catch (err) {
      console.error(
        `[benchmark-bridge] Failed to store benchmark '${result.name}':`,
        err
      );
    }
  }

  console.error(`[benchmark-bridge] Stored ${stored}/${parsed.results.length} benchmarks`);
  return stored;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converte un'unità in un suffisso per il nome della metrica.
 *
 * @param unit - Unità (ms, ops/s, MB/s, etc.)
 * @returns Suffisso normalizzato
 */
function unitToSuffix(unit: string): string {
  const unitMap: Record<string, string> = {
    'ms': 'ms',
    'milliseconds': 'ms',
    'millisecond': 'ms',
    's': 's',
    'seconds': 's',
    'second': 's',
    'ops/s': 'ops_per_s',
    'ops_per_sec': 'ops_per_s',
    'mb/s': 'mb_per_s',
    'mb_per_sec': 'mb_per_s',
    'kb': 'kb',
    'mb': 'mb',
    'bytes': 'bytes',
    'b': 'bytes',
    'percent': 'pct',
    '%': 'pct',
  };

  return unitMap[unit.toLowerCase()] ?? unit.replace(/[^a-z0-9]/g, '_');
}
