import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { createGenerationRequest } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

it("keeps tool-cycle reasoning outside persistent traces and clears it after the run", async () => {
  const { catalog, store, conversations, jobs } = await fixture();
  const session = conversations.createSession(null);
  const run = store.createRun(session.id, jobs.create("agent", "reasoning").id);
  let retained: Map<string, string> | undefined;
  let turn = 0;
  const loop = new ChatAgentLoop({
    async chat(_request, _signal, streams) {
      retained = streams?.reasoning;
      if (turn++ === 0) {
        retained?.set("call-1", "private-reasoning-sentinel");
        return generated("", [tool("python", "call-1", { source: "print(2)" })]);
      }
      expect(retained?.get("call-1")).toBe("private-reasoning-sentinel");
      return generated("Two.");
    },
  });
  try {
    await loop.run(
      input(
        {
          async execute(request) {
            return execution(source(request));
          },
        },
        ["python"],
        { trace: { runId: run.id, store: store.trace } },
      ),
    );
    expect(JSON.stringify(await store.trace.get(run.id))).not.toContain(
      "private-reasoning-sentinel",
    );
    expect(retained?.size).toBe(0);
  } finally {
    catalog.close();
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "garden-desk-agent-trace-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const audit = new AuditLog(catalog.database);
  const store = new AgentStore(catalog.database, artifacts, (event) => audit.append(event));
  const conversations = new ConversationStore(catalog.database);
  const jobs = new JobStore(catalog.database);
  return { root, catalog, store, conversations, jobs, audit };
}

function request(prompt: string, reverseSchema = false) {
  return createGenerationRequest({
    modelId: "gemma-4-12b-it-qat-q4_0",
    prompt,
    jsonSchema: reverseSchema
      ? { properties: { a: { type: "number" }, z: { type: "string" } }, type: "object" }
      : { type: "object", properties: { z: { type: "string" }, a: { type: "number" } } },
    contextSize: "auto",
    maxTokens: 4_096,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused cases cover one durable trace boundary.
describe("M3 durable inference traces", () => {
  it("resolves exact prompts and canonical structured payloads in turn order", async () => {
    const { catalog, store, conversations, jobs, audit } = await fixture();
    const session = conversations.createSession(null);
    const job = jobs.create("agent", "trace-order");
    const run = store.createRun(session.id, job.id);
    const first = request("First line\r\nSecond line");
    const firstId = await store.trace.begin(run.id, "decision", {
      input: first.input,
      ...first.identity,
    });
    await store.trace.captureResponse(firstId, { z: 2, a: [3, { y: true, x: null }] }, 16_384);
    store.trace.recordOutcome(firstId, "accepted_execution", 0);
    const second = request("Final prompt");
    const secondId = await store.trace.begin(run.id, "final_response", {
      input: second.input,
      ...second.identity,
    });
    await store.trace.captureResponse(secondId, { response: ["done"], action: "respond" }, 16_384);
    store.trace.recordOutcome(secondId, "accepted_response");

    const trace = await store.trace.get(run.id);
    expect(trace.captureVersion).toBe(1);
    if (trace.captureVersion !== 1) throw new Error("trace_missing");
    expect(trace.turns.map((turn) => turn.sequence)).toEqual([0, 1]);
    expect(trace.turns[0]).toMatchObject({
      prompt: "First line\r\nSecond line",
      jsonSchema: first.input.jsonSchema,
      structuredResponse: { z: 2, a: [3, { y: true, x: null }] },
      outcome: "accepted_execution",
      executionSequence: 0,
      allocatedContextTokens: 16_384,
    });
    expect(trace.turns[1]).toMatchObject({
      phase: "final_response",
      outcome: "accepted_response",
    });
    expect(audit.verify()).toBe(true);
    const auditJson = JSON.stringify(
      catalog.database.prepare("SELECT event_json FROM audit_events ORDER BY sequence").all(),
    );
    expect(auditJson).toContain("requestInputHash");
    expect(auditJson).not.toContain("First line");
    expect(auditJson).not.toContain('"done"');
    catalog.close();
  });

  it("deduplicates identical payloads across runs and sessions", async () => {
    const { root, catalog, store, conversations, jobs } = await fixture();
    const traces = [];
    for (const [index, key] of ["first", "second"].entries()) {
      const session = conversations.createSession(null);
      const run = store.createRun(session.id, jobs.create("agent", key).id);
      const prepared = request("Same prompt", index === 1);
      const turnId = await store.trace.begin(run.id, "decision", {
        input: prepared.input,
        ...prepared.identity,
      });
      await store.trace.captureResponse(turnId, index === 0 ? { b: 2, a: 1 } : { a: 1, b: 2 });
      store.trace.recordOutcome(turnId, "accepted_response");
      const trace = await store.trace.get(run.id);
      if (trace.captureVersion !== 1) throw new Error("trace_missing");
      traces.push(trace.turns[0]);
    }
    expect(traces[0]?.promptHash).toBe(traces[1]?.promptHash);
    expect(traces[0]?.schemaHash).toBe(traces[1]?.schemaHash);
    expect(traces[0]?.responseHash).toBe(traces[1]?.responseHash);
    const entries = await readdir(join(root, ".garden-desk", "artifacts"), { recursive: true });
    expect(entries.filter((entry) => /^[a-f0-9]{64}$/u.test(basename(entry)))).toHaveLength(3);
    catalog.close();
  });

  it("marks an unfinished turn interrupted during run recovery", async () => {
    const { catalog, store, conversations, jobs } = await fixture();
    const session = conversations.createSession(null);
    const job = jobs.create("agent", "trace-recovery");
    const run = store.createRun(session.id, job.id);
    jobs.transition(job.id, "running");
    store.transitionRun(run.id, { state: "running" });
    const prepared = request("Interrupted prompt");
    await store.trace.begin(run.id, "decision", { input: prepared.input, ...prepared.identity });
    const failedJob = jobs.create("agent", "trace-capture-failure");
    const failedRun = store.createRun(session.id, failedJob.id);
    jobs.transition(failedJob.id, "running");
    jobs.transition(failedJob.id, "failed");
    store.transitionRun(failedRun.id, { state: "failed", error: "trace_capture_failed" });
    const failedPrepared = request("Captured before a failed run stopped");
    await store.trace.begin(failedRun.id, "decision", {
      input: failedPrepared.input,
      ...failedPrepared.identity,
    });

    expect(store.recoverInterrupted()).toBe(1);
    const trace = await store.trace.get(run.id);
    if (trace.captureVersion !== 1) throw new Error("trace_missing");
    expect(trace.turns[0]).toMatchObject({ outcome: "interrupted" });
    expect(trace.turns[0]?.completedAt).not.toBeNull();
    const failedTrace = await store.trace.get(failedRun.id);
    if (failedTrace.captureVersion !== 1) throw new Error("trace_missing");
    expect(failedTrace.turns[0]).toMatchObject({ outcome: "interrupted" });
    catalog.close();
  });
});
