import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  awaitCases,
  cleanupCase,
  collectEvidence,
  expectRpcFailure,
  prepareModelStore,
  requireRealModel,
  type StressRunEvidence,
  startCase,
  startStressRuntime,
} from "./m3-small-runtime.js";
import {
  prepareSmallCase,
  SMALL_CONCURRENT_CASES,
  SMALL_SEQUENTIAL_CASES,
} from "./small-profile.js";

const CASE_DEADLINE_MS = 30 * 60_000;
const CONCURRENT_DEADLINE_MS = 45 * 60_000;

async function runPolicyCases(endpoint: string, root: string): Promise<string[]> {
  const regularFile = join(root, "not-a-folder.txt");
  await writeFile(regularFile, "not a folder\n");
  const cases = [
    { name: "macos-root", params: { rootPath: "/" } },
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

async function runOne(
  endpoint: string,
  fixtureRoot: string,
  id: (typeof SMALL_SEQUENTIAL_CASES)[number],
): Promise<StressRunEvidence> {
  console.log(JSON.stringify({ phase: "fixture.start", id }));
  const fixture = await prepareSmallCase(fixtureRoot, id);
  console.log(
    JSON.stringify({
      phase: "fixture.ready",
      id,
      fixtureMs: fixture.fixtureMs,
      bytes: fixture.evidence.bytes,
      files: fixture.evidence.files,
    }),
  );
  const active = await startCase(endpoint, fixture);
  try {
    const awaited = await awaitCases(endpoint, [active], CASE_DEADLINE_MS);
    const snapshot = awaited.snapshots.get(active.runId);
    if (snapshot === undefined) throw new Error(`Missing terminal snapshot for ${id}.`);
    const evidence = await collectEvidence(endpoint, active, snapshot);
    console.log(JSON.stringify({ phase: "case.done", ...evidence.result }));
    return evidence;
  } finally {
    await cleanupCase(endpoint, active);
  }
}

async function runSequential(endpoint: string, fixtureRoot: string): Promise<StressRunEvidence[]> {
  const evidence: StressRunEvidence[] = [];
  for (const id of SMALL_SEQUENTIAL_CASES) {
    evidence.push(await runOne(endpoint, fixtureRoot, id));
  }
  return evidence;
}

async function runConcurrent(endpoint: string, fixtureRoot: string) {
  const fixtures = [];
  for (const id of SMALL_CONCURRENT_CASES) {
    console.log(JSON.stringify({ phase: "concurrent.fixture.start", id }));
    fixtures.push(await prepareSmallCase(fixtureRoot, id));
  }
  const active = await Promise.all(fixtures.map(async (fixture) => startCase(endpoint, fixture)));
  try {
    const awaited = await awaitCases(endpoint, active, CONCURRENT_DEADLINE_MS);
    const evidence = await Promise.all(
      active.map(async (item) => {
        const snapshot = awaited.snapshots.get(item.runId);
        if (snapshot === undefined)
          throw new Error(`Missing terminal snapshot for ${item.fixture.id}.`);
        return collectEvidence(endpoint, item, snapshot);
      }),
    );
    console.log(
      JSON.stringify({
        phase: "concurrent.done",
        maximumRunning: awaited.maximumRunning,
        results: evidence.map((item) => item.result),
      }),
    );
    return { maximumRunning: awaited.maximumRunning, evidence };
  } finally {
    await Promise.all(active.map(async (item) => cleanupCase(endpoint, item)));
  }
}

function reportPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(process.cwd(), "packages/eval/.generated/stress", `small-${timestamp}.json`);
}

async function main(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The M3 small stress suite requires physical Apple silicon.");
  }
  const root = await mkdtemp("/tmp/vault-m3-stress-small-");
  const output = reportPath();
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    await mkdir(join(root, "fixtures"));
    await mkdir(dirname(output), { recursive: true });
    await prepareModelStore();
    runtime = await startStressRuntime(join(root, "state"));
    const policyCases = await runPolicyCases(runtime.endpoint, root);
    const modelBefore = await requireRealModel(runtime.endpoint, false);
    const sequential = await runSequential(runtime.endpoint, join(root, "fixtures", "sequential"));
    const concurrent = await runConcurrent(runtime.endpoint, join(root, "fixtures", "concurrent"));
    const modelAfter = await requireRealModel(runtime.endpoint);
    const results = [...sequential, ...concurrent.evidence].map((item) => item.result);
    const passed = results.every((result) => result.passed) && concurrent.maximumRunning >= 3;
    const report = {
      classification: passed ? "small_stress_passed" : "small_stress_limit_found",
      createdAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      totalMemoryBytes: totalmem(),
      policyCases,
      modelBefore,
      modelAfter,
      sequential,
      concurrent,
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
