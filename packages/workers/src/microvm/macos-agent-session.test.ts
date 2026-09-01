import { randomUUID } from "node:crypto";
import { AgentExecutionIdSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { encodeFrame } from "../ipc.js";
import { AgentHelperTransport } from "./agent-transport.js";
import { executeRequest, fakeChild, resultFrame } from "./macos-agent-session-test-support.js";

describe("agent helper ordered live stream", () => {
  it("delivers ordered bounded frames before the terminal result", async () => {
    const { child, stdout } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const updates: string[] = [];
    const result = transport.exchange(executeRequest(requestId, executionId), undefined, {
      executionId,
      onUpdate(update) {
        updates.push(
          update.kind === "stream" ? Buffer.from(update.bytes).toString("utf8") : update.code,
        );
      },
    });
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "diagnostic",
        sequence: 0,
        diagnostic: { code: "process_start", platform: "guest", platformCode: null },
      }),
    );
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 1,
        stream: "stdout",
        contentBase64: Buffer.from("live\n").toString("base64"),
        byteLength: 5,
      }),
    );
    stdout.write(encodeFrame(resultFrame(requestId, executionId)));

    await expect(result).resolves.toMatchObject({ operation: "execute", executionId });
    expect(updates).toEqual(["process_start", "live\n"]);
  });
});
describe("agent helper stream validation", () => {
  it("rejects out-of-order and oversized stream frames", async () => {
    const { child, stdout } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const result = transport.exchange(executeRequest(requestId, executionId), undefined, {
      executionId,
      onUpdate() {},
    });
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 1,
        stream: "stdout",
        contentBase64: "YQ==",
        byteLength: 1,
      }),
    );
    await expect(result).rejects.toThrow("agent_helper_stream_order_invalid");
    expect(() =>
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 0,
        stream: "stdout",
        contentBase64: "YQ==",
        byteLength: 64 * 1024 + 1,
      }),
    ).toThrow();
  });
});

describe("agent helper error privacy", () => {
  it("does not surface raw helper stderr", async () => {
    const { child, stderr } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const result = transport.exchange(executeRequest(requestId, executionId));
    stderr.write("/private/tmp/customer-path secret");
    child.emit("close", 1, null);

    await expect(result).rejects.toThrow("agent_helper_exited_1");
    await expect(result).rejects.not.toThrow("customer-path");
  });
});
