import { AgentTraceSchema } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { VaultCore } from "../facade.js";
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
    const core = { getAgentTrace } as unknown as VaultCore;

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

describe("artifact RPC", () => {
  it("routes verified materialization and export through typed methods", async () => {
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const materializeArtifact = vi.fn(async () => "/tmp/generated/report.pdf");
    const exportArtifact = vi.fn(async () => undefined);
    const core = { materializeArtifact, exportArtifact } as unknown as VaultCore;

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

    expect(opened).toMatchObject({ result: "/tmp/generated/report.pdf" });
    expect(exported).toMatchObject({ result: { exported: true } });
    expect(materializeArtifact).toHaveBeenCalledWith(sessionId, artifactId);
    expect(exportArtifact).toHaveBeenCalledWith(sessionId, artifactId, "/tmp/saved.pdf");
  });
});
