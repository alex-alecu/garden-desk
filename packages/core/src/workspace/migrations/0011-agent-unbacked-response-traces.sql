CREATE TABLE agent_inference_turns_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('decision', 'final_response')),
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

PRAGMA user_version = 11;
