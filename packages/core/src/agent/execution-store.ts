import { randomUUID } from "node:crypto";
import {
  type AgentExecutionResult,
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  type AgentVmDiagnostic,
  AgentVmDiagnosticSchema,
} from "@vault/shared";
import type { DatabasePort } from "../workspace/database.js";
import { isSuccessfulExecution } from "./execution-success.js";
import { type ExecutionRow, executionFromRow } from "./records.js";

export type ExecutionInput =
  | { language: "python" | "node"; path: string; source: string }
  | { language: "shell"; command: string };

const MAX_STDIO_BYTES = 1_000_000;
const MAX_VM_DIAGNOSTICS_BYTES = 256 * 1024;

function bytes(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function newExecution(runId: string, input: ExecutionInput, sequence: number) {
  const createdAt = new Date().toISOString();
  return AgentExecutionSnapshotSchema.parse({
    id: randomUUID(),
    runId,
    sequence,
    language: input.language,
    path: input.language === "shell" ? null : input.path,
    source: input.language === "shell" ? null : input.source,
    command: input.language === "shell" ? input.command : null,
    state: "starting",
    exitCode: null,
    durationMs: null,
    termination: null,
    stdout: "",
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    vmDiagnosticsBytes: 2,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  });
}

function terminalState(result: AgentExecutionResult) {
  if (result.termination === "cancelled") return "cancelled";
  return isSuccessfulExecution(result) ? "completed" : "failed";
}

function outputTruncated(previous: number, terminalFlag: boolean | undefined): number {
  return previous === 1 || terminalFlag === true ? 1 : 0;
}

export class AgentExecutionStore {
  constructor(private readonly database: DatabasePort) {}

  create(runId: string, input: ExecutionInput): AgentExecutionSnapshot {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM agent_executions WHERE run_id = ?",
      )
      .get(runId) as { sequence: number };
    const item = newExecution(runId, input, row.sequence);
    this.database
      .prepare(
        "INSERT INTO agent_executions (id, run_id, sequence, language, workspace_path, code, command, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        item.id,
        item.runId,
        item.sequence,
        item.language,
        item.path,
        item.source,
        item.command,
        item.state,
        item.createdAt,
        item.updatedAt,
      );
    return item;
  }

  appendStream(executionId: string, stream: "stdout" | "stderr", chunk: Uint8Array): void {
    const row = this.row(executionId);
    const current = bytes(row[stream]);
    const incoming = Buffer.from(chunk);
    const remaining = Math.max(0, MAX_STDIO_BYTES - current.byteLength);
    const next = Buffer.concat([current, incoming.subarray(0, remaining)]);
    const alreadyTruncated = stream === "stdout" ? row.stdout_truncated : row.stderr_truncated;
    const truncated = alreadyTruncated === 1 || incoming.byteLength > remaining;
    this.database
      .prepare(
        `UPDATE agent_executions SET ${stream} = ?, ${stream}_truncated = ?, state = CASE WHEN state = 'starting' THEN 'running' ELSE state END, updated_at = ? WHERE id = ?`,
      )
      .run(next, truncated ? 1 : 0, new Date().toISOString(), executionId);
  }

  appendDiagnostic(
    executionId: string,
    detail: Pick<AgentVmDiagnostic, "code" | "platform"> & {
      platformCode?: string | undefined;
    },
  ): void {
    const row = this.row(executionId);
    if (row.vm_diagnostics_truncated === 1) return;
    const diagnostics = JSON.parse(row.vm_diagnostics_json) as AgentVmDiagnostic[];
    const diagnostic = AgentVmDiagnosticSchema.parse({
      sequence: diagnostics.length,
      code: detail.code,
      platform: detail.platform,
      platformCode: detail.platformCode ?? null,
      createdAt: new Date().toISOString(),
    });
    const encoded = JSON.stringify([...diagnostics, diagnostic]);
    const truncated = Buffer.byteLength(encoded) > MAX_VM_DIAGNOSTICS_BYTES;
    this.database
      .prepare(
        "UPDATE agent_executions SET vm_diagnostics_json = ?, vm_diagnostics_truncated = ?, state = CASE WHEN state = 'starting' THEN 'running' ELSE state END, updated_at = ? WHERE id = ?",
      )
      .run(
        truncated ? row.vm_diagnostics_json : encoded,
        truncated ? 1 : 0,
        diagnostic.createdAt,
        executionId,
      );
  }

  complete(executionId: string, result: AgentExecutionResult): void {
    const row = this.row(executionId);
    const stdout = bytes(row.stdout);
    const stderr = bytes(row.stderr);
    const completedAt = new Date().toISOString();
    if (stdout.toString("utf8") !== result.stdout || stderr.toString("utf8") !== result.stderr) {
      this.database
        .prepare(
          "UPDATE agent_executions SET state = 'failed', termination = 'crash', updated_at = ?, completed_at = ? WHERE id = ?",
        )
        .run(completedAt, completedAt, executionId);
      throw new Error("agent_execution_result_mismatch");
    }
    this.database
      .prepare(
        "UPDATE agent_executions SET state = ?, exit_code = ?, duration_ms = ?, termination = ?, stdout_truncated = ?, stderr_truncated = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      )
      .run(
        terminalState(result),
        result.exitCode,
        result.durationMs,
        result.termination,
        outputTruncated(row.stdout_truncated, result.stdoutTruncated),
        outputTruncated(row.stderr_truncated, result.stderrTruncated),
        completedAt,
        completedAt,
        executionId,
      );
  }

  failIncomplete(runId: string, cancelled: boolean, completedAt = new Date().toISOString()): void {
    this.database
      .prepare(
        "UPDATE agent_executions SET state = ?, termination = ?, updated_at = ?, completed_at = ? WHERE run_id = ? AND state IN ('starting', 'running')",
      )
      .run(
        cancelled ? "cancelled" : "failed",
        cancelled ? "cancelled" : "crash",
        completedAt,
        completedAt,
        runId,
      );
  }

  list(runId: string): AgentExecutionSnapshot[] {
    return (
      this.database
        .prepare("SELECT * FROM agent_executions WHERE run_id = ? ORDER BY sequence")
        .all(runId) as ExecutionRow[]
    ).map(executionFromRow);
  }

  listSessionScriptPaths(sessionId: string, limit = 8): string[] {
    const rows = this.database
      .prepare(
        "SELECT DISTINCT e.workspace_path AS path FROM agent_executions e JOIN agent_runs r ON r.id = e.run_id WHERE r.session_id = ? AND e.state = 'completed' AND e.exit_code = 0 AND e.workspace_path IS NOT NULL ORDER BY e.created_at DESC LIMIT ?",
      )
      .all(sessionId, limit) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  private row(executionId: string): ExecutionRow {
    const row = this.database
      .prepare("SELECT * FROM agent_executions WHERE id = ?")
      .get(executionId) as ExecutionRow | undefined;
    if (row === undefined) throw new Error("agent_execution_not_found");
    return row;
  }
}
