-- Migration: 013_create_messaging.sql
-- R1: Messaging Real-Time tra Agenti
--
-- Crea le tabelle per il sistema di messaggistica inter-agente:
--   - channels: canali tematici per organizzare conversazioni
--   - messages: messaggi persistenti tra agenti
--   - agent_heartbeats: monitoraggio stato e heartbeat degli agenti
--
-- Design:
--   - Indici composti per le query piu frequenti
--   - TTL logico tramite trigger per cleanup messaggi vecchi
--   - Consistency con timestamp TEXT ISO 8601
--   - Foreign key messages -> channels con ON DELETE CASCADE

-- ──────────────────────────────────────────
-- Channels: canali di comunicazione
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY,                -- 'ch_' + uuid breve
    name            TEXT NOT NULL UNIQUE,            -- nome canale: general, architecture, etc.
    description     TEXT NOT NULL DEFAULT '',         -- descrizione opzionale
    created_by      TEXT NOT NULL,                   -- agente o 'system' per default channels
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601
    is_default      INTEGER NOT NULL DEFAULT 0       -- 1 = canale predefinito (non eliminabile)
);

-- Indice per lookup dei canali di default
CREATE INDEX IF NOT EXISTS idx_channels_default
    ON channels(is_default);

-- Indice per ordinamento alfabetico
CREATE INDEX IF NOT EXISTS idx_channels_name
    ON channels(name);

-- ──────────────────────────────────────────
-- Messages: messaggi inter-agente
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,                -- 'msg_' + uuid
    channel_id      TEXT NOT NULL,                   -- FK -> channels.id
    sender          TEXT NOT NULL,                   -- nome agente mittente
    content         TEXT NOT NULL,                   -- corpo del messaggio
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601
    metadata        TEXT NOT NULL DEFAULT '{}',       -- JSON: { type, priority, reply_to }
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

-- Query primaria: messaggi recenti per canale (channel history)
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages(channel_id, created_at DESC);

-- Query per ricerca messaggi per mittente
CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages(sender);

-- Query per cleanup TTL: messaggi piu vecchi di N giorni
CREATE INDEX IF NOT EXISTS idx_messages_created
    ON messages(created_at);

-- ──────────────────────────────────────────
-- Agent Heartbeats: monitoraggio stato agenti
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    agent_name      TEXT PRIMARY KEY,                -- nome agente (unico per agente)
    status          TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'busy', 'error', 'offline')),
    last_seen       TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO 8601
    current_task    TEXT,                            -- descrizione del task corrente
    metadata        TEXT NOT NULL DEFAULT '{}'        -- JSON: { session_id, model, ... }
);

-- Indice per query agenti online
CREATE INDEX IF NOT EXISTS idx_heartbeats_status
    ON agent_heartbeats(status);

-- Indice per timeout detection
CREATE INDEX IF NOT EXISTS idx_heartbeats_last_seen
    ON agent_heartbeats(last_seen);

-- Indice per query: lista agenti connessi (status IN ('idle', 'busy'))
CREATE INDEX IF NOT EXISTS idx_heartbeats_online
    ON agent_heartbeats(status, last_seen)
    WHERE status IN ('idle', 'busy');

-- ──────────────────────────────────────────
-- Seed: canali di default
-- ──────────────────────────────────────────
INSERT OR IGNORE INTO channels (id, name, description, created_by, is_default) VALUES
    ('ch_general',    'general',      'Comunicazioni generali del team',      'system', 1),
    ('ch_arch',       'architecture', 'Discussioni architetturali',           'system', 1),
    ('ch_bugs',       'bugs',         'Notifiche bug e incidenti',           'system', 1),
    ('ch_quality',    'quality',      'Quality gate e scorecard',            'system', 1),
    ('ch_alerts',     'alerts',       'Alert e warning automatici',          'system', 1);

-- ──────────────────────────────────────────
-- Trigger: cleanup messaggi piu vecchi di 30 giorni
-- Si attiva solo quando la tabella supera 10.000 messaggi
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_messages_cleanup
    AFTER INSERT ON messages
    WHEN (SELECT COUNT(*) FROM messages) > 10000
BEGIN
    DELETE FROM messages
    WHERE created_at < datetime('now', '-30 days');
END;
