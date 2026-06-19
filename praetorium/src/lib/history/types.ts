// ============================================================
// Praetorium — History: Tipi per la timeline degli eventi
// ============================================================

/** Tipologia di evento nella timeline */
export type HistoryEventType = 'file_change' | 'task' | 'decision';

/** Evento della timeline del progetto */
export interface HistoryEvent {
  id: string;
  type: HistoryEventType;
  timestamp: string;        // ISO 8601
  title: string;            // Evento leggibile
  description: string;      // Dettaglio
  agent?: string;           // Agente coinvolto
  metadata?: Record<string, unknown>;
}

/** Risposta dell'API /api/history */
export interface HistoryResponse {
  events: HistoryEvent[];
  total: number;
  limit: number;
}
