import { randomUUID } from "node:crypto";
import { type JobRecord, JobRecordSchema } from "@gardendesk/shared";
import type { DatabasePort } from "../workspace/database.js";

interface JobRow {
  id: string;
  kind: string;
  idempotency_key: string;
  state: string;
  cancellation_requested: number;
  resume_cursor: string | null;
  created_at: string;
  updated_at: string;
}

function record(row: JobRow): JobRecord {
  return JobRecordSchema.parse({
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    cancellationRequested: row.cancellation_requested === 1,
    resumeCursor: row.resume_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class JobStore {
  constructor(private readonly database: DatabasePort) {}

  create(kind: string, idempotencyKey: string): JobRecord {
    const existing = this.database
      .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
      .get(idempotencyKey) as JobRow | undefined;
    if (existing !== undefined) return record(existing);
    const now = new Date().toISOString();
    const job = JobRecordSchema.parse({
      id: randomUUID(),
      kind,
      idempotencyKey,
      state: "queued",
      cancellationRequested: false,
      resumeCursor: null,
      createdAt: now,
      updatedAt: now,
    });
    this.database
      .prepare("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.id, job.kind, job.idempotencyKey, job.state, 0, null, now, now);
    return job;
  }

  cancel(id: string): JobRecord | undefined {
    const now = new Date().toISOString();
    const update = this.database
      .prepare(
        "UPDATE jobs SET cancellation_requested = 1, state = 'cancelled', updated_at = ? WHERE id = ? AND state IN ('queued', 'running')",
      )
      .run(now, id);
    if (update.changes === 0) return undefined;
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | JobRow
      | undefined;
    return row === undefined ? undefined : record(row);
  }

  transition(id: string, state: "running" | "succeeded" | "failed"): void {
    const updatedAt = new Date().toISOString();
    const expectedState = state === "running" ? "queued" : "running";
    const update = this.database
      .prepare(
        "UPDATE jobs SET state = ?, updated_at = ? WHERE id = ? AND state = ? AND cancellation_requested = 0",
      )
      .run(state, updatedAt, id, expectedState);
    if (update.changes === 1) return;
    const exists = this.database.prepare("SELECT 1 FROM jobs WHERE id = ?").get(id);
    throw new Error(exists === undefined ? "job_not_found" : "job_transition_rejected");
  }

  isCancellationRequested(id: string): boolean {
    const row = this.database
      .prepare("SELECT cancellation_requested FROM jobs WHERE id = ?")
      .get(id) as { cancellation_requested: number } | undefined;
    return row?.cancellation_requested === 1;
  }
}
