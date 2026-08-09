CREATE TABLE agent_session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  covered_message_id TEXT NOT NULL,
  covered_message_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 12;
