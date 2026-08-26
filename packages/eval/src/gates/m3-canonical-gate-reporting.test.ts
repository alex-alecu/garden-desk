import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  M3ProductCheckFailure,
  requireM3RegularFile,
  runCanonicalGate,
} from "./m3-canonical-gate-reporting.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function captureFailure(
  run: Parameters<typeof runCanonicalGate>[0]["run"],
): Promise<{ report: Record<string, unknown>; serialized: string }> {
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await runCanonicalGate({ failureClassification: "m3_macos_gate_failed", run });
  expect(output).toHaveBeenCalledTimes(1);
  const serialized = String(output.mock.calls[0]?.[0]);
  return { report: JSON.parse(serialized) as Record<string, unknown>, serialized };
}

describe("canonical M3 gate failure reporting", () => {
  it("emits bounded environment evidence and keeps a failing exit", async () => {
    const privateText = `private-${"x".repeat(10_000)}`;
    const { report, serialized } = await captureFailure(async () => {
      throw new Error(privateText);
    });

    expect(report).toEqual({
      classification: "m3_macos_gate_failed",
      failureClass: "environment_blocked",
      evidenceReference: "report.failure",
      failure: {
        code: "m3_environment_setup_blocked",
        stage: "environment_setup",
      },
    });
    expect(serialized).not.toContain(privateText);
    expect(serialized.length).toBeLessThan(512);
    expect(process.exitCode).toBe(1);
  });

  it.each(["runtime_startup", "runtime_transport"] as const)(
    "classifies %s without inspecting the error message",
    async (stage) => {
      const { report } = await captureFailure(async (setFailureStage) => {
        setFailureStage(stage);
        throw new Error("m3_product_hard_check_failure");
      });

      expect(report).toMatchObject({
        failureClass: "runtime_failure",
        failure: { stage },
      });
    },
  );

  it("classifies only a typed proof error as a product failure", async () => {
    const { report } = await captureFailure(async (setFailureStage) => {
      setFailureStage("runtime_transport");
      throw new M3ProductCheckFailure("proof details stay local");
    });

    expect(report).toMatchObject({
      failureClass: "product_failure",
      evidenceReference: "report.failure",
      failure: {
        code: "m3_product_hard_check_failure",
        stage: "product_hard_check",
      },
    });
  });
});

describe("canonical M3 file evidence", () => {
  it("turns a missing required file into a typed product failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-m3-required-file-"));
    try {
      const present = join(root, "manifest.json");
      await writeFile(present, "{}");
      await expect(requireM3RegularFile(present, "manifest missing")).resolves.toBeUndefined();
      await expect(
        requireM3RegularFile(join(root, "missing.json"), "manifest missing"),
      ).rejects.toBeInstanceOf(M3ProductCheckFailure);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
