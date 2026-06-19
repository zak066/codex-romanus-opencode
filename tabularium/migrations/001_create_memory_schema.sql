-- Migration: 001_create_memory_schema.sql
-- Fase 1: Fundamentum — Schema base per persistenza
-- Crea le 5 tabelle del sistema di memoria del team: sessions, events,
-- contexts, knowledge_entries, decision_rationale.

-- ──────────────────────────────────────────
-- Sessions: traccia ogni sessione di lavoro
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,           -- UUID v4
    agent_name      TEXT NOT NULL,              -- agente che ha avviato la sessione
    start_time      TEXT NOT NULL,              -- ISO 8601
    end_time        TEXT,                       -- NULL se ancora in corso
    focus           TEXT DEFAULT 'all',         -- area di focus dichiarata
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'aborted', 'interrupted')),
    metadata        TEXT DEFAULT '{}',          -- JSON flessibile
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_name);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);

-- ──────────────────────────────────────────
-- Events: eventi atomici di una sessione
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,           -- UUID v4
    session_id      TEXT NOT NULL,              -- FK → sessions.id
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    agent_name      TEXT NOT NULL,
    event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                        'task_started',
                        'task_completed',
                        'task_failed',
                        'decision_made',
                        'file_created',
                        'file_modified',
                        'handoff_sent',
                        'handoff_received',
                        'error_encountered',
                        'milestone_reached',
                        'context_saved',
                        'knowledge_added',
                        'query_executed',
                        'advisory_requested',
                        'config_changed',
                        'session_started',
                        'session_ended',
                        'custom'
                    )),
    summary         TEXT NOT NULL,              -- breve descrizione (max 280 char)
    details         TEXT DEFAULT '{}',          -- JSON strutturato
    tags            TEXT DEFAULT '[]',          -- JSON array di stringhe
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_name);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

-- ──────────────────────────────────────────
-- Contexts: stato salvato degli agenti
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contexts (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    agent_name      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    context_type    TEXT NOT NULL
                    CHECK (context_type IN (
                        'session_start',
                        'session_end',
                        'task_context',
                        'handoff_context',
                        'snapshot',
                        'manual_save'
                    )),
    content         TEXT NOT NULL,              -- corpo del contesto
    source          TEXT DEFAULT 'auto',        -- 'auto' | 'manual' | 'file' | 'tool'
    metadata        TEXT DEFAULT '{}',          -- JSON
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contexts_session ON contexts(session_id);
CREATE INDEX IF NOT EXISTS idx_contexts_agent ON contexts(agent_name);

-- ──────────────────────────────────────────
-- Knowledge Entries: lezioni apprese, FAQ, pattern
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_entries (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'lesson'
                    CHECK (category IN ('lesson', 'faq', 'pattern', 'tip', 'pitfall', 'tutorial')),
    tags            TEXT DEFAULT '[]',          -- JSON array
    source_agent    TEXT,                       -- agente che ha contribuito
    source_task_id  TEXT,                       -- task durante cui è stata creata
    relevance_score INTEGER DEFAULT 0,          -- quante volte è stata citata/utile
    status          TEXT DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'draft'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge_entries(source_agent);
CREATE INDEX IF NOT EXISTS idx_knowledge_relevance ON knowledge_entries(relevance_score DESC);

-- Full-text search su title e body (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title,
    body,
    content='knowledge_entries',
    content_rowid='rowid'
);

-- ──────────────────────────────────────────
-- Decision Rationale: arricchimento ADR
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_rationale (
    id              TEXT PRIMARY KEY,
    adr_id          TEXT NOT NULL UNIQUE,       -- riferisce ADR-XXX
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    agent_name      TEXT NOT NULL,
    alternatives    TEXT DEFAULT '[]',          -- JSON array
    tradeoffs       TEXT DEFAULT '[]',          -- JSON array
    metrics         TEXT DEFAULT '{}',          -- JSON
    notes           TEXT DEFAULT ''             -- note aggiuntive libere
);

CREATE INDEX IF NOT EXISTS idx_decisions_adr ON decision_rationale(adr_id);
CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decision_rationale(agent_name);
