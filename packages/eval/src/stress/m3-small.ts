import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  expectRpcFailure,
  prepareModelStore,
  requireRealModel,
  startStressRuntime,
} from "./m3-stress-runtime.js";
import { prepareSmallCase, SMALL_CASE_IDS, SMALL_GATE_CASES } from "./small-profile.js";
import { createStressRoot, requireStressPlatform } from "./stress-platform.js";
import { runSequentialCases } from "./stress-suite.js";

const CASE_DEADLINE_MS = 5 * 60_000;

function requestedCase(): (typeof SMALL_CASE_IDS)[number] | undefined {
  const index = process.argv.indexOf("--case");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  const id = SMALL_CASE_IDS.find((candidate) => candidate === value);
  if (id === undefined) throw new Error(`Unknown small stress case: ${value ?? "missing"}`);
  return id;
}

async function runPolicyCases(endpoint: string, root: string): Promise<string[]> {
  const regularFile = join(root, "not-a-folder.txt");
  await writeFile(regularFile, "not a folder\n");
  const cases = [
    { name: "filesystem-root", params: { rootPath: process.platform === "win32" ? "C:\\" : "/" } },
    { name: "missing-folder", params: { rootPath: join(root, "missing") } },
    { name: "regular-file", params: { rootPath: regularFile } },
  ];
  for (const item of cases) {
    await expectRpcFailure(endpoint, "folders.add", item.params, "path_out_of_scope");
  }
  await expectRpcFailure(
    endpoint,
    "agent.start",
    { sessionId: "not-a-session", task: "invalid" },
    "invalid_request",
  );
  return [...cases.map((item) => item.name), "invalid-session"];
}

function reportPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(process.cwd(), "packages/eval/.generated/stress", `small-${timestamp}.json`);
}

async function runSmallSuite(
  runtime: Awaited<ReturnType<typeof startStressRuntime>>,
  root: string,
) {
  const selected = requestedCase();
  const policyCases = await runPolicyCases(runtime.endpoint, root);
  const modelBefore = await requireRealModel(runtime.endpoint, false);
  const sequential = await runSequentialCases({
    endpoint: runtime.endpoint,
    fixtureRoot: join(root, "fixtures", "sequential"),
    ids: selected === undefined ? SMALL_GATE_CASES : [selected],
    prepare: prepareSmallCase,
    deadlineMs: CASE_DEADLINE_MS,
  });
  const inferenceRan = sequential.some(
    (item) => item.trace.captureVersion === 1 && item.trace.turns.length > 0,
  );
  let modelAfter: Awaited<ReturnType<typeof requireRealModel>> | undefined;
  let modelAfterError: string | undefined;
  try {
    modelAfter = await requireRealModel(runtime.endpoint, inferenceRan);
  } catch (error) {
    modelAfterError = error instanceof Error ? error.message : "model_state_check_failed";
  }
  const auditValid = await runtime.core.verifyAudit();
  return {
    policyCases,
    modelBefore,
    modelAfter,
    modelAfterError,
    sequential,
    auditValid,
  };
}

async function main(): Promise<void> {
  requireStressPlatform();
  const root = await createStressRoot("vault-m3-stress-small");
  const output = reportPath();
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    await mkdir(join(root, "fixtures"));
    await mkdir(dirname(output), { recursive: true });
    await prepareModelStore();
    runtime = await startStressRuntime(join(root, "state"));
    const evidence = await runSmallSuite(runtime, root);
    const results = evidence.sequential.map((item) => item.result);
    const passed =
      results.every((result) => result.passed) &&
      evidence.auditValid &&
      evidence.modelAfterError === undefined;
    const report = {
      classification: passed ? "small_stress_passed" : "small_stress_limit_found",
      createdAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      totalMemoryBytes: totalmem(),
      ...evidence,
    };
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ classification: report.classification, output, results }));
    if (!passed) process.exitCode = 1;
  } finally {
    await runtime?.daemon.close();
    await runtime?.core.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
