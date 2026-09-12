CREATE INDEX agent_runs_by_parent ON agent_runs (parent_run_id, created_at, id);

PRAGMA user_version = 16;
