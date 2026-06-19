// ============================================================
// Praetorium — Advisory: Tipi specifici per la Consulenza Modelli
// ============================================================

/** Modalità di raccomandazione */
export type AdvisoryMode = 'high' | 'budget';

/** Piano di abbonamento opencode: Go, Zen, o entrambi */
export type AdvisoryPlan = 'go' | 'zen' | 'all';

/**
 * Modello parsato dalla leaderboard Artificial Analysis.
 * Rappresenta una riga della tabella leaderboard.
 */
export interface LeaderboardModel {
  /** Nome modello come appare nella leaderboard (es. "DeepSeek V4 Pro (Max)") */
  name: string;
  /** Creator (OpenAI, Anthropic, Google, DeepSeek, Meta, Mistral, ...) */
  creator: string;
  /** Intelligence Index (0-60, dove GPT-5.5 xhigh = 60) */
  intelligence: number;
  /** Prezzo in USD per 1M token (blended 7:2:1) */
  price: number;
  /** Output Speed in tokens/s mediani */
  speed: number;
  /** Time to First Token in secondi */
  latency: number;
  /** Total Response Time in secondi */
  totalResponseTime: number;
  /** Context window size */
  contextWindow: number;
}

/**
 * Modello matchato con un ID opencode.
 * Estende LeaderboardModel con i metadati opencode.
 */
export interface MatchedModel extends LeaderboardModel {
  /** ID opencode completo (es. "opencode-go/deepseek-v4-pro") */
  opencodeId: string;
  /** Provider opencode di appartenenza */
  provider: 'go' | 'zen';
  /** Se il modello supporta reasoning capabilities */
  hasReasoning: boolean;
}

/** Componenti del punteggio calcolato per trasparenza */
export interface ScoreBreakdown {
  /** Componente intelligenza: w_I × I_norm */
  intelligenceComponent: number;
  /** Componente velocità: w_S × S_norm */
  speedComponent: number;
  /** Componente costo: w_C × (1 - P_norm) */
  costComponent: number;
  /** Componente reasoning: w_R × R */
  reasoningComponent: number;
}

/** Punteggio calcolato per un modello verso un agente specifico */
export interface ModelScore {
  /** Modello valutato */
  model: MatchedModel;
  /** Score totale normalizzato [0, 1] */
  score: number;
  /** Breakdown dei componenti dello score */
  breakdown: ScoreBreakdown;
}

/** Raccomandazione completa per un agente */
export interface AgentRecommendation {
  /** ID dell'agente (es. "iuppiter-orchestrator") */
  agentId: string;
  /** Nome leggibile dell'agente */
  agentName: string;
  /** Modalità di raccomandazione */
  mode: AdvisoryMode;
  /** Top 3 modelli raccomandati, ordinati per score decrescente */
  recommendations: ModelScore[];
}

/** Risposta completa dell'API advisory */
export interface AdvisoryResponse {
  /** Modalità di raccomandazione */
  mode: AdvisoryMode;
  /** Timestamp di generazione ISO 8601 */
  generatedAt: string;
  /** Numero di modelli valutati nella pipeline */
  modelsEvaluated: number;
  /** Raccomandazioni per ciascun agente */
  agents: AgentRecommendation[];
}

/** Entry della cache advisory su file system */
export interface AdvisoryCacheEntry {
  /** Timestamp di creazione della cache ISO 8601 */
  cachedAt: string;
  /** Timestamp di scadenza della cache ISO 8601 */
  expiresAt: string;
  /** URL sorgente dei dati */
  sourceUrl: string;
  /** Numero di modelli presenti nella leaderboard al momento dello scraping */
  modelsCount: number;
  /** Dati cachati: mappa agente → raccomandazioni per entrambe le modalità */
  data: {
    high: Record<string, ModelScore[]>;
    budget: Record<string, ModelScore[]>;
  };
}
