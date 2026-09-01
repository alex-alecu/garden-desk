import { AgentTraceSchema } from "@gardendesk/shared";
import { describe, expect, it, vi } from "vitest";
import type { GardenDeskCore } from "../facade.js";
import { dispatchRpc } from "./methods.js";

describe("agent trace RPC", () => {
  it("returns a run trace through the read-only agent.trace method", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const trace = AgentTraceSchema.parse({
      runId,
      captureVersion: 1,
      status: "recorded",
      turns: [],
    });
    const getAgentTrace = vi.fn(async () => trace);
    const core = { getAgentTrace } as unknown as GardenDeskCore;

    const response = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "trace-request",
      method: "agent.trace",
      params: { runId },
      protocolVersion: 1,
    });

    expect(response).toMatchObject({ id: "trace-request", result: trace });
    expect(getAgentTrace).toHaveBeenCalledExactlyOnceWith(runId);
  });
});

describe("agent question RPC", () => {
  const runId = "44444444-4444-4444-8444-444444444444";
  const questionId = "55555555-5555-4555-8555-555555555555";

  it("routes an answer to the run and reports it answered", async () => {
    const answerQuestion = vi.fn(async () => true);
    const core = { answerQuestion } as unknown as GardenDeskCore;

    const response = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "answer",
      method: "agent.answerQuestion",
      params: { runId, questionId, answers: [["Full report"]] },
      protocolVersion: 1,
    });

    expect(response).toMatchObject({ id: "answer", result: { answered: true } });
    expect(answerQuestion).toHaveBeenCalledExactlyOnceWith(runId, questionId, [["Full report"]]);
  });

  it("maps an unknown or stale question to not_found", async () => {
    const dismissQuestion = vi.fn(async () => false);
    const core = { dismissQuestion } as unknown as GardenDeskCore;

    const response = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "dismiss",
      method: "agent.dismissQuestion",
      params: { runId, questionId },
      protocolVersion: 1,
    });

    expect(response).toMatchObject({ id: "dismiss", error: { code: "not_found" } });
  });

  it("rejects an answer with an invalid run id", async () => {
    const answerQuestion = vi.fn(async () => true);
    const core = { answerQuestion } as unknown as GardenDeskCore;

    const response = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "bad",
      method: "agent.answerQuestion",
      params: { runId: "not-a-uuid", questionId, answers: [[]] },
      protocolVersion: 1,
    });

    expect(response).toMatchObject({ id: "bad", error: { code: "invalid_request" } });
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});

describe("artifact RPC", () => {
  it("routes verified materialization and export through typed methods", async () => {
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const materializeArtifact = vi.fn(async () => "/tmp/generated/report.pdf");
    const recordArtifactOpen = vi.fn(async () => undefined);
    const exportArtifact = vi.fn(async () => undefined);
    const core = {
      materializeArtifact,
      recordArtifactOpen,
      exportArtifact,
    } as unknown as GardenDeskCore;

    const opened = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "open-artifact",
      method: "artifacts.materialize",
      params: { sessionId, artifactId },
      protocolVersion: 1,
    });
    const exported = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "export-artifact",
      method: "artifacts.export",
      params: { sessionId, artifactId, destination: "/tmp/saved.pdf" },
      protocolVersion: 1,
    });
    const recorded = await dispatchRpc(core, {
      jsonrpc: "2.0",
      id: "record-open",
      method: "artifacts.recordOpen",
      params: { sessionId, artifactId, outcome: "failed" },
      protocolVersion: 1,
    });

    expect(opened).toMatchObject({ result: "/tmp/generated/report.pdf" });
    expect(exported).toMatchObject({ result: { exported: true } });
    expect(recorded).toMatchObject({ result: { recorded: true } });
    expect(materializeArtifact).toHaveBeenCalledWith(sessionId, artifactId);
    expect(recordArtifactOpen).toHaveBeenCalledWith(sessionId, artifactId, "failed");
    expect(exportArtifact).toHaveBeenCalledWith(sessionId, artifactId, "/tmp/saved.pdf");
  });
});
