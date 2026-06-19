/**
 * decisions-parser.ts
 * Parser per il file docs/codex-romanus/decisions.md.
 * Estrae le decisioni architetturali (ADR) prese dal team.
 * Dinamico: funziona con qualsiasi numero di ADR e agenti.
 *
 * @module core/decisions-parser
 */

import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { Decision, DecisionLog } from '../types/decision.js';
import { decisionsCache } from './cache.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Path di default per docs/codex-romanus/decisions.md. */
const DEFAULT_DECISIONS_PATH = path.resolve(process.cwd(), 'docs', 'codex-romanus', 'decisions.md');

/** Regex per la riga di aggiornamento. */
const UPDATED_REGEX = /Updated[:\s]+(\d{4}-\d{2}-\d{2}[T\s].*)/i;

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
 * Estrae un campo dal corpo di una sezione ADR.
 * Cerca il pattern: `- **Campo**: valore`
 *
 * @param body - Corpo della sezione (dopo l'intestazione)
 * @param fieldName - Nome del campo da estrarre (es. "Decisione", "Motivazione")
 * @returns Valore del campo o stringa vuota
 */
function extractField(body: string, fieldName: string): string {
  // Escape per caratteri speciali nel nome campo
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`-\\s*\\*\\*${escaped}\\*\\*:\\s*(.+)`, 'i');
  const match = body.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Estrae le decisioni dal contenuto markdown.
 *
 * Formato atteso per ogni ADR:
 *
 * ```
 * ### ADR-001: Titolo della decisione
 * - **Decisione**: ...
 * - **Motivazione**: ...
 * - **Agente**: @nome-agente
 * - **Data**: 2024-01-15
 * ```
 *
 * @param content - Contenuto completo del file markdown
 * @returns Array di decisioni parsate
 */
function extractDecisionsFromMarkdown(content: string): Decision[] {
  const decisions: Decision[] = [];

  // Splitta per le intestazioni ###
  const sections = content.split(/^###\s+/gm);

  for (const section of sections) {
    // Salta la parte prima della prima intestazione o sezioni vuote
    if (!section.trim()) continue;

    const headerMatch = section.match(/^(ADR-\d+):\s*(.+)/);
    if (!headerMatch) continue;

    const [, adrId, title] = headerMatch;
    const body = section.slice(headerMatch[0].length);

    const rawAgent = extractField(body, 'Agente');

    decisions.push({
      adr_id: adrId.trim(),
      title: title.trim(),
      decision: extractField(body, 'Decisione'),
      motivation: extractField(body, 'Motivazione'),
      agent: rawAgent.replace(/^@/, '').trim(),
      date: extractField(body, 'Data') || undefined,
    });
  }

  return decisions;
}

/**
 * Estrae la data di ultima modifica dal contenuto del file.
 *
 * @param content - Contenuto del file markdown
 * @returns Data ISO o undefined
 */
function extractDate(content: string): string | undefined {
  const match = content.match(UPDATED_REGEX);
  if (!match) return undefined;
  const raw = match[1].trim();
  return raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Carica e parsa il file docs/codex-romanus/decisions.md.
 * Restituisce l'elenco delle decisioni architetturali (ADR).
 * Se il file non esiste, restituisce un log vuoto (non lancia errore).
 *
 * Utilizza cache in-memory con TTL di 60 secondi.
 *
 * @param filePath - Percorso alternativo a decisions.md (opzionale)
 * @returns DecisionLog con decisioni parsate e metadati
 *
 * @example
 * ```ts
 * const log = await parseDecisions();
 * console.log(`Trovate ${log.total} decisioni`);
 * ```
 */
export async function parseDecisions(filePath?: string): Promise<DecisionLog> {
  const resolvedPath = filePath ?? DEFAULT_DECISIONS_PATH;

  // Cache check
  const cacheKey = `decisions:${resolvedPath}`;
  const cached = decisionsCache.get(cacheKey) as DecisionLog | undefined;
  if (cached) return cached;

  try {
    const exists = await fileExists(resolvedPath);
    if (!exists) {
      const empty: DecisionLog = {
        decisions: [],
        updatedAt: new Date().toISOString(),
        total: 0,
      };
      decisionsCache.set(cacheKey, empty);
      return empty;
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const decisions = extractDecisionsFromMarkdown(content);
    const updatedAt = extractDate(content) ?? new Date().toISOString();

    const result: DecisionLog = { decisions, updatedAt, total: decisions.length };
    decisionsCache.set(cacheKey, result);

    return result;
  } catch (err) {
    throw new Error(
      `Failed to parse decisions file at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/**
 * Cerca decisioni per termine nel titolo, decisione o motivazione.
 *
 * @param query - Testo da cercare (case-insensitive)
 * @param filePath - Percorso alternativo a decisions.md (opzionale)
 * @returns Decisioni che corrispondono alla query
 *
 * @example
 * ```ts
 * const results = await searchDecisions('cache');
 * ```
 */
export async function searchDecisions(
  query: string,
  filePath?: string
): Promise<Decision[]> {
  const log = await parseDecisions(filePath);
  const q = query.toLowerCase();
  return log.decisions.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.decision.toLowerCase().includes(q) ||
      d.motivation.toLowerCase().includes(q)
  );
}

/**
 * Restituisce le decisioni prese da un agente specifico.
 *
 * @param agentName - Nome dell'agente (con o senza @)
 * @param filePath - Percorso alternativo a decisions.md (opzionale)
 * @returns Decisioni filtrate per agente
 */
export async function getDecisionsByAgent(
  agentName: string,
  filePath?: string
): Promise<Decision[]> {
  const log = await parseDecisions(filePath);
  const name = agentName.replace(/^@/, '').toLowerCase();
  return log.decisions.filter((d) => d.agent.toLowerCase() === name);
}

/**
 * Restituisce l'ultima decisione registrata.
 *
 * @param filePath - Percorso alternativo a decisions.md (opzionale)
 * @returns Ultima decisione o undefined se non ce ne sono
 */
export async function getLatestDecision(
  filePath?: string
): Promise<Decision | undefined> {
  const log = await parseDecisions(filePath);
  return log.decisions.length > 0
    ? log.decisions[log.decisions.length - 1]
    : undefined;
}

/**
 * Restituisce statistiche sulle decisioni.
 *
 * @param filePath - Percorso alternativo a decisions.md (opzionale)
 * @returns Statistiche: totale, agenti coinvolti, date
 */
export async function getDecisionStats(filePath?: string): Promise<{
  total: number;
  updatedAt: string;
  agents: string[];
}> {
  const log = await parseDecisions(filePath);
  const agents = [...new Set(log.decisions.map((d) => d.agent))].sort();
  return { total: log.total, updatedAt: log.updatedAt, agents };
}
