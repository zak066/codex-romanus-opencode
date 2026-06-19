/**
 * Tipi per le decisioni architetturali (ADR).
 * Tracciate in docs/codex-romanus/decisions.md.
 */

export interface Decision {
  adr_id: string;
  title: string;
  decision: string;
  motivation: string;
  agent: string;
  date?: string;
}

/**
 * Risultato del parsing delle decisioni.
 */
export interface DecisionLog {
  decisions: Decision[];
  updatedAt: string;
  total: number;
}
