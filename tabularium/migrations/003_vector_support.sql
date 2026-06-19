-- Migration: 003_vector_support.sql
-- Fase 3: Sinapsis — Memoria Semantica con Vector Search
-- Aggiunge colonne embedding e tabelle vettoriali per similarità semantica.
-- Usa sqlite-vec (estensione vettoriale) per ricerca efficiente.
--
-- Prerequisiti:
--   - sqlite-vec caricato come estensione SQLite
--   - Migration 001 e 002 già eseguite
--
-- Design:
--   - Colonne embedding BLOB su knowledge_entries, events, decision_rationale
--   - Tabella virtuale knowledge_vec usando vec0 per ricerca ANN veloce
--   - Indice vettoriale su 384 dimensioni (embedding standard)

-- ──────────────────────────────────────────
-- Aggiunge colonna embedding BLOB alle tabelle esistenti
-- ──────────────────────────────────────────

ALTER TABLE knowledge_entries ADD COLUMN embedding BLOB;
ALTER TABLE events ADD COLUMN embedding BLOB;
ALTER TABLE decision_rationale ADD COLUMN embedding BLOB;

-- ──────────────────────────────────────────
-- Crea tabella vettoriale virtuale per ricerca ANN
-- Usa vec0 di sqlite-vec con embedding float[384]
-- ──────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
  embedding float[384]
);

-- ──────────────────────────────────────────
-- Indice per lookup rapidi su entry_id (usato dal linker)
-- ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_knowledge_vec_entry_id ON knowledge_entries(id);

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('003_vector_support');
