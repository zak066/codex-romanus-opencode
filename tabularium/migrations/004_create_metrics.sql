-- Migration: 004_create_metrics.sql
-- Fase 5: CENSUS — Metrics Engine per Time-Series Universale
-- Crea la tabella metrics per tracciamento storico di metriche
-- di qualità, performance, sicurezza, test e SEO.
--
-- Design:
--   - Tabella unica con domain come discriminatore
--   - REAL per valori numerici (percentuali, latenze, conteggi)
--   - Tags come JSON object per metadati strutturati
--   - Indice composito primario su (domain, metric_name, recorded_at)
--   - Consistency con timestamp TEXT ISO 8601 (come sessions, events)

-- ──────────────────────────────────────────
-- Metrics: tracciamento time-series universale
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
    id              TEXT PRIMARY KEY,           -- UUID v4 (es. 'mtr_a1b2c3d4')
    domain          TEXT NOT NULL,              -- discrimina il dominio applicativo
                                                -- quality | perf | security | test | seo | devops
    metric_name     TEXT NOT NULL,              -- nome della metrica (es. 'lint_errors', 'p95_latency')
    value           REAL NOT NULL,              -- valore numerico (REAL per decimali/percentuali)
    tags            TEXT DEFAULT '{}',          -- JSON object: { "agent": "vulcanus", "file": "src/...", "branch": "main" }
    recorded_at     TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601: quando è stata registrata la metrica
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))   -- ISO 8601: momento inserimento record
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Indice composito principale: lookup per dominio + metrica + range temporale
-- Usato da: queryMetrics(domain, metric_name, from, to)
CREATE INDEX IF NOT EXISTS idx_metrics_lookup
    ON metrics(domain, metric_name, recorded_at DESC);

-- Indice per query su intero dominio (senza metric_name)
-- Usato da: queryMetrics(domain) — tutte le metriche di un dominio
CREATE INDEX IF NOT EXISTS idx_metrics_domain
    ON metrics(domain, recorded_at DESC);

-- Indice per query cross-dominio su una specifica metrica
-- Usato da: trend analyzer che confronta stessa metrica su più domini
CREATE INDEX IF NOT EXISTS idx_metrics_name
    ON metrics(metric_name, recorded_at DESC);

-- Indice per ordinamento temporale in query aggregate
CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at
    ON metrics(recorded_at DESC);

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('004_create_metrics');
