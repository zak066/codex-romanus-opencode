// ============================================================
// Praetorium — Advisory: Algoritmo di scoring per le raccomandazioni
// ============================================================
//
// Per ogni agente e ogni modello matchato, calcola uno score pesato
// basato su: intelligenza, velocità, costo, e reasoning.
//
// Formula:
//   score = w_I × I_norm + w_S × S_norm + w_C × (1 - P_norm) + w_R × R
//
// Dove:
//   - I_norm, S_norm, P_norm sono normalizzati min-max su tutto il set
//   - R = 1 se il modello ha reasoning e l'agente lo richiede
//   - I pesi (w_I, w_S, w_C, w_R) dipendono da agente e modalità
//
// Tie-breaking: a parità di score, vince il modello più economico.
// ============================================================

import type { AdvisoryMode, MatchedModel, ModelScore, ScoreBreakdown } from './types';
import { AGENT_PROFILES, getWeights } from './profiles';
import type { AgentProfile } from './profiles';

// ============================================================
// Funzione principale
// ============================================================

/**
 * Calcola gli score per tutti gli agenti e tutti i modelli matchati,
 * per una data modalità.
 *
 * Per ogni agente: calcola lo score di ogni modello, ordina per score
 * decrescente, e seleziona i top 3.
 *
 * @param matchedModels - Modelli matchati dalla pipeline
 * @param mode - Modalità di raccomandazione ('high' | 'budget')
 * @returns Mappa agentId → array di ModelScore (top 3)
 */
export function scoreModels(
  matchedModels: MatchedModel[],
  mode: AdvisoryMode,
): Record<string, ModelScore[]> {
  if (matchedModels.length === 0) {
    return {};
  }

  // Pre-calcola le normalizzazioni min-max su tutto il set
  const norms = computeNormalizations(matchedModels);

  const result: Record<string, ModelScore[]> = {};

  // Per ogni agente, calcola gli score per tutti i modelli
  for (const profile of Object.values(AGENT_PROFILES)) {
    const weights = getWeights(profile, mode);
    const scores: ModelScore[] = [];

    for (const model of matchedModels) {
      const breakdown = computeBreakdown(model, weights, norms);
      const score = sumBreakdown(breakdown);

      scores.push({
        model,
        score: Math.round(score * 1000) / 1000, // arrotonda a 3 decimali
        breakdown: {
          intelligenceComponent: Math.round(breakdown.intelligenceComponent * 1000) / 1000,
          speedComponent: Math.round(breakdown.speedComponent * 1000) / 1000,
          costComponent: Math.round(breakdown.costComponent * 1000) / 1000,
          reasoningComponent: Math.round(breakdown.reasoningComponent * 1000) / 1000,
        },
      });
    }

    // Ordina per score decrescente, tie-break per prezzo crescente
    scores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.model.price - b.model.price;
    });

    // Prendi top 3
    result[profile.agentId] = scores.slice(0, 3);
  }

  return result;
}

// ============================================================
// Normalizzazione min-max
// ============================================================

interface NormalizedMetrics {
  I_min: number;
  I_max: number;
  S_min: number;
  S_max: number;
  P_min: number;
  P_max: number;
}

/**
 * Calcola i valori min/max per ciascuna metrica su tutto il set
 * di modelli matchati. Questi servono per la normalizzazione min-max.
 */
function computeNormalizations(models: MatchedModel[]): NormalizedMetrics {
  let I_min = Infinity, I_max = -Infinity;
  let S_min = Infinity, S_max = -Infinity;
  let P_min = Infinity, P_max = -Infinity;

  for (const m of models) {
    if (m.intelligence > 0) {
      I_min = Math.min(I_min, m.intelligence);
      I_max = Math.max(I_max, m.intelligence);
    }
    if (m.speed > 0) {
      S_min = Math.min(S_min, m.speed);
      S_max = Math.max(S_max, m.speed);
    }
    if (m.price > 0) {
      P_min = Math.min(P_min, m.price);
      P_max = Math.max(P_max, m.price);
    }
  }

  // Fallback se tutti i valori sono 0
  if (I_min === Infinity) { I_min = 0; I_max = 1; }
  if (S_min === Infinity) { S_min = 0; S_max = 1; }
  if (P_min === Infinity) { P_min = 0; P_max = 1; }

  // Evita divisione per zero se min === max
  if (I_min === I_max) I_max = I_min + 0.001;
  if (S_min === S_max) S_max = S_min + 0.001;
  if (P_min === P_max) P_max = P_min + 0.001;

  return { I_min, I_max, S_min, S_max, P_min, P_max };
}

// ============================================================
// Calcolo componenti score
// ============================================================

interface Weights {
  intelligence: number;
  speed: number;
  cost: number;
  reasoning: number;
}

/**
 * Calcola il breakdown dello score per un modello verso un agente.
 *
 * @param model - Il modello valutato
 * @param weights - I pesi per l'agente nella modalità corrente
 * @param norms - I valori min/max per la normalizzazione
 * @returns Oggetto ScoreBreakdown con i 4 componenti
 */
function computeBreakdown(
  model: MatchedModel,
  weights: Weights,
  norms: NormalizedMetrics,
): ScoreBreakdown {
  // Normalizzazione min-max
  const I_norm = model.intelligence > 0
    ? (model.intelligence - norms.I_min) / (norms.I_max - norms.I_min)
    : 0;

  const S_norm = model.speed > 0
    ? (model.speed - norms.S_min) / (norms.S_max - norms.S_min)
    : 0;

  const P_norm = model.price > 0
    ? (model.price - norms.P_min) / (norms.P_max - norms.P_min)
    : 0;

  // Componente reasoning: 1 se il modello ha reasoning e l'agente lo richiede
  // Nota: il profilo potrebbe avere weightReasoning > 0 anche se requiresReasoning è false
  // In quel caso R sarà comunque 0.
  const R = model.hasReasoning ? 1 : 0;

  return {
    intelligenceComponent: weights.intelligence * I_norm,
    speedComponent: weights.speed * S_norm,
    costComponent: weights.cost * (1 - P_norm),
    reasoningComponent: weights.reasoning * R,
  };
}

/**
 * Somma i 4 componenti del breakdown.
 */
function sumBreakdown(breakdown: ScoreBreakdown): number {
  return (
    breakdown.intelligenceComponent +
    breakdown.speedComponent +
    breakdown.costComponent +
    breakdown.reasoningComponent
  );
}

// ============================================================
// Utility esportate
// ============================================================

/**
 * Restituisce il profilo di un agente dato il suo ID.
 *
 * @param agentId - ID dell'agente (es. "iuppiter-orchestrator")
 * @returns AgentProfile o undefined se l'ID non è valido
 */
export function getAgentProfile(agentId: string): AgentProfile | undefined {
  return AGENT_PROFILES[agentId];
}
