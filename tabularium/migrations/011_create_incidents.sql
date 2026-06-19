-- Migration: 011_create_incidents.sql
-- Fase 8: PANTHEON — Estensioni di Dominio
-- Crea la tabella incidents per l'Incident Management con ciclo di vita
-- detected → mitigated → resolved.
--
-- Design:
--   - Tabella dedicata con ciclo di vita (detected → mitigated → resolved)
--   - severity con CHECK constraint per valori validi
--   - Domain per classificazione: quality, perf, security, test, devops
--   - Source per origine: quality_gate, regression_detector, manual
--   - Indici per le query più frequenti: status, severity, detected_at
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- Incidents: sistema di Incident Management
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
    id              TEXT PRIMARY KEY,              -- 'inc_' + uuid
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK(severity IN ('minor','major','critical')),
    -- ciclo di vita: detected → mitigated → resolved
    status          TEXT NOT NULL DEFAULT 'detected' CHECK(status IN ('detected','mitigated','resolved')),
    domain          TEXT,                          -- quality | perf | security | test | devops
    source          TEXT,                          -- quality_gate | regression_detector | manual
    detected_at     TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601
    mitigated_at    TEXT,                          -- ISO 8601 (nullable)
    mitigated_by    TEXT,                          -- agente o utente che ha mitigato
    resolved_at     TEXT,                          -- ISO 8601 (nullable)
    resolved_by     TEXT,                          -- agente o utente che ha risolto
    root_cause      TEXT,                          -- causa radice identificata
    action_taken    TEXT,                          -- azione intrapresa per risolvere
    tags            TEXT                           -- JSON opzionale
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per stato (dashboard incidenti attivi)
CREATE INDEX IF NOT EXISTS idx_incidents_status
    ON incidents(status);

-- Query per severity (priorità)
CREATE INDEX IF NOT EXISTS idx_incidents_severity
    ON incidents(severity);

-- Query per ordinamento temporale
CREATE INDEX IF NOT EXISTS idx_incidents_detected_at
    ON incidents(detected_at);

-- ──────────────────────────────────────────
-- Trigger: aggiorna mitigated_at automaticamente
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_incidents_mitigated
    AFTER UPDATE OF status ON incidents
    WHEN NEW.status = 'mitigated' AND OLD.status != 'mitigated'
BEGIN
    UPDATE incidents SET mitigated_at = datetime('now') WHERE id = NEW.id;
END;

-- ──────────────────────────────────────────
-- Trigger: aggiorna resolved_at automaticamente
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_incidents_resolved
    AFTER UPDATE OF status ON incidents
    WHEN NEW.status = 'resolved' AND OLD.status != 'resolved'
BEGIN
    UPDATE incidents SET resolved_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('011_create_incidents');
