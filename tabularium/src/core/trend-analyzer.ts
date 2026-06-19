/**
 * core/trend-analyzer.ts
 * Analisi dei trend di produttività, efficacia modelli e pattern di errore.
 * Legge eventi e sessioni dal database per generare report predittivi.
 *
 * Supporta ora anche l'analisi di trend su metriche numeriche
 * tramite metrics-engine (Fase 5 — CENSUS).
 *
 * @module core/trend-analyzer
 */

import { getDatabase } from './database.js';
import { queryTrend } from './metrics-engine.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface ModelEffectiveness {
  model: string;
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number;
  avgEventsPerSession: number;
}

export interface AgentProductivity {
  agent: string;
  sessionsCount: number;
  tasksCompleted: number;
  decisionsMade: number;
  knowledgeContributed: number;
  mostActiveHour: number;
}

export interface ErrorPattern {
  pattern: string;
  occurrences: number;
  affectedAgents: string[];
  firstSeen: string;
  lastSeen: string;
  trending: 'increasing' | 'decreasing' | 'stable';
}

// ──────────────────────────────────────────────
//  Nuovi tipi per supporto dominio metrics (Fase 5 — CENSUS)
// ──────────────────────────────────────────────

/** Risultato trend per una metrica di un dominio specifico */
export interface DomainMetricTrend {
  domain: string;
  metric_name: string;
  previous_avg: number;
  current_avg: number;
  delta: number;
  delta_pct: number;
  direction: 'up' | 'down' | 'stable';
}

/** Sommario trend per dominio */
export interface DomainTrendSummary {
  domain: string;
  metrics: DomainMetricTrend[];
  error_rate: ErrorPattern[];
}

// ---------------------------------------------------------------------------
// Model Effectiveness
// ---------------------------------------------------------------------------

/**
 * Analizza l'efficacia dei modelli usati dagli agenti.
 * Estrae il modello dal campo `details` JSON degli eventi e calcola
 * tasso di successo e produttività media per modello.
 *
 * @returns Array di ModelEffectiveness ordinato per successRate decrescente
 */
export function analyzeModelEffectiveness(): ModelEffectiveness[] {
  try {
    const db = getDatabase();

    // Estrai eventi task_completed e task_failed con dettaglio modello
    const rows = db.prepare(`
      SELECT
        e.event_type,
        e.details,
        e.session_id,
        (SELECT COUNT(*) FROM events sub WHERE sub.session_id = e.session_id) as session_event_count
      FROM events e
      WHERE e.event_type IN ('task_completed', 'task_failed')
        AND e.details IS NOT NULL
        AND e.details != '{}'
      ORDER BY e.timestamp DESC
    `).all() as Array<{
      event_type: string;
      details: string;
      session_id: string;
      session_event_count: number;
    }>;

    if (rows.length === 0) {
      return [];
    }

    // Raggruppa per modello
    const modelMap = new Map<string, {
      completed: number;
      failed: number;
      sessions: Set<string>;
      eventsPerSessionSum: number;
    }>();

    for (const row of rows) {
      let details: Record<string, unknown>;
      try {
        details = JSON.parse(row.details);
      } catch {
        continue;
      }

      const model = details.model as string | undefined;
      if (!model) continue;

      if (!modelMap.has(model)) {
        modelMap.set(model, {
          completed: 0,
          failed: 0,
          sessions: new Set(),
          eventsPerSessionSum: 0,
        });
      }

      const entry = modelMap.get(model)!;
      if (row.event_type === 'task_completed') {
        entry.completed++;
      } else if (row.event_type === 'task_failed') {
        entry.failed++;
      }
      entry.sessions.add(row.session_id);
      entry.eventsPerSessionSum += row.session_event_count;
    }

    // Costruisci risultato
    const results: ModelEffectiveness[] = [];
    for (const [model, data] of modelMap) {
      const total = data.completed + data.failed;
      const sessionCount = data.sessions.size;

      results.push({
        model,
        tasksCompleted: data.completed,
        tasksFailed: data.failed,
        successRate: total > 0 ? Math.round((data.completed / total) * 10000) / 100 : 0,
        avgEventsPerSession: sessionCount > 0
          ? Math.round((data.eventsPerSessionSum / sessionCount) * 100) / 100
          : 0,
      });
    }

    return results.sort((a, b) => b.successRate - a.successRate);
  } catch {
    // Database non disponibile o errore di query — restituisci array vuoto
    return [];
  }
}

// ---------------------------------------------------------------------------
// Agent Productivity
// ---------------------------------------------------------------------------

/**
 * Analizza la produttività degli agenti basandosi su sessioni, eventi,
 * decisioni e contributi knowledge.
 *
 * @returns Array di AgentProductivity ordinato per tasksCompleted decrescente
 */
export function analyzeAgentProductivity(): AgentProductivity[] {
  try {
    const db = getDatabase();

    // Query aggregata: sessioni, eventi per tipo per agente
    const rows = db.prepare(`
      SELECT
        s.agent_name,
        COUNT(DISTINCT s.id) as sessions_count,
        COUNT(DISTINCT CASE WHEN e.event_type = 'task_completed' THEN e.id END) as tasks_completed,
        COUNT(DISTINCT CASE WHEN e.event_type = 'decision_made' THEN e.id END) as decisions_made,
        COUNT(DISTINCT CASE WHEN e.event_type = 'knowledge_added' THEN e.id END) as knowledge_contributed,
        CAST(STRFTIME('%H', s.start_time) AS INTEGER) as start_hour
      FROM sessions s
      LEFT JOIN events e ON e.session_id = s.id
      GROUP BY s.agent_name
      ORDER BY tasks_completed DESC
    `).all() as Array<{
      agent_name: string;
      sessions_count: number;
      tasks_completed: number;
      decisions_made: number;
      knowledge_contributed: number;
      start_hour: number;
    }>;

    if (rows.length === 0) {
      return [];
    }

    // Calcola l'ora più attiva per ogni agente
    const agentHours = new Map<string, Map<number, number>>();
    for (const row of rows) {
      if (!agentHours.has(row.agent_name)) {
        agentHours.set(row.agent_name, new Map());
      }
      const hourMap = agentHours.get(row.agent_name)!;
      hourMap.set(row.start_hour, (hourMap.get(row.start_hour) ?? 0) + 1);
    }

    const results: AgentProductivity[] = rows.map((row) => {
      const hourMap = agentHours.get(row.agent_name) ?? new Map();
      let mostActiveHour = 9; // Default: 9 AM
      let maxCount = 0;
      for (const [hour, count] of hourMap) {
        if (count > maxCount) {
          maxCount = count;
          mostActiveHour = hour;
        }
      }

      return {
        agent: row.agent_name,
        sessionsCount: row.sessions_count,
        tasksCompleted: row.tasks_completed,
        decisionsMade: row.decisions_made,
        knowledgeContributed: row.knowledge_contributed,
        mostActiveHour,
      };
    });

    return results;
  } catch {
    // Database non disponibile o errore di query — restituisci array vuoto
    return [];
  }
}

// ---------------------------------------------------------------------------
// Error Trends
// ---------------------------------------------------------------------------

/**
 * Analizza i pattern di errore ricorrenti tra gli eventi,
 * rilevando trend (in aumento, in diminuzione, stabile).
 *
 * Cerca eventi di tipo 'task_failed' e 'error_encountered' nei summary/dettagli,
 * raggruppa per pattern testuale e calcola la direzione del trend
 * confrontando la frequenza recente vs storica.
 *
 * @returns Array di ErrorPattern ordinato per occurrences decrescente
 */
export function analyzeErrorTrends(): ErrorPattern[] {
  try {
    const db = getDatabase();

    // Recupera eventi di errore
    const errorEvents = db.prepare(`
      SELECT
        id,
        agent_name,
        event_type,
        summary,
        details,
        timestamp
      FROM events
      WHERE event_type IN ('task_failed', 'error_encountered')
      ORDER BY timestamp DESC
    `).all() as Array<{
      id: string;
      agent_name: string;
      event_type: string;
      summary: string;
      details: string;
      timestamp: string;
    }>;

    if (errorEvents.length === 0) {
      return [];
    }

    // Estrai pattern di errore dal summary/details
    const patternMap = new Map<string, {
      occurrences: number;
      agents: Set<string>;
      firstSeen: string;
      lastSeen: string;
      recentCount: number;  // Ultimi 7 giorni
      historicalCount: number; // Tutti gli altri
    }>();

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const event of errorEvents) {
      // Normalizza il messaggio di errore per estrarre il pattern
      const pattern = normalizeErrorPattern(event.summary, event.details);
      if (!pattern) continue;

      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, {
          occurrences: 0,
          agents: new Set(),
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
          recentCount: 0,
          historicalCount: 0,
        });
      }

      const entry = patternMap.get(pattern)!;
      entry.occurrences++;
      entry.agents.add(event.agent_name);

      if (event.timestamp < entry.firstSeen) {
        entry.firstSeen = event.timestamp;
      }
      if (event.timestamp > entry.lastSeen) {
        entry.lastSeen = event.timestamp;
      }

      if (event.timestamp >= sevenDaysAgo) {
        entry.recentCount++;
      } else {
        entry.historicalCount++;
      }
    }

    // Costruisci risultati con trend analysis
    const results: ErrorPattern[] = [];
    for (const [pattern, data] of patternMap) {
      // Determina trend: confronta recente vs storico
      let trending: 'increasing' | 'decreasing' | 'stable';

      if (data.historicalCount === 0 && data.recentCount > 0) {
        trending = 'increasing';
      } else if (data.recentCount === 0 && data.historicalCount > 0) {
        trending = 'decreasing';
      } else if (data.historicalCount > 0) {
        const recentRatio = data.recentCount / (data.recentCount + data.historicalCount);
        // Se più del 60% degli errori è recente → increasing
        // Se meno del 30% è recente → decreasing
        if (recentRatio > 0.6) {
          trending = 'increasing';
        } else if (recentRatio < 0.3) {
          trending = 'decreasing';
        } else {
          trending = 'stable';
        }
      } else {
        trending = 'stable';
      }

      results.push({
        pattern,
        occurrences: data.occurrences,
        affectedAgents: Array.from(data.agents).sort(),
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        trending,
      });
    }

    return results.sort((a, b) => b.occurrences - a.occurrences);
  } catch {
    // Database non disponibile o errore di query — restituisci array vuoto
    return [];
  }
}

// ---------------------------------------------------------------------------
// Report completo
// ---------------------------------------------------------------------------

/**
 * Genera un report completo di trend contenente:
 * - Efficacia modelli
 * - Produttività agenti
 * - Pattern di errore
 * - Trend metriche per dominio (se specificato)
 *
 * @param domain - Dominio opzionale per includere metric trend
 * @param metricNames - Metriche specifiche da analizzare per il dominio
 * @returns Report con tutti i trend e timestamp di generazione
 */
export function generateTrendReport(
  domain?: string,
  metricNames?: string[]
): {
  models: ModelEffectiveness[];
  agents: AgentProductivity[];
  errors: ErrorPattern[];
  metrics?: DomainMetricTrend[];
  generatedAt: string;
} {
  const report: {
    models: ModelEffectiveness[];
    agents: AgentProductivity[];
    errors: ErrorPattern[];
    metrics?: DomainMetricTrend[];
    generatedAt: string;
  } = {
    models: analyzeModelEffectiveness(),
    agents: analyzeAgentProductivity(),
    errors: analyzeErrorTrends(),
    generatedAt: new Date().toISOString(),
  };

  // Se è specificato un dominio, aggiungi metric trend
  if (domain) {
    report.metrics = analyzeDomainMetricTrends(domain, metricNames);
  }

  return report;
}

/**
 * Analizza il trend di una singola metrica per un dominio specifico.
 * Delega a queryTrend del metrics-engine (Fase 5 — CENSUS).
 *
 * @param domain - Dominio della metrica (quality, perf, security, test, seo, devops)
 * @param metricName - Nome della metrica
 * @param days - Finestra di confronto in giorni (default: 7)
 * @param tags - Filtro opzionale su tag
 * @returns DomainMetricTrend con delta e direzione
 */
export function analyzeMetricTrend(
  domain: string,
  metricName: string,
  days: number = 7,
  tags?: Record<string, string>
): DomainMetricTrend {
  try {
    const trend = queryTrend(domain, metricName, days, tags);

    return {
      domain: trend.domain,
      metric_name: trend.metric_name,
      previous_avg: trend.previous_avg,
      current_avg: trend.current_avg,
      delta: trend.delta,
      delta_pct: trend.delta_pct,
      direction: trend.direction,
    };
  } catch {
    return {
      domain,
      metric_name: metricName,
      previous_avg: 0,
      current_avg: 0,
      delta: 0,
      delta_pct: 0,
      direction: 'stable',
    };
  }
}

/**
 * Analizza i trend di tutte le metriche più comuni per un dominio.
 * Le metriche analizzate dipendono dal dominio:
 *
 * - quality: lint_errors, coverage_pct, ts_errors
 * - perf: p50_latency_ms, p95_latency_ms
 * - security: vuln_critical, vuln_high
 * - test: tests_passed, tests_failed, coverage_pct
 * - seo: lighthouse_performance, lighthouse_seo
 * - devops: deploy_duration_s, build_duration_s
 *
 * @param domain - Dominio da analizzare
 * @param metricNames - Lista opzionale di metriche specifiche (sovrascrive default)
 * @returns Array di DomainMetricTrend
 */
export function analyzeDomainMetricTrends(
  domain: string,
  metricNames?: string[]
): DomainMetricTrend[] {
  const domainMetrics: Record<string, string[]> = {
    quality: ['lint_errors', 'coverage_pct', 'ts_errors', 'lint_warnings', 'bundle_size_kb'],
    perf: ['p50_latency_ms', 'p95_latency_ms', 'p99_latency_ms', 'throughput_rps'],
    security: ['vuln_critical', 'vuln_high', 'vuln_medium', 'secrets_found'],
    test: ['tests_passed', 'tests_failed', 'coverage_pct', 'tests_total'],
    seo: ['lighthouse_performance', 'lighthouse_seo', 'lighthouse_accessibility'],
    devops: ['deploy_duration_s', 'build_duration_s', 'incident_count', 'uptime_pct'],
  };

  const metrics = metricNames ?? domainMetrics[domain.toLowerCase()] ?? [];

  return metrics.map((metricName) =>
    analyzeMetricTrend(domain, metricName)
  );
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Normalizza un messaggio di errore per estrarre un pattern riconoscibile.
 * Rimuove dettagli variabili (ID, timestamp, numeri specifici) e lascia
 * la struttura generale dell'errore.
 *
 * @param summary - Riepilogo dell'evento
 * @param detailsJson - Dettagli JSON opzionali
 * @returns Pattern normalizzato o null
 */
function normalizeErrorPattern(summary: string, detailsJson: string): string | null {
  if (!summary || !summary.trim()) {
    return null;
  }

  let pattern = summary.trim();

  // Rimuovi prefissi comuni
  pattern = pattern.replace(/^(Error|Errore|Failed|Fallito|Warning):\s*/i, '');
  pattern = pattern.replace(/^(ERR|WARN|FATAL)\[.*?\]\s*/i, '');

  // Normalizza riferimenti a file e percorsi
  pattern = pattern.replace(/[A-Z]:\\[^\s:]*/gi, '<PATH>');
  pattern = pattern.replace(/\/[^\s:]*\//g, '<PATH>');

  // Normalizza UUID e ID lunghi
  pattern = pattern.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
  pattern = pattern.replace(/[0-9a-f]{16,}/gi, '<HEX>');

  // Normalizza numeri
  pattern = pattern.replace(/\d+/g, '<N>');

  // Normalizza spazi multipli
  pattern = pattern.replace(/\s+/g, ' ').trim();

  // Limita lunghezza
  if (pattern.length > 200) {
    pattern = pattern.substring(0, 200);
  }

  return pattern || null;
}
