/**
 * validator.ts
 * Validazione dinamica della configurazione opencode.json.
 * Verifica che tutti i campi obbligatori siano presenti, che i tipi siano
 * corretti e che i riferimenti incrociati (es. agente → modello) siano validi.
 * Funziona con qualsiasi numero di agenti e modelli — nessun nome hardcodato.
 *
 * @module core/validator
 */

import type { Agent } from '../types/agent.js';
import type { Model } from '../types/model.js';
import { parseOpenCode, type OpenCodeConfig } from './opencode-parser.js';
import { validationCache } from './cache.js';

// ---------------------------------------------------------------------------
// Interfacce
// ---------------------------------------------------------------------------

/**
 * Errore o warning di validazione.
 */
export interface ValidationError {
  /** Percorso dotted del campo (es. `agents.iuppiter.temperature`) */
  field: string;
  /** Descrizione del problema */
  message: string;
  /** Severità: error (bloccante) o warning (segnalazione) */
  severity: 'error' | 'warning';
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Campi obbligatori per ogni agente. */
const REQUIRED_AGENT_FIELDS: (keyof Agent)[] = [
  'name',
  'role',
  'latinName',
  'emoji',
  'color',
  'model',
  'mode',
  'temperature',
  'permissions',
];

/** Campi obbligatori per ogni modello. */
const REQUIRED_MODEL_FIELDS: (keyof Model)[] = ['id', 'provider'];

// ---------------------------------------------------------------------------
// Funzioni interne (helpers)
// ---------------------------------------------------------------------------

/**
 * Valida tutti gli agenti: campi obbligatori, mode, temperature, modelli.
 */
function validateAgents(config: OpenCodeConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const agentEntries = Object.entries(config.agents);

  if (agentEntries.length === 0) {
    errors.push({
      field: 'agents',
      message: 'No agents configured — at least one agent is required',
      severity: 'error',
    });
    return errors;
  }

  for (const [name, agent] of agentEntries) {
    // Campi obbligatori
    for (const field of REQUIRED_AGENT_FIELDS) {
      const value = agent[field];
      if (value === undefined || value === null || value === '') {
        errors.push({
          field: `agents.${name}.${field}`,
          message: `Missing required field '${field}' for agent '${name}'`,
          severity: field === 'model' ? 'warning' : 'error',
        });
      }
    }

    // Validazione mode
    if (agent.mode && !['primary', 'subagent'].includes(agent.mode)) {
      errors.push({
        field: `agents.${name}.mode`,
        message: `Invalid mode '${agent.mode}' for agent '${name}'. Must be 'primary' or 'subagent'`,
        severity: 'error',
      });
    }

    // Validazione temperature range [0, 2]
    if (
      typeof agent.temperature === 'number' &&
      (agent.temperature < 0 || agent.temperature > 2)
    ) {
      errors.push({
        field: `agents.${name}.temperature`,
        message: `Temperature ${agent.temperature} out of range [0, 2] for agent '${name}'`,
        severity: 'warning',
      });
    }

    // Validazione modello referenziato esiste
    if (agent.model && agent.model !== 'unknown' && !config.models[agent.model]) {
      errors.push({
        field: `agents.${name}.model`,
        message: `Model '${agent.model}' referenced by agent '${name}' not found in models section`,
        severity: 'warning',
      });
    }
  }

  // Verifica esattamente un agente primario
  const primaryAgents = agentEntries.filter(([, a]) => a.mode === 'primary');
  if (primaryAgents.length === 0) {
    errors.push({
      field: 'agents',
      message: 'No primary agent found — at least one agent must have mode "primary"',
      severity: 'error',
    });
  } else if (primaryAgents.length > 1) {
    errors.push({
      field: 'agents',
      message: `Multiple primary agents found: ${primaryAgents.map(([n]) => n).join(', ')}`,
      severity: 'warning',
    });
  }

  return errors;
}

/**
 * Valida tutti i modelli: campi obbligatori.
 */
function validateModels(config: OpenCodeConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [id, model] of Object.entries(config.models)) {
    for (const field of REQUIRED_MODEL_FIELDS) {
      const value = model[field];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push({
          field: `models.${id}.${field}`,
          message: `Missing required field '${field}' for model '${id}'`,
          severity: 'error',
        });
      }
    }
  }

  return errors;
}

/**
 * Validazione incrociata tra agenti e modelli.
 */
function validateCrossReferences(config: OpenCodeConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.model && agent.model !== 'unknown' && !config.models[agent.model]) {
      errors.push({
        field: `agents.${name}.model`,
        message: `Agent '${name}' references non-existent model '${agent.model}'`,
        severity: 'error',
      });
    }
  }

  // Modelli non utilizzati da alcun agente (warning)
  const usedModels = new Set(Object.values(config.agents).map((a) => a.model).filter(Boolean));
  for (const modelId of Object.keys(config.models)) {
    if (!usedModels.has(modelId)) {
      errors.push({
        field: `models.${modelId}`,
        message: `Model '${modelId}' is defined but not used by any agent`,
        severity: 'warning',
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Valida la configurazione opencode.json.
 * Controlla:
 * - Campi obbligatori per ogni agente e modello
 * - Valori validi (mode, temperature range)
 * - Riferimenti incrociati agente → modello
 * - Modelli inutilizzati
 *
 * Utilizza cache in-memory con TTL di 120 secondi.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di errori/warning di validazione (vuoto se tutto ok)
 *
 * @example
 * ```ts
 * const errors = await validateConfig();
 * if (errors.length === 0) {
 *   console.log('Configurazione valida!');
 * } else {
 *   console.error(errors);
 * }
 * ```
 */
export async function validateConfig(filePath?: string): Promise<ValidationError[]> {
  const cacheKey = `validate:${filePath ?? 'default'}`;

  // Cache check
  const cached = validationCache.get(cacheKey) as ValidationError[] | undefined;
  if (cached) return cached;

  const errors: ValidationError[] = [];

  try {
    const config = await parseOpenCode(filePath);

    errors.push(...validateAgents(config));
    errors.push(...validateModels(config));
    errors.push(...validateCrossReferences(config));

    // Ordina: errori prima dei warning
    errors.sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === 'error' ? -1 : 1;
      }
      return a.field.localeCompare(b.field);
    });
  } catch (err) {
    errors.push({
      field: 'root',
      message: `Failed to parse or read config: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'error',
    });
  }

  // Salva in cache (anche se ci sono errori)
  validationCache.set(cacheKey, errors);

  return errors;
}

/**
 * Versione sintetica: restituisce solo `valid: boolean`.
 * Più leggera per health check rapidi.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns `true` se la configurazione è valida (nessun errore)
 */
export async function isValid(filePath?: string): Promise<boolean> {
  const errors = await validateConfig(filePath);
  return errors.filter((e) => e.severity === 'error').length === 0;
}

/**
 * Restituisce solo gli errori (severity === 'error'), escludendo i warning.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Soli errori bloccanti
 */
export async function getErrorsOnly(filePath?: string): Promise<ValidationError[]> {
  const errors = await validateConfig(filePath);
  return errors.filter((e) => e.severity === 'error');
}

/**
 * Restituisce solo i warning (severity === 'warning').
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Soli warning
 */
export async function getWarningsOnly(filePath?: string): Promise<ValidationError[]> {
  const errors = await validateConfig(filePath);
  return errors.filter((e) => e.severity === 'warning');
}
