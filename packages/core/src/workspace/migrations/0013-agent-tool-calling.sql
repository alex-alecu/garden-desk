ALTER TABLE agent_events ADD COLUMN tool_name TEXT;
ALTER TABLE agent_events ADD COLUMN tool_call_id TEXT;
ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT REFERENCES agent_runs(id);

CREATE TABLE agent_executions_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  language TEXT NOT NULL,
  workspace_path TEXT,
  code TEXT,
  command TEXT,
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'completed', 'failed', 'cancelled')),
  exit_code INTEGER,
  duration_ms INTEGER,
  termination TEXT,
  stdout BLOB NOT NULL DEFAULT X'',
  stderr BLOB NOT NULL DEFAULT X'',
  vm_diagnostics_json TEXT NOT NULL DEFAULT '[]',
  stdout_truncated INTEGER NOT NULL DEFAULT 0,
  stderr_truncated INTEGER NOT NULL DEFAULT 0,
  vm_diagnostics_truncated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(run_id, sequence)
);

INSERT INTO agent_executions_next (
  id, run_id, sequence, language, workspace_path, code, command, state, exit_code,
  duration_ms, termination, stdout, stderr, vm_diagnostics_json, stdout_truncated,
  stderr_truncated, vm_diagnostics_truncated, created_at, updated_at, completed_at
)
SELECT
  id, run_id, sequence, language, workspace_path, code, command, state, exit_code,
  duration_ms, termination, stdout, stderr, vm_diagnostics_json, stdout_truncated,
  stderr_truncated, vm_diagnostics_truncated, created_at, updated_at, completed_at
FROM agent_executions;
DROP TABLE agent_executions;
ALTER TABLE agent_executions_next RENAME TO agent_executions;
CREATE INDEX agent_executions_by_run ON agent_executions(run_id, sequence);

CREATE TABLE agent_inference_turns_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('decision', 'final_response', 'chat', 'compaction')),
  request_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  context_size TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  allocated_context_tokens INTEGER,
  prompt_hash TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  response_hash TEXT,
  outcome TEXT CHECK (outcome IN (
    'accepted_execution',
    'accepted_response',
    'accepted_skill_request',
    'accepted_tool_calls',
    'accepted_compaction',
    'rejected_duplicate',
    'rejected_unbacked_response',
    'invalid_response',
    'inference_failed',
    'cancelled',
    'interrupted'
  )),
  execution_sequence INTEGER,
  created_at TEXT NOT NULL,
  response_captured_at TEXT,
  completed_at TEXT,
  UNIQUE(run_id, sequence)
);

INSERT INTO agent_inference_turns_next SELECT * FROM agent_inference_turns;
DROP TABLE agent_inference_turns;
ALTER TABLE agent_inference_turns_next RENAME TO agent_inference_turns;
CREATE INDEX agent_inference_turns_by_run ON agent_inference_turns(run_id, sequence);

PRAGMA user_version = 13;
