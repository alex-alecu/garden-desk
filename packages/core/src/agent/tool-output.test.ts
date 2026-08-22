import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { boundedToolOutput } from "./tool-output.js";

function completed(source: string): AgentExecutionResult {
  return {
    language: "python",
    path: ".vault-output/write.py",
    source,
    command: null,
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function source(run: Parameters<AgentExecutor["execute"]>[0]): string {
  return run.language === "shell" ? run.command : run.source;
}

function executor(writes?: string[]): AgentExecutor {
  return {
    async inspect(run) {
      writes?.push(source(run));
      return completed(source(run));
    },
    async execute(run) {
      return completed(source(run));
    },
  };
}

function writtenText(writes: string[]): string {
  return Buffer.concat(
    writes.map((write) => {
      const encoded = write.match(/base64\.b64decode\(("[A-Za-z0-9+/=]+")\)/u)?.[1];
      expect(encoded).toBeDefined();
      return Buffer.from(JSON.parse(encoded as string), "base64");
    }),
  ).toString("utf8");
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: output boundary cases share one spill decoder.
describe("bounded tool output", () => {
  it("spills oversized output and gives grep/read recovery guidance", async () => {
    const writes: string[] = [];
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index}`).join("\n");

    const result = await boundedToolOutput(executor(writes), output);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("/workspace/.vault-output/");
    expect(result).toContain("[Output truncated. Full output saved to /workspace/.vault-output/");
    expect(result).toContain("Use grep or read with offset/limit.");
    expect(result).toContain("line 0");
    expect(result).toContain("line 2000");
    expect(result).not.toContain("line 1000");
    expect(result.match(/line 0(?:\n|$)/gu)).toHaveLength(1);
    expect(result.match(/line 2000(?:\n|$)/gu)).toHaveLength(1);
    expect(writtenText(writes)).toBe(output);
  });

  it("keeps the preview within its byte limit for multibyte text", async () => {
    const output = `${"ă".repeat(30_000)}\nFINAL_SUMMARY=kept`;

    const result = await boundedToolOutput(executor(), output);

    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50 * 1_024);
    expect(result).toContain("FINAL_SUMMARY=kept");
  });

  it("keeps both ends of a short output that exceeds only the byte limit", async () => {
    const output = Array.from({ length: 1_000 }, (_, index) => `${index}:${"x".repeat(80)}`).join(
      "\n",
    );

    const result = await boundedToolOutput(executor(), output);

    expect(result.match(/100:/gu)).toHaveLength(1);
    expect(result.match(/900:/gu)).toHaveLength(1);
    expect(result).not.toContain("500:");
  });

  it("keeps the exact JSON 50 KiB boundary and spills the first byte above it", async () => {
    const atLimit = "x".repeat(50 * 1_024 - 2);
    const atLimitWrites: string[] = [];
    const overLimit = `${atLimit}x`;
    const overLimitWrites: string[] = [];

    const exact = await boundedToolOutput(executor(atLimitWrites), atLimit);
    const spilled = await boundedToolOutput(executor(overLimitWrites), overLimit);

    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(50 * 1_024);
    expect(exact).toBe(atLimit);
    expect(atLimitWrites).toHaveLength(0);
    expect(Buffer.byteLength(JSON.stringify(overLimit))).toBe(50 * 1_024 + 1);
    expect(overLimitWrites).toHaveLength(2);
    expect(writtenText(overLimitWrites)).toBe(overLimit);
    expect(Buffer.byteLength(JSON.stringify(spilled))).toBeLessThanOrEqual(50 * 1_024);
  });

  it("spills control-heavy output and keeps its JSON-encoded preview within 50 KiB", async () => {
    const writes: string[] = [];
    const output = `${"\u0001".repeat(50 * 1_024)}\nFINAL_SUMMARY=kept`;

    const result = await boundedToolOutput(executor(writes), output);

    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(50 * 1_024);
    expect(result).toContain("FINAL_SUMMARY=kept");
    expect(writtenText(writes)).toBe(output);
  });
});
