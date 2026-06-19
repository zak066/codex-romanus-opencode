-- Migration: 005_create_alerts.sql
-- Fase 6: AUTOMATA — Pipeline di Qualità Automatizzata con Alert Proattivi
-- Crea la tabella alerts per il sistema di alert centralizzato.
--
-- Design:
--   - Tabella dedicata con ciclo di vita (open → acknowledged → resolved)
--   - severity con CHECK constraint per valori validi
--   - status esplicito con CHECK per garantire integrità del ciclo di vita
--   - current_value / threshold_value / deviation_pct per contesto numerico
--   - Indici per le query più frequenti: status, severity, domain, created_at
--   - Trigger automatico per resolved_at
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- Alerts: sistema di alert centralizzato
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id                TEXT PRIMARY KEY,              -- 'alr_' + uuid
    domain            TEXT NOT NULL,                 -- quality | perf | security | test | seo | devops
    metric_name       TEXT NOT NULL,                 -- es. "lint_errors", "coverage_pct"
    severity          TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    source            TEXT NOT NULL CHECK (source IN ('quality_gate','regression_detector','manual')),
    message           TEXT NOT NULL,
    current_value     REAL,                          -- valore corrente che ha generato l'alert
    threshold_value   REAL,                          -- soglia violata
    deviation_pct     REAL,                          -- deviazione percentuale
    -- ciclo di vita: open → acknowledged → resolved
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),    -- ISO 8601
    acknowledged_at   TEXT,                          -- ISO 8601 (nullable)
    acknowledged_by   TEXT,                          -- agente o utente che ha acknowledge
    resolved_at       TEXT,                          -- ISO 8601 (nullable, gestito da trigger)
    resolved_by       TEXT,                          -- agente o utente che ha risolto
    tags              TEXT                           -- JSON opzionale: {"agent":"catone","baseline":12.5}
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query più comune: alert per status (dashboard)
CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts(status);

-- Query per severity (priorità)
CREATE INDEX IF NOT EXISTS idx_alerts_severity
    ON alerts(severity);

-- Query per dominio (filtro agente)
CREATE INDEX IF NOT EXISTS idx_alerts_domain
    ON alerts(domain);

-- Query per ordinamento temporale
CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts(created_at);

-- Query per origine alert (quality_gate vs regression_detector)
CREATE INDEX IF NOT EXISTS idx_alerts_source
    ON alerts(source);

-- ──────────────────────────────────────────
-- Trigger: aggiorna resolved_at automaticamente
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_alerts_resolved
    AFTER UPDATE OF status ON alerts
    WHEN NEW.status = 'resolved' AND OLD.status != 'resolved'
BEGIN
    UPDATE alerts SET resolved_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('005_create_alerts');
