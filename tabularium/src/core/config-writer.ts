/**
 * config-writer.ts
 * Scrittura sicura della configurazione opencode.json.
 * Supporta atomic write (temp file + rename) e backup automatico
 * con rollback in caso di fallimento validazione.
 *
 * @module core/config-writer
 */

import { readFile, writeFile, rename, copyFile, access, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parseOpenCode, reloadOpenCode, type OpenCodeConfig } from './opencode-parser.js';
import { validateConfig } from './validator.js';
import { invalidateAllCaches } from './cache.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Path di default per opencode.json. */
const DEFAULT_PATH = path.resolve(process.cwd(), 'opencode.json');

// ---------------------------------------------------------------------------
// Funzioni interne (helpers)
// ---------------------------------------------------------------------------

/**
 * Controlla esistenza file (async).
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea un backup del file di configurazione con timestamp.
 * Pattern: `opencode.backup.<YYYY-MM-DDTHH-mm-ss>.json`
 *
 * @param filePath - Percorso del file originale
 * @returns Percorso del backup creato
 */
async function createBackup(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.json');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `${base}.backup.${timestamp}.json`);

  if (await fileExists(filePath)) {
    await copyFile(filePath, backupPath);
  }

  return backupPath;
}

/**
 * Scrittura atomica: scrive su un file temporaneo, poi rinomina.
 * Garantisce che il file target sia sempre consistente:
 * se la scrittura fallisce, il file originale rimane intatto.
 *
 * @param filePath - Percorso del file target
 * @param content - Contenuto da scrivere
 */
async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp.' + Date.now();
  await writeFile(tmpPath, content, 'utf-8');
  try {
    await rename(tmpPath, filePath);
  } catch {
    // Pulisci il tmp in caso di errore rename
    await unlink(tmpPath).catch(() => {});
    throw new Error(`Atomic write failed: could not rename ${tmpPath} -> ${filePath}`);
  }
}

/**
 * Legge il contenuto attuale di opencode.json come record raw.
 */
async function readRawConfig(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Aggiorna la configurazione di un agente specifico.
 * Salva atomicamente con backup automatico e validazione post-scrittura.
 * Se la validazione fallisce, esegue rollback automatico.
 *
 * @param agentName - Nome dell'agente da aggiornare
 * @param updates - Record con i campi da aggiornare (solo i campi forniti)
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Oggetto con esito e path del backup
 * @throws {Error} Se l'agente non esiste o la validazione fallisce
 *
 * @example
 * ```ts
 * const result = await updateAgentConfig('minerva', {
 *   temperature: 0.3,
 *   model: 'gpt-4-turbo'
 * });
 * console.log('Backup:', result.backupPath);
 * ```
 */
export async function updateAgentConfig(
  agentName: string,
  updates: Partial<Record<string, unknown>>,
  filePath?: string
): Promise<{ success: boolean; backupPath?: string }> {
  const resolvedPath = filePath ?? DEFAULT_PATH;

  // Legge la configurazione corrente
  const raw = await readRawConfig(resolvedPath);
  const agents = raw.agents as Record<string, Record<string, unknown>> | undefined;

  if (!agents || !agents[agentName]) {
    throw new Error(`Agent '${agentName}' not found in opencode.json`);
  }

  // Applica gli aggiornamenti
  Object.assign(agents[agentName], updates);

  // Backup prima della scrittura
  const backupPath = await createBackup(resolvedPath);

  // Scrittura atomica
  await writeAtomic(resolvedPath, JSON.stringify(raw, null, 2) + '\n');

  // Invalida cache per forzare rilettura
  invalidateAllCaches();

  // Validazione post-scrittura
  try {
    const errors = await validateConfig(resolvedPath);
    if (errors.length > 0) {
      // Rollback: ripristina dal backup
      if (await fileExists(backupPath)) {
        await copyFile(backupPath, resolvedPath);
        invalidateAllCaches();
      }
      throw new Error(
        `Validation failed after write: ${errors.map((e) => e.message).join('; ')}`
      );
    }
  } catch (err) {
    // Se l'errore è già un nostro throw, rilancialo
    if (err instanceof Error && err.message.startsWith('Validation failed')) {
      throw err;
    }
    // Altrimenti rollback e rilancia
    if (await fileExists(backupPath)) {
      await copyFile(backupPath, resolvedPath).catch(() => {});
      invalidateAllCaches();
    }
    throw new Error(
      `Post-write validation error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  return { success: true, backupPath };
}

/**
 * Aggiunge un nuovo agente alla configurazione opencode.json.
 *
 * @param agentName - Nome del nuovo agente (deve essere unico)
 * @param agentConfig - Configurazione completa dell'agente
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Esito dell'operazione
 * @throws {Error} Se l'agente esiste già
 *
 * @example
 * ```ts
 * await addAgent('flora', {
 *   role: 'Frontend Developer',
 *   latinName: 'Flora',
 *   emoji: '🌸',
 *   color: '#ff6b9d',
 *   model: 'gpt-4',
 *   mode: 'subagent',
 *   temperature: 0.7,
 *   permissions: { bash: 'deny', edit: 'allow', task: 'allow' },
 *   hasSkill: false,
 * });
 * ```
 */
export async function addAgent(
  agentName: string,
  agentConfig: Record<string, unknown>,
  filePath?: string
): Promise<{ success: boolean }> {
  const resolvedPath = filePath ?? DEFAULT_PATH;

  const raw = await readRawConfig(resolvedPath);
  const agents = (raw.agents ?? {}) as Record<string, unknown>;

  if (agentName in agents) {
    throw new Error(`Agent '${agentName}' already exists in opencode.json`);
  }

  // Aggiunge il nuovo agente
  agents[agentName] = agentConfig;
  raw.agents = agents;

  // Backup e scrittura atomica
  await createBackup(resolvedPath);
  await writeAtomic(resolvedPath, JSON.stringify(raw, null, 2) + '\n');

  // Invalida cache
  invalidateAllCaches();

  return { success: true };
}

/**
 * Rimuove un agente dalla configurazione opencode.json.
 * Esegue backup prima della modifica.
 *
 * @param agentName - Nome dell'agente da rimuovere
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Esito dell'operazione
 * @throws {Error} Se l'agente non esiste o è l'agente primario
 */
export async function removeAgent(
  agentName: string,
  filePath?: string
): Promise<{ success: boolean }> {
  const resolvedPath = filePath ?? DEFAULT_PATH;

  const raw = await readRawConfig(resolvedPath);
  const agents = raw.agents as Record<string, unknown> | undefined;

  if (!agents || !(agentName in agents)) {
    throw new Error(`Agent '${agentName}' not found in opencode.json`);
  }

  // Non permette rimozione se è l'unico agente o se il file non avrebbe senso
  if (Object.keys(agents).length <= 1) {
    throw new Error('Cannot remove the last agent from configuration');
  }

  delete agents[agentName];

  await createBackup(resolvedPath);
  await writeAtomic(resolvedPath, JSON.stringify(raw, null, 2) + '\n');

  invalidateAllCaches();

  return { success: true };
}

/**
 * Aggiorna le impostazioni globali (non agente) in opencode.json.
 * Utile per aggiornare modelli o configurazioni generali.
 *
 * @param updates - Record con i campi globali da aggiornare
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Esito e path del backup
 */
export async function updateGlobalConfig(
  updates: Record<string, unknown>,
  filePath?: string
): Promise<{ success: boolean; backupPath?: string }> {
  const resolvedPath = filePath ?? DEFAULT_PATH;

  const raw = await readRawConfig(resolvedPath);

  // Applica aggiornamenti a livello root (esclude agents e models che hanno
  // update dedicati)
  for (const [key, value] of Object.entries(updates)) {
    if (key !== 'agents' && key !== 'models') {
      raw[key] = value;
    }
  }

  const backupPath = await createBackup(resolvedPath);
  await writeAtomic(resolvedPath, JSON.stringify(raw, null, 2) + '\n');

  invalidateAllCaches();

  return { success: true, backupPath };
}
