-- Migration: 016_add_adr_file_path.sql
-- ADR-035: Adds file_path column to adr_status table
--
-- Design:
--   - ALTER TABLE ADD COLUMN per aggiungere file_path alla tabella esistente
--   - Idempotente tramite _migrations tracking (eseguito una sola volta)
--   - Indice su file_path per lookup rapidi
--   - Per database nuovi: la colonna è già inclusa in ensureAdrLifecycleSchema
--
-- Note:
--   - SQLite non supporta IF NOT EXISTS per ALTER TABLE ADD COLUMN,
--     ma il migration runner (_migrations) garantisce l'esecuzione singola.
--   - Per database esistenti: aggiunge la colonna.
--   - Per database nuovi: migration 008 crea la tabella senza file_path,
--     poi questa migration la aggiunge; ensureAdrLifecycleSchema fallback
--     con CREATE TABLE IF NOT EXISTS (no-op su tabella esistente).

-- ──────────────────────────────────────────
-- Add file_path column to adr_status
-- ──────────────────────────────────────────
ALTER TABLE adr_status ADD COLUMN file_path TEXT;

-- ──────────────────────────────────────────
-- Index for file_path lookups
-- ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_adr_file_path ON adr_status(file_path);

-- ──────────────────────────────────────────
-- Register migration (idempotent)
-- ──────────────────────────────────────────
INSERT OR IGNORE INTO _migrations (name) VALUES ('016_add_adr_file_path');
