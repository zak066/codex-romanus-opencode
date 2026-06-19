/**
 * Tipi per i modelli AI utilizzati dagli agenti.
 * Configurazione in opencode.json.
 */

export interface Model {
  id: string;
  provider: string;
  context?: string;
  cost?: string;
}

export interface ModelAssignment {
  agent: string;
  model: string;
}

/**
 * Mappa dei modelli disponibili.
 */
export interface ModelRegistry {
  models: Record<string, Model>;
  updatedAt: string;
}
