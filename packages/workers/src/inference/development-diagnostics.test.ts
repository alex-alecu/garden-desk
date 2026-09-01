import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPrivateDiagnosticTree } from "./development-diagnostics-test-containment.js";
import {
  bundledDiagnostics,
  cleanTemporaryDirectories,
  temporaryDirectory,
} from "./development-diagnostics-test-support.js";

afterEach(cleanTemporaryDirectories);

describe("development inference diagnostic records", () => {
  it("writes bounded raw stderr only from a development artifact", async () => {
    const directory = await temporaryDirectory();
    const root = join(directory, "inference-diagnostics");
    const development = await bundledDiagnostics(true, root);

    await expect(
      development.capture(["raw worker error\n", "x".repeat(1024 * 1024)]),
    ).resolves.toBe(true);
    const [runId] = await readdir(root);
    const output = await readFile(join(root, runId as string, "worker-stderr.log"));

    expect(output.subarray(0, 17).toString("utf8")).toBe("raw worker error\n");
    expect(output.length).toBe(1024 * 1024);
    await assertPrivateDiagnosticTree(root);
  });

  it("records raw Error details and library logs within one record limit", async () => {
    const directory = await temporaryDirectory();
    const development = await bundledDiagnostics(true, directory);
    const [failure = "", llama = ""] = development.records();

    expect(failure).toContain("[garden-desk-inference] operation=chat failed");
    expect(failure).toContain("name=TypeError");
    expect(failure).toContain("message=private operation failure");
    expect(failure).toContain("stack=stack=");
    expect(failure).toContain("cause=reason=native failure nested=[object]");
    expect(failure).not.toContain("not recorded");
    expect(llama).toContain("[node-llama-cpp] level=debug\nraw llama log ");
    expect(Buffer.byteLength(failure)).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.byteLength(llama)).toBeLessThanOrEqual(64 * 1024);
  });
});
