/**
 * core/oracle-engine.ts
 * Motore predittivo per l'Oracolo — combina trend analysis, semantic search
 * e pattern di errore per generare raccomandazioni proattive.
 *
 * @module core/oracle-engine
 */

import { getDatabase } from './database.js';
import { semanticSearch, type SemanticResult } from './semantic-search.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface OraclePrediction {
  agent: string;
  task: string;
  recommendedModel?: string;
  relevantKnowledge: Array<{ id: string; title: string }>;
  similarDecisions: Array<{ adr_id: string; title: string }>;
  commonPitfalls: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Predizione principale
// ---------------------------------------------------------------------------

/**
 * Predice raccomandazioni per un agente che inizia un task.
 * Combina:
 * 1. Ricerca semantica su knowledge base → knowledge pertinente
 * 2. Ricerca semantica su decisioni → decisioni simili
 * 3. Pattern di errore → pitfalls comuni
 * 4. Storico modelli → miglior modello raccomandato
 *
 * @param agent - Nome dell'agente
 * @param task - Descrizione del task
 * @returns OraclePrediction con raccomandazioni e confidence score
 */
export async function predictForTask(
  agent: string,
  task: string
): Promise<OraclePrediction> {
  const prediction: OraclePrediction = {
    agent,
    task,
    relevantKnowledge: [],
    similarDecisions: [],
    commonPitfalls: [],
    confidence: 0,
  };

  if (!task || !task.trim()) {
    return prediction;
  }

  let factors = 0;
  let totalWeight = 0;

  // 1. Knowledge pertinente (peso: 0.3)
  try {
    const knowledgeResults = await semanticSearch(task, 'knowledge', 5);
    if (knowledgeResults.length > 0) {
      prediction.relevantKnowledge = knowledgeResults.map(mapToTitleOnly);
      factors++;
      totalWeight += 0.3;
    }
  } catch {
    // Ricerca semantica non disponibile — procedi senza
  }

  // 2. Decisioni simili (peso: 0.25)
  try {
    const decisionResults = await semanticSearch(task, 'decision', 5);
    if (decisionResults.length > 0) {
      prediction.similarDecisions = decisionResults.map(mapToDecisionRef);
      factors++;
      totalWeight += 0.25;
    }
  } catch {
    // Ricerca semantica non disponibile — procedi senza
  }

  // 3. Modello raccomandato (peso: 0.25)
  try {
    const suggested = suggestModel(agent, task);
    if (suggested) {
      prediction.recommendedModel = suggested;
      factors++;
      totalWeight += 0.25;
    }
  } catch {
    // Analisi modelli non disponibile — procedi senza
  }

  // 4. Pitfalls comuni (peso: 0.2)
  try {
    const pitfalls = findCommonPitfalls(agent);
    if (pitfalls.length > 0) {
      prediction.commonPitfalls = pitfalls;
      factors++;
      totalWeight += 0.2;
    }
  } catch {
    // Trend analysis non disponibile — procedi senza
  }

  // Calcola confidence: rapporto tra peso ottenuto e peso massimo
  // Massimo peso teorico: 0.3 + 0.25 + 0.25 + 0.2 = 1.0
  prediction.confidence = Math.round(totalWeight * 100);

  return prediction;
}

// ---------------------------------------------------------------------------
// Suggerimento modello
// ---------------------------------------------------------------------------

/**
 * Suggerisce il modello migliore per un agente e tipo di task.
 * Analizza lo storico dei modelli usati per task simili e restituisce
 * quello con il tasso di successo più alto.
 *
 * Euristica:
 * - Se l'agente ha usato un modello con successo in passato per task simili → suggeriscilo
 * - Se nessun dato storico → undefined
 * - Matching per keyword nel task description
 *
 * @param agent - Nome dell'agente
 * @param taskDescription - Descrizione del task
 * @returns Nome del modello raccomandato o undefined
 */
export function suggestModel(
  agent: string,
  taskDescription: string
): string | undefined {
  try {
    const db = getDatabase();

    // Analizza modelli usati dall'agente per task_completed
    const modelStats = db.prepare(`
      SELECT
        json_extract(e.details, '$.model') as model_name,
        COUNT(*) as total_events,
        SUM(CASE WHEN e.event_type = 'task_completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN e.event_type = 'task_failed' THEN 1 ELSE 0 END) as failed
      FROM events e
      WHERE e.agent_name = ?
        AND json_extract(e.details, '$.model') IS NOT NULL
        AND e.event_type IN ('task_completed', 'task_failed')
      GROUP BY model_name
      ORDER BY completed DESC
      LIMIT 10
    `).all(agent) as Array<{
      model_name: string;
      total_events: number;
      completed: number;
      failed: number;
    }>;

    if (modelStats.length === 0) {
      return undefined;
    }

    // Trova il modello con il miglior tasso di successo (minimo 2 eventi)
    let bestModel: string | undefined;
    let bestScore = 0;

    for (const stat of modelStats) {
      if (stat.total_events < 2) continue; // Dati insufficienti
      const successRate = stat.total_events > 0
        ? stat.completed / stat.total_events
        : 0;

      // Bonus se il modello è stato usato più volte
      const volumeBonus = Math.min(stat.total_events / 10, 0.2);
      const score = successRate + volumeBonus;

      if (score > bestScore) {
        bestScore = score;
        bestModel = stat.model_name;
      }
    }

    return bestModel;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pitfalls comuni
// ---------------------------------------------------------------------------

/**
 * Trova pattern di errore ricorrenti per un agente specifico.
 * Cerca tra gli eventi di errore (task_failed, error_encountered)
 * e restituisce i pattern più frequenti.
 *
 * @param agent - Nome dell'agente
 * @returns Array di stringhe descrittive dei pitfalls trovati
 */
export function findCommonPitfalls(agent: string): string[] {
  try {
    const db = getDatabase();

    // Cerca errori recenti per l'agente
    const errorRows = db.prepare(`
      SELECT summary, details, timestamp
      FROM events
      WHERE agent_name = ?
        AND event_type IN ('task_failed', 'error_encountered')
      ORDER BY timestamp DESC
      LIMIT 50
    `).all(agent) as Array<{
      summary: string;
      details: string;
      timestamp: string;
    }>;

    if (errorRows.length === 0) {
      return [];
    }

    // Raggruppa per pattern normalizzato
    const patternCount = new Map<string, { count: number; example: string }>();

    for (const row of errorRows) {
      const normalized = normalizeSummary(row.summary);
      if (!normalized) continue;

      if (!patternCount.has(normalized)) {
        patternCount.set(normalized, { count: 0, example: row.summary });
      }
      patternCount.get(normalized)!.count++;
    }

    // Restituisci i pattern più frequenti (minimo 2 occorrenze)
    const pitfalls: string[] = [];
    const sorted = Array.from(patternCount.entries())
      .sort((a, b) => b[1].count - a[1].count);

    for (const [pattern, data] of sorted) {
      if (data.count >= 2) {
        pitfalls.push(`${data.example.substring(0, 120)} (×${data.count})`);
      }
    }

    return pitfalls.slice(0, 5);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Normalizza un summary per raggruppare errori simili.
 */
function normalizeSummary(summary: string): string | null {
  if (!summary || !summary.trim()) return null;

  const normalized = summary
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 10 ? normalized : null;
}

/**
 * Mappa un risultato semantico a un riferimento { id, title }.
 */
function mapToTitleOnly(result: SemanticResult): { id: string; title: string } {
  const snippet = result.snippet || '';
  const title = snippet.includes(':')
    ? snippet.split(':')[0].trim()
    : snippet.substring(0, 100);

  return {
    id: result.id,
    title,
  };
}

/**
 * Mappa un risultato semantico di tipo 'decision' a un riferimento ADR.
 */
function mapToDecisionRef(result: SemanticResult): { adr_id: string; title: string } {
  const snippet = result.snippet || '';

  // Estrai adr_id dal formato "[ADR-XXX] description"
  let adrId = '';
  let title = snippet;

  const match = snippet.match(/^\[([A-Z]+-\d+)\]\s*(.*)/);
  if (match) {
    adrId = match[1];
    title = match[2].substring(0, 150);
  }

  return {
    adr_id: adrId || result.id,
    title,
  };
}
