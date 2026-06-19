-- Migration: 006_create_bugs.sql
-- Fase 7: FABRICA — Developer Tooling
-- Crea la tabella bugs per il bug tracking strutturato.
--
-- Design:
--   - Tabella dedicata con ciclo di vita (open → in_progress → fixed → verified → closed)
--   - severity con CHECK constraint per valori validi
--   - root_cause_category per classificazione della causa
--   - affected_files come JSON array per tracciamento file coinvolti
--   - fix_ref per collegamento a commit o PR
--   - Indici per le query più frequenti: status, severity, component, created_at, assigned_to
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- Bugs: sistema di bug tracking strutturato
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bugs (
    id                  TEXT PRIMARY KEY,              -- 'bug_' + uuid
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    component           TEXT NOT NULL,                 -- modulo o area colpita
    severity            TEXT NOT NULL CHECK(severity IN ('cosmetic','minor','major','critical','blocker')),
    -- ciclo di vita: open → in_progress → fixed → verified → closed
    status              TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','fixed','verified','closed')),
    root_cause_category TEXT,                          -- 'logic', 'typo', 'regression', 'config', 'external', 'unknown'
    affected_files      TEXT,                          -- JSON array ["src/file1.ts", "src/file2.ts"]
    fix_ref             TEXT,                          -- commit hash o PR number
    reported_by         TEXT NOT NULL,                 -- agente che ha riportato
    assigned_to         TEXT,                          -- agente assegnato
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at           TEXT,
    tags                TEXT                           -- JSON opzionale
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per stato (dashboard/triage)
CREATE INDEX IF NOT EXISTS idx_bugs_status
    ON bugs(status);

-- Query per severity (priorità)
CREATE INDEX IF NOT EXISTS idx_bugs_severity
    ON bugs(severity);

-- Query per componente (filtro area)
CREATE INDEX IF NOT EXISTS idx_bugs_component
    ON bugs(component);

-- Query per ordinamento temporale
CREATE INDEX IF NOT EXISTS idx_bugs_created_at
    ON bugs(created_at);

-- Query per assegnatario
CREATE INDEX IF NOT EXISTS idx_bugs_assigned_to
    ON bugs(assigned_to);

-- ──────────────────────────────────────────
-- Trigger: aggiorna updated_at automaticamente
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_bugs_updated_at
    AFTER UPDATE ON bugs
BEGIN
    UPDATE bugs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ──────────────────────────────────────────
-- Trigger: imposta closed_at quando il bug viene chiuso
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_bugs_closed
    AFTER UPDATE OF status ON bugs
    WHEN NEW.status = 'closed' AND OLD.status != 'closed'
BEGIN
    UPDATE bugs SET closed_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('006_create_bugs');
