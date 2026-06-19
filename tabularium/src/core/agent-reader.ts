/**
 * agent-reader.ts
 * Lettura e query degli agenti dalla configurazione opencode.
 * Tutte le funzioni sono asincrone e leggono opencode.json dinamicamente,
 * senza hardcodare nomi di agenti.
 *
 * @module core/agent-reader
 */

import { parseOpenCode, getAgentManifest } from './opencode-parser.js';
import type { Agent, AgentManifest } from '../types/agent.js';
import type { ModelAssignment } from '../types/model.js';

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Ottiene tutti gli agenti configurati in opencode.json.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di tutti gli agenti configurati
 *
 * @example
 * ```ts
 * const agents = await getAllAgents();
 * agents.forEach(a => console.log(a.name, a.role));
 * ```
 */
export async function getAllAgents(filePath?: string): Promise<Agent[]> {
  const config = await parseOpenCode(filePath);
  return Object.values(config.agents);
}

/**
 * Ottiene un agente specifico per nome.
 *
 * @param name - Nome dell'agente (case-sensitive, come in opencode.json)
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Agente trovato o undefined
 *
 * @example
 * ```ts
 * const iuppiter = await getAgentByName('iuppiter');
 * ```
 */
export async function getAgentByName(
  name: string,
  filePath?: string
): Promise<Agent | undefined> {
  const config = await parseOpenCode(filePath);
  return config.agents[name];
}

/**
 * Ottiene l'agente primario del progetto (quello con mode === 'primary').
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Agente primario o undefined se non configurato
 *
 * @example
 * ```ts
 * const primary = await getPrimaryAgent();
 * console.log(`Agente principale: ${primary?.name}`);
 * ```
 */
export async function getPrimaryAgent(filePath?: string): Promise<Agent | undefined> {
  const config = await parseOpenCode(filePath);
  const primaryName = config.primaryAgent;
  return config.agents[primaryName];
}

/**
 * Filtra agenti per modalità (primary/subagent).
 *
 * @param mode - Modalità da filtrare ('primary' | 'subagent')
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Agenti con la modalità specificata
 *
 * @example
 * ```ts
 * const subAgents = await getAgentsByMode('subagent');
 * ```
 */
export async function getAgentsByMode(
  mode: 'primary' | 'subagent',
  filePath?: string
): Promise<Agent[]> {
  const config = await parseOpenCode(filePath);
  return Object.values(config.agents).filter((a) => a.mode === mode);
}

/**
 * Ottiene tutti gli assegnamenti agente → modello.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di ModelAssignment
 *
 * @example
 * ```ts
 * const assignments = await getModelAssignments();
 * ```
 */
export async function getModelAssignments(filePath?: string): Promise<ModelAssignment[]> {
  const config = await parseOpenCode(filePath);
  return Object.entries(config.agents).map(([name, agent]) => ({
    agent: name,
    model: agent.model,
  }));
}

/**
 * Controlla se un agente esiste nella configurazione.
 *
 * @param name - Nome dell'agente da cercare
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns `true` se l'agente esiste
 *
 * @example
 * ```ts
 * if (await agentExists('janus')) {
 *   // janus è configurato
 * }
 * ```
 */
export async function agentExists(
  name: string,
  filePath?: string
): Promise<boolean> {
  const config = await parseOpenCode(filePath);
  return name in config.agents;
}

/**
 * Restituisce i nomi di tutti gli agenti configurati.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Array di nomi di agenti
 *
 * @example
 * ```ts
 * const names = await listAgentNames();
 * // ['iuppiter', 'minerva', 'janus', ...]
 * ```
 */
export async function listAgentNames(filePath?: string): Promise<string[]> {
  const config = await parseOpenCode(filePath);
  return Object.keys(config.agents);
}

/**
 * Ottiene l'AgentManifest (record agenti + nome primario).
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns AgentManifest
 */
export async function getManifest(filePath?: string): Promise<AgentManifest> {
  return getAgentManifest(filePath);
}

/**
 * Conta gli agenti per modalità.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Conteggi: totale, primary, subagent
 */
export async function countAgents(filePath?: string): Promise<{
  total: number;
  primary: number;
  subagent: number;
}> {
  const config = await parseOpenCode(filePath);
  const agents = Object.values(config.agents);
  return {
    total: agents.length,
    primary: agents.filter((a) => a.mode === 'primary').length,
    subagent: agents.filter((a) => a.mode === 'subagent').length,
  };
}

/**
 * Restituisce gli agenti che hanno una skill associata.
 *
 * @param filePath - Percorso alternativo a opencode.json (opzionale)
 * @returns Agenti con hasSkill === true
 */
export async function getSkilledAgents(filePath?: string): Promise<Agent[]> {
  const config = await parseOpenCode(filePath);
  return Object.values(config.agents).filter((a) => a.hasSkill);
}
