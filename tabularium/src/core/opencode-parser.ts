/**
 * opencode-parser.ts
 * Parser per il file opencode.json.
 * Legge dinamicamente la configurazione — agenti, modelli e impostazioni — 
 * senza hardcodare nomi di agenti. Funziona con qualsiasi numero di agenti.
 *
 * @module core/opencode-parser
 */

import { readFile, access } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { Agent, AgentManifest, AgentPermissions } from '../types/agent.js';
import type { Model, ModelRegistry } from '../types/model.js';
import { openCodeCache } from './cache.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Path di default per opencode.json — cerca risalendo le directory dalla cwd fino alla root. */
let _defaultPath: string | null = null;
function getDefaultOpenCodePath(): string {
  if (_defaultPath) return _defaultPath;
  let dir = process.cwd();
  const root = path.parse(dir).root;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, 'opencode.json');
    try {
      require('fs').accessSync(candidate, constants.R_OK);
      _defaultPath = candidate;
      return candidate;
    } catch {
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  }
  // Fallback: usa la cwd
  _defaultPath = path.join(process.cwd(), 'opencode.json');
  return _defaultPath;
}

/**
 * Imposta il percorso di opencode.json (utile per test).
 */
export function setOpenCodePath(filePath: string): void {
  _defaultPath = filePath;
}

// ---------------------------------------------------------------------------
// Interfacce pubbliche
// ---------------------------------------------------------------------------

/**
 * Configurazione completa parsata da opencode.json.
 */
export interface OpenCodeConfig {
  /** Mappa nome → agente */
  agents: Record<string, Agent>;
  /** Mappa id → modello */
  models: Record<string, Model>;
  /** Nome dell'agente primario */
  primaryAgent: string;
  /** Configurazione raw (per scrittura) */
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Funzioni interne (helpers)
// ---------------------------------------------------------------------------

/**
 * Controlla se un file esiste (async).
 *
 * @param filePath - Percorso del file
 * @returns `true` se il file esiste e è accessibile in lettura
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
 * Valida un valore di permesso restituendo solo valori ammessi.
 *
 * @param value - Valore grezzo del permesso
 * @param fallback - Valore di default se non valido
 * @returns Valore validato
 */
function validatePermission(value: unknown, fallback: 'allow' | 'deny' | 'ask'): 'allow' | 'deny' | 'ask' {
  const valid = ['allow', 'deny', 'ask'] as const;
  if (typeof value === 'string' && valid.includes(value as typeof valid[number])) {
    return value as typeof valid[number];
  }
  return fallback;
}


/**
 * Estrae gli agenti dalla configurazione raw.
 * Non hardcoda nomi: scorre dinamicamente tutte le chiavi di `raw.agents`.
 *
 * @param raw - Configurazione raw parsata
 * @returns Record nome → Agent
 */
function parseAgents(raw: Record<string, unknown>): Record<string, Agent> {
  const agents: Record<string, Agent> = {};
  const rawAgents = raw.agents ?? raw.agent;

  if (typeof rawAgents !== 'object' || rawAgents === null) {
    return agents;
  }

  for (const [name, config] of Object.entries(rawAgents as Record<string, unknown>)) {
    const a = config as Record<string, unknown>;
    const perms = (a.permissions ?? {}) as Record<string, unknown>;
    agents[name] = {
      name,
      role: String(a.role ?? ''),
      latinName: String(a.latinName ?? name),
      emoji: String(a.emoji ?? '🤖'),
      color: String(a.color ?? '#666666'),
      model: String(a.model ?? 'unknown'),
      mode: a.mode === 'primary' ? 'primary' : 'subagent',
      temperature: Number(a.temperature ?? 0.7),
      steps: a.steps != null ? Number(a.steps) : undefined,
      variant: a.variant != null ? String(a.variant) : undefined,
      permissions: {
        bash: validatePermission(perms['bash'], 'ask'),
        edit: validatePermission(perms['edit'], 'ask'),
        task: validatePermission(perms['task'], 'ask'),
        webfetch: validatePermission(perms['webfetch'], 'ask'),
        websearch: validatePermission(perms['websearch'], 'ask'),
      },
      skill: a.skill != null ? String(a.skill) : undefined,
      hasSkill: a.skill != null && String(a.skill).length > 0,
    };
  }

  return agents;
}

/**
 * Estrae i modelli dalla configurazione raw.
 *
 * @param raw - Configurazione raw parsata
 * @returns Record id → Model
 */
function parseModels(raw: Record<string, unknown>): Record<string, Model> {
  const models: Record<string, Model> = {};
  const rawModels = raw.models;

  if (typeof rawModels !== 'object' || rawModels === null) {
    return models;
  }

  for (const [id, config] of Object.entries(rawModels as Record<string, unknown>)) {
    const m = config as Record<string, unknown>;
    models[id] = {
      id,
      provider: String(m.provider ?? 'unknown'),
      context: m.context != null ? String(m.context) : undefined,
      cost: m.cost != null ? String(m.cost) : undefined,
    };
  }

  return models;
}

/**
 * Trova l'agente primario (mode === 'primary') tra gli agenti parsati.
 * Fallback al primo agente o 'unknown' se non ce ne sono.
 *
 * @param agents - Record degli agenti parsati
 * @returns Nome dell'agente primario
 */
function findPrimaryAgent(agents: Record<string, Agent>): string {
  for (const [name, agent] of Object.entries(agents)) {
    if (agent.mode === 'primary') {
      return name;
    }
  }
  const first = Object.keys(agents)[0];
  return first ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Carica e parsa opencode.json dal project root.
 * Utilizza cache in-memory con TTL configurabile.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Configurazione completa parsata
 * @throws {Error} Se il file non esiste o il JSON è malformato
 *
 * @example
 * ```ts
 * const config = await parseOpenCode();
 * console.log(config.agents.iuppiter.role);
 * ```
 */
export async function parseOpenCode(filePath?: string): Promise<OpenCodeConfig> {
  const resolvedPath = filePath ?? getDefaultOpenCodePath();

  // Cache check
  const cacheKey = `opencode:${resolvedPath}`;
  const cached = openCodeCache.get(cacheKey) as OpenCodeConfig | undefined;
  if (cached) return cached;

  try {
    const exists = await fileExists(resolvedPath);
    if (!exists) {
      throw new Error(`opencode.json not found at: ${resolvedPath}. Tried searching from ${process.cwd()} up to root.`);
    }

    const rawContent = await readFile(resolvedPath, 'utf-8');
    const raw: Record<string, unknown> = JSON.parse(rawContent);

    const agents = parseAgents(raw);
    const models = parseModels(raw);
    const primaryAgent = findPrimaryAgent(agents);

    const config: OpenCodeConfig = { agents, models, primaryAgent, raw };

    // Salva in cache
    openCodeCache.set(cacheKey, config);

    return config;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in opencode.json at ${resolvedPath}: ${err.message}`,
        { cause: err }
      );
    }
    throw err;
  }
}

/**
 * Ricarica la configurazione forzando cache busting.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Configurazione fresca da disco
 *
 * @example
 * ```ts
 * const fresh = await reloadOpenCode();
 * ```
 */
export async function reloadOpenCode(filePath?: string): Promise<OpenCodeConfig> {
  const resolvedPath = filePath ?? getDefaultOpenCodePath();
  const cacheKey = `opencode:${resolvedPath}`;
  openCodeCache.invalidate(cacheKey);
  return parseOpenCode(resolvedPath);
}

/**
 * Ottiene i metadati dell'agent manifest (agenti + primario).
 *
 * @param filePath - Percorso a opencode.json (opzionale)
 * @returns AgentManifest con record agenti e nome primario
 */
export async function getAgentManifest(filePath?: string): Promise<AgentManifest> {
  const config = await parseOpenCode(filePath);
  return {
    agents: config.agents,
    primaryAgent: config.primaryAgent,
  };
}

/**
 * Ottiene il registry dei modelli.
 *
 * @param filePath - Percorso a opencode.json (opzionale)
 * @returns ModelRegistry con mappa modelli e timestamp
 */
export async function getModelRegistry(filePath?: string): Promise<ModelRegistry> {
  const config = await parseOpenCode(filePath);
  return {
    models: config.models,
    updatedAt: new Date().toISOString(),
  };
}
