/**
 * model-fetcher.ts
 * Recupero e query dei modelli AI dalla configurazione opencode.
 * Tutte le funzioni sono asincrone e leggono la configurazione dinamicamente,
 * senza hardcodare provider o ID modello.
 *
 * @module core/model-fetcher
 */

import { parseOpenCode, getModelRegistry } from './opencode-parser.js';
import type { Model, ModelRegistry } from '../types/model.js';

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Ottiene tutti i modelli configurati in opencode.json.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di tutti i modelli
 *
 * @example
 * ```ts
 * const models = await getAllModels();
 * models.forEach(m => console.log(m.id, m.provider));
 * ```
 */
export async function getAllModels(filePath?: string): Promise<Model[]> {
  const config = await parseOpenCode(filePath);
  return Object.values(config.models);
}

/**
 * Ottiene un modello specifico per ID.
 *
 * @param id - ID del modello (es. 'gpt-4', 'claude-3-opus')
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Modello trovato o undefined
 *
 * @example
 * ```ts
 * const model = await getModelById('gpt-4');
 * console.log(model?.provider);
 * ```
 */
export async function getModelById(
  id: string,
  filePath?: string
): Promise<Model | undefined> {
  const config = await parseOpenCode(filePath);
  return config.models[id];
}

/**
 * Ottiene tutti i modelli di un provider specifico.
 * La ricerca è case-insensitive.
 *
 * @param provider - Nome del provider (es. 'openai', 'anthropic')
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Modelli del provider specificato
 *
 * @example
 * ```ts
 * const openaiModels = await getModelsByProvider('openai');
 * ```
 */
export async function getModelsByProvider(
  provider: string,
  filePath?: string
): Promise<Model[]> {
  const config = await parseOpenCode(filePath);
  const search = provider.toLowerCase();
  return Object.values(config.models).filter(
    (m) => m.provider.toLowerCase() === search
  );
}

/**
 * Costruisce un ModelRegistry aggiornato con timestamp.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns ModelRegistry con mappa modelli e data aggiornamento
 *
 * @example
 * ```ts
 * const registry = await buildModelRegistry();
 * console.log(registry.updatedAt);
 * ```
 */
export async function buildModelRegistry(filePath?: string): Promise<ModelRegistry> {
  return getModelRegistry(filePath);
}

/**
 * Elenca tutti i provider unici presenti nella configurazione.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di nomi provider (ordinati alfabeticamente)
 *
 * @example
 * ```ts
 * const providers = await listProviders();
 * // ['anthropic', 'openai']
 * ```
 */
export async function listProviders(filePath?: string): Promise<string[]> {
  const config = await parseOpenCode(filePath);
  const providers = new Set<string>();
  for (const model of Object.values(config.models)) {
    providers.add(model.provider);
  }
  return Array.from(providers).sort();
}

/**
 * Conta i modelli per provider.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Record provider → conteggio
 *
 * @example
 * ```ts
 * const counts = await countModelsByProvider();
 * // { openai: 3, anthropic: 2 }
 * ```
 */
export async function countModelsByProvider(
  filePath?: string
): Promise<Record<string, number>> {
  const config = await parseOpenCode(filePath);
  const counts: Record<string, number> = {};

  for (const model of Object.values(config.models)) {
    counts[model.provider] = (counts[model.provider] ?? 0) + 1;
  }

  return counts;
}

/**
 * Cerca modelli per termine nel nome o provider.
 * Utile per autocompletamento e filtri interattivi.
 *
 * @param query - Termine di ricerca (case-insensitive)
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Modelli che corrispondono
 */
export async function searchModels(
  query: string,
  filePath?: string
): Promise<Model[]> {
  const config = await parseOpenCode(filePath);
  const q = query.toLowerCase();
  return Object.values(config.models).filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
  );
}

/**
 * Ottiene statistiche aggregate sui modelli.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Statistiche: totale, provider unici, modelli per provider
 */
export async function getModelStats(filePath?: string): Promise<{
  total: number;
  uniqueProviders: number;
  byProvider: Record<string, number>;
  updatedAt: string;
}> {
  const registry = await buildModelRegistry(filePath);
  const byProvider = await countModelsByProvider(filePath);

  return {
    total: Object.keys(registry.models).length,
    uniqueProviders: Object.keys(byProvider).length,
    byProvider,
    updatedAt: registry.updatedAt,
  };
}
