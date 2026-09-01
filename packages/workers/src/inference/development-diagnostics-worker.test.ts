import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostileWorkerResponse } from "./development-diagnostics-test-containment.js";
import {
  bundledDiagnostics,
  bundledHostileWorker,
  bundledProductionCore,
  bundledWorker,
  cleanTemporaryDirectories,
  startedWorker,
  temporaryDirectory,
} from "./development-diagnostics-test-support.js";

afterEach(cleanTemporaryDirectories);

describe("development inference worker stderr ready record", () => {
  it("writes a development-only ready record without changing worker start", async () => {
    const directory = await temporaryDirectory();
    const worker = join(directory, "development-worker.mjs");
    const developmentWorker = await bundledWorker(true, worker);
    expect(developmentWorker).toContain("[garden-desk-inference] worker-stderr-ready");

    await expect(startedWorker(worker)).resolves.toMatchObject({
      code: 0,
      stderr: expect.stringContaining("[garden-desk-inference] worker-stderr-ready\n"),
    });
    await expect(startedWorker(worker, true)).resolves.toMatchObject({ code: 0 });
  });
});

describe("development inference diagnostic containment", () => {
  it("contains hostile diagnostics and still writes the fixed inference response", async () => {
    const directory = await temporaryDirectory();
    const development = await bundledDiagnostics(true, directory);
    await expect(development.hostileDiagnostics()).resolves.toBe(true);

    const responses = await hostileWorkerResponse(await bundledHostileWorker());
    expect(responses).toMatchObject([
      { status: "error", error: { code: "internal", message: "Inference failed." } },
    ]);
  });

  it("removes diagnostic writes and paths from production artifacts", async () => {
    const directory = await temporaryDirectory();
    const root = join(directory, "inference-diagnostics");
    const production = await bundledDiagnostics(false, root);
    const developmentWorker = await bundledWorker(true);
    const worker = await bundledWorker(false);
    const core = await bundledProductionCore();

    await expect(production.capture(["private worker error"])).resolves.toBe(false);
    expect(production.source).not.toContain(root);
    expect(production.source).not.toContain("worker-stderr.log");
    expect(developmentWorker).toContain("process.stderr.write");
    expect(developmentWorker).not.toContain("inference-diagnostics");
    expect(worker).not.toContain("unknown_worker_error");
    expect(worker).not.toContain("writeDevelopmentWorkerFailure");
    expect(worker).not.toContain("writeDevelopmentWorkerStderrReady");
    expect(worker).not.toContain("waitForDevelopmentHostRecord");
    expect(worker).not.toContain("writeDevelopmentLlamaLog");
    expect(worker).not.toContain("writeDevelopmentOperationFailure");
    expect(worker).not.toContain("[garden-desk-inference] worker-stderr-ready");
    expect(worker).not.toContain("[node-llama-cpp]");
    expect(core).not.toContain("inference-diagnostics");
    expect(core).not.toContain("inference-host.log");
    expect(core).not.toContain("worker-stderr.log");
    expect(core).not.toContain("recordDevelopmentHostFailure");
    expect(core).not.toContain("waitForDevelopmentHostRecord");
    expect(core).not.toContain("writeDevelopment");
    expect(core).not.toContain("[garden-desk-inference] host stage=");
    expect(core).not.toContain("writeDevelopmentWorkerStderrReady");
    expect(core).not.toContain("[garden-desk-inference] operation=");
    expect(core).not.toContain("[garden-desk-inference] worker-stderr-ready");
    expect(core).not.toContain("[node-llama-cpp]");
  });
});
