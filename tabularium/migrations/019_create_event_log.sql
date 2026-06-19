-- 019_create_event_log.sql
-- Tabella per la persistenza degli eventi del sistema Messaging (GAP-07).
-- Ogni emit() su EventBus scrive anche qui per permettere replay SSE
-- e query storiche via tool agent_event_history.

CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    channel_id TEXT,
    agent_name TEXT,
    event_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_event_log_agent ON event_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at);
CREATE INDEX IF NOT EXISTS idx_event_log_channel ON event_log(channel_id);
