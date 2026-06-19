/**
 * core/project-map.ts
 * Scansione della struttura del progetto: moduli, esportazioni e dipendenze.
 * Utilizzata dalla resource tabularium://project/map per fornire una mappa
 * aggiornata all'avvio del server.
 *
 * @module core/project-map
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/**
 * Tipo di modulo nel progetto.
 * - core: moduli in src/core/
 * - tool: moduli in src/tools/
 * - resource: moduli in src/resources/
 * - test: file in __tests__/
 * - migration: script in migrations/
 * - config: altri file nella root
 */
export type ModuleType = 'core' | 'tool' | 'resource' | 'test' | 'migration' | 'config';

export interface ModuleInfo {
  name: string;
  path: string;
  type: ModuleType;
  exports: string[];
  dependencies: string[];
}

export interface ProjectMap {
  root: string;
  modules: ModuleInfo[];
  directories: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Directory da scansionare con il tipo corrispondente */
const SCAN_TARGETS: Array<{ dir: string; type: ModuleType }> = [
  { dir: 'src/core', type: 'core' },
  { dir: 'src/tools', type: 'tool' },
  { dir: 'src/resources', type: 'resource' },
  { dir: '__tests__', type: 'test' },
  { dir: 'migrations', type: 'migration' },
];

/** Regex per estrarre le esportazioni dichiarate */
const EXPORT_REGEX = /export\s+(?:function|class|const|interface|type)\s+(\w+)/g;

/** Regex per estrarre dipendenze relative (./ o ../) */
const DEPENDENCY_REGEX = /from\s+['"]((?:\.\.?\/)[^'"]+)['"]/g;

// ---------------------------------------------------------------------------
// Scansione directory
// ---------------------------------------------------------------------------

/**
 * Scansiona ricorsivamente una directory alla ricerca di file sorgente.
 * Include file .ts (o .sql per migrazioni).
 *
 * @param dirPath - Percorso assoluto della directory
 * @param extensions - Estensioni da includere (default: ['.ts'])
 * @returns Array di percorsi assoluti dei file trovati
 */
function scanDirectory(dirPath: string, extensions: string[] = ['.ts']): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Salta node_modules e dist
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...scanDirectory(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Classifica un modulo in base al percorso relativo alla root.
 *
 * @param relativePath - Percorso relativo del file
 * @returns Tipo del modulo
 */
function classifyModule(relativePath: string): ModuleType {
  for (const target of SCAN_TARGETS) {
    if (relativePath.startsWith(target.dir + path.sep) || relativePath.startsWith(target.dir.replace(/\//g, path.sep) + path.sep)) {
      return target.type;
    }
  }
  return 'config';
}

/**
 * Estrae i nomi delle esportazioni da un file TypeScript.
 *
 * @param content - Contenuto del file
 * @returns Array di nomi esportati
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = EXPORT_REGEX.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return exports;
}

/**
 * Estrae i moduli di dipendenza relativi (./ o ../) da un file TypeScript.
 *
 * @param content - Contenuto del file
 * @returns Array di percorsi delle dipendenze
 */
function extractDependencies(content: string): string[] {
  const dependencies: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = DEPENDENCY_REGEX.exec(content)) !== null) {
    dependencies.push(match[1]);
  }

  return dependencies;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Cache della mappa generata */
let cachedMap: ProjectMap | null = null;

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Genera la mappa completa del progetto.
 * Scansiona src/core/, src/tools/, src/resources/, __tests__/ e migrations/
 * estraendo per ogni file: esportazioni, dipendenze e tipo.
 *
 * La scansione è sincrona e avviene al primo call; il risultato viene
 * cachetizzato per le successive richieste.
 *
 * @param rootPath - Percorso della root del progetto (default: process.cwd())
 * @returns ProjectMap con moduli, directory e timestamp
 */
export function generateProjectMap(rootPath?: string): ProjectMap {
  // Se esiste una cache e non è stato specificato un rootPath diverso, riusa
  if (cachedMap !== null && rootPath === undefined) {
    return cachedMap;
  }

  const root = rootPath ? path.resolve(rootPath) : process.cwd();
  const modules: ModuleInfo[] = [];

  for (const target of SCAN_TARGETS) {
    const absDir = path.join(root, target.dir);
    const extensions = target.type === 'migration' ? ['.sql'] : ['.ts'];
    const files = scanDirectory(absDir, extensions);

    for (const filePath of files) {
      const relativePath = path.relative(root, filePath);
      const name = path.basename(filePath, path.extname(filePath));

      const content = fs.readFileSync(filePath, 'utf-8');
      const exports = extractExports(content);
      const dependencies = extractDependencies(content);

      modules.push({
        name,
        path: relativePath,
        type: target.type,
        exports,
        dependencies,
      });
    }
  }

  // Raccogli tutte le directory uniche presenti nei moduli
  const dirSet = new Set<string>();
  for (const mod of modules) {
    const dir = path.dirname(mod.path);
    if (dir && dir !== '.') {
      dirSet.add(dir.replace(/\\/g, '/'));
    }
  }
  const directories = Array.from(dirSet).sort();

  const projectMap: ProjectMap = {
    root,
    modules: modules.sort((a, b) => a.path.localeCompare(b.path)),
    directories,
    generatedAt: new Date().toISOString(),
  };

  // Cache solo se usiamo il rootPath di default
  if (rootPath === undefined) {
    cachedMap = projectMap;
  }

  return projectMap;
}
