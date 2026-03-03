-- /backend/db/schema.sql

CREATE TABLE IF NOT EXISTS agent_quotas (
    agentId TEXT PRIMARY KEY,
    requestCount INTEGER NOT NULL DEFAULT 0,
    lastResetDate TEXT NOT NULL -- Stored as ISO 8601 string (YYYY-MM-DD)
);
