/**
 * core/sbom-tracker.ts
 * SBOM Tracker — Fase 8 PANTHEON.
 *
 * Cattura snapshot delle dipendenze del progetto leggendo package.json,
 * package-lock.json e node_modules/. L'implementazione è in memoria (nessun DB).
 *
 * Funzionalità:
 *   - captureSnapshot: legge dipendenze correnti e crea uno snapshot
 *   - listSnapshots: restituisce snapshot recenti
 *   - diffSnapshots: confronta due snapshot e restituisce aggiunte/rimozioni/cambi
 *
 * Pattern:
 *   - Snapshot in memoria (array statico)
 *   - Lettura file con fs.readFileSync
 *   - UUID per ID snapshot
 *
 * @module core/sbom-tracker
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Una singola dipendenza */
export interface Dependency {
  name: string;
  version: string;
  license?: string;
}

/** Snapshot delle dipendenze a un dato momento */
export interface SbomSnapshot {
  id: string;
  dependencies: Dependency[];
  totalCount: number;
  generatedAt: string;
}

/** Differenza tra due snapshot */
export interface SbomDiff {
  added: Dependency[];
  removed: Dependency[];
  changed: Array<{ name: string; from: string; to: string }>;
}

// ---------------------------------------------------------------------------
// Stato (in memoria)
// ---------------------------------------------------------------------------

/**
 * Archiviazione in memoria per gli snapshot.
 * Array ordinato per data di creazione (dal più recente al più vecchio).
 */
const snapshots: SbomSnapshot[] = [];

/** Numero massimo di snapshot da mantenere in memoria */
const MAX_SNAPSHOTS = 100;

// ---------------------------------------------------------------------------
// Pubbliche
// ---------------------------------------------------------------------------

/**
 * Cattura uno snapshot delle dipendenze del progetto.
 *
 * Legge package.json per dipendenze dirette, package-lock.json per versione
 * esatta e node_modules/ per licenze.
 *
 * @param projectPath - Percorso del progetto (default: processo corrente)
 * @returns SbomSnapshot con le dipendenze catturate
 *
 * @example
 * ```ts
 * const snap = captureSnapshot('./my-project');
 * console.log(`Trovate ${snap.totalCount} dipendenze`);
 * ```
 */
export function captureSnapshot(projectPath?: string): SbomSnapshot {
  const targetPath = projectPath ?? process.cwd();

  // Legge package.json
  const packageJsonPath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at: ${packageJsonPath}`);
  }

  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonRaw);

  // Legge package-lock.json (se presente) per versioni esatte
  const lockJsonPath = path.join(targetPath, 'package-lock.json');
  let lockJson: Record<string, unknown> | null = null;
  if (fs.existsSync(lockJsonPath)) {
    try {
      const lockRaw = fs.readFileSync(lockJsonPath, 'utf-8');
      lockJson = JSON.parse(lockRaw);
    } catch {
      // Ignora errori di parsing del lock file
    }
  }

  // Raccoglie tutte le dipendenze (produzione + sviluppo)
  const depsMap = new Map<string, string>();

  // Dipendenze di produzione
  const prodDeps = packageJson.dependencies ?? {};
  for (const [name, versionRange] of Object.entries(prodDeps)) {
    depsMap.set(name, String(versionRange));
  }

  // Dipendenze di sviluppo
  const devDeps = packageJson.devDependencies ?? {};
  for (const [name, versionRange] of Object.entries(devDeps)) {
    depsMap.set(name, String(versionRange));
  }

  // Peer dependencies
  const peerDeps = packageJson.peerDependencies ?? {};
  for (const [name, versionRange] of Object.entries(peerDeps)) {
    if (!depsMap.has(name)) {
      depsMap.set(name, String(versionRange));
    }
  }

  // Risolve versioni esatte da package-lock.json
  const lockPackages = lockJson?.packages as Record<string, { version?: string; license?: string }> | undefined;

  // Ottiene licenze da node_modules se package-lock.json non è disponibile
  const nodeModulesPath = path.join(targetPath, 'node_modules');

  const dependencies: Dependency[] = [];

  for (const [name, versionRange] of depsMap) {
    let resolvedVersion = versionRange;
    let license: string | undefined;

    // Cerca versione esatta in package-lock.json
    if (lockPackages) {
      // Cerca nel lock file: la chiave può essere "node_modules/nome" o solo "nome"
      const lockKey = `node_modules/${name}`;
      const pkgInfo = lockPackages[lockKey] ?? lockPackages[name];

      if (pkgInfo?.version) {
        resolvedVersion = pkgInfo.version;
      }

      if (pkgInfo?.license) {
        license = pkgInfo.license;
      }
    }

    // Se non abbiamo trovato licenza, prova a leggere da node_modules
    if (!license) {
      try {
        const pkgJsonPath = path.join(nodeModulesPath, name, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkgRaw = fs.readFileSync(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(pkgRaw);
          license = pkg.license ?? undefined;
        }
      } catch {
        // Ignora errori di lettura
      }
    }

    dependencies.push({
      name,
      version: resolvedVersion,
      license,
    });
  }

  // Ordina per nome
  dependencies.sort((a, b) => a.name.localeCompare(b.name));

  const snapshot: SbomSnapshot = {
    id: `sbom_${crypto.randomUUID()}`,
    dependencies,
    totalCount: dependencies.length,
    generatedAt: new Date().toISOString(),
  };

  // Aggiunge in testa (più recente primo)
  snapshots.unshift(snapshot);

  // Limita il numero di snapshot in memoria
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(MAX_SNAPSHOTS);
  }

  return snapshot;
}

/**
 * Restituisce gli snapshot disponibili.
 *
 * @param limit - Numero massimo di snapshot da restituire (default: 10)
 * @returns Array di SbomSnapshot
 *
 * @example
 * ```ts
 * const snaps = listSnapshots(5);
 * ```
 */
export function listSnapshots(limit?: number): SbomSnapshot[] {
  const queryLimit = limit ?? 10;
  return snapshots.slice(0, Math.max(1, Math.min(queryLimit, snapshots.length)));
}

/**
 * Confronta due snapshot di dipendenze.
 *
 * Restituisce:
 *   - added: dipendenze presenti in snapshot2 ma non in snapshot1
 *   - removed: dipendenze presenti in snapshot1 ma non in snapshot2
 *   - changed: dipendenze presenti in entrambi ma con versione diversa
 *
 * @param snapshotId1 - ID del primo snapshot (versione base)
 * @param snapshotId2 - ID del secondo snapshot (versione da confrontare)
 * @returns SbomDiff con aggiunte, rimozioni e cambi
 * @throws Error se uno dei due snapshot non esiste
 *
 * @example
 * ```ts
 * const diff = diffSnapshots('sbom_uuid1', 'sbom_uuid2');
 * console.log(`Aggiunte: ${diff.added.length}, Rimozioni: ${diff.removed.length}`);
 * ```
 */
export function diffSnapshots(snapshotId1: string, snapshotId2: string): SbomDiff {
  const snap1 = snapshots.find((s) => s.id === snapshotId1);
  if (!snap1) {
    throw new Error(`Snapshot not found: ${snapshotId1}`);
  }

  const snap2 = snapshots.find((s) => s.id === snapshotId2);
  if (!snap2) {
    throw new Error(`Snapshot not found: ${snapshotId2}`);
  }

  // Indici per lookup O(1)
  const deps1 = new Map(snap1.dependencies.map((d) => [d.name, d]));
  const deps2 = new Map(snap2.dependencies.map((d) => [d.name, d]));

  const added: Dependency[] = [];
  const removed: Dependency[] = [];
  const changed: Array<{ name: string; from: string; to: string }> = [];

  // Trova aggiunte e cambi
  for (const [name, dep2] of deps2) {
    const dep1 = deps1.get(name);

    if (!dep1) {
      // Presente in snap2 ma non in snap1 → aggiunta
      added.push(dep2);
    } else if (dep1.version !== dep2.version) {
      // Presente in entrambi ma versione diversa → cambiata
      changed.push({
        name,
        from: dep1.version,
        to: dep2.version,
      });
    }
  }

  // Trova rimosse
  for (const [name, dep1] of deps1) {
    if (!deps2.has(name)) {
      // Presente in snap1 ma non in snap2 → rimossa
      removed.push(dep1);
    }
  }

  return {
    added,
    removed,
    changed,
  };
}

/**
 * Resetta la lista degli snapshot (utile per test).
 */
export function resetSnapshots(): void {
  snapshots.length = 0;
}
