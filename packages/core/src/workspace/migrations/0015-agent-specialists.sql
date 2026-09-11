ALTER TABLE agent_runs ADD COLUMN agent_id TEXT;
ALTER TABLE agent_runs ADD COLUMN assignment TEXT;
ALTER TABLE agent_runs ADD COLUMN parent_tool_call_id TEXT;

PRAGMA user_version = 15;
