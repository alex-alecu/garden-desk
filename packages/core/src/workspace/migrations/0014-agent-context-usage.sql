ALTER TABLE agent_runs ADD COLUMN context_used_tokens INTEGER CHECK (context_used_tokens >= 0);
ALTER TABLE agent_runs ADD COLUMN context_allocated_tokens INTEGER CHECK (context_allocated_tokens > 0);

PRAGMA user_version = 14;
