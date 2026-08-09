import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import { prepareModelStore, requireRealModel, startStressRuntime } from "./m3-stress-runtime.js";
import {
  prepareScaledCase,
  SCALED_CONCURRENT_CASES,
  SCALED_SEQUENTIAL_CASES,
  SCALED_WORKLOAD_PLAN,
  type ScaledCaseId,
} from "./scaled-profile.js";
import { createStressRoot, requireStressPlatform } from "./stress-platform.js";
import { runConcurrentCases, runSequentialCases } from "./stress-suite.js";

const CASE_DEADLINE_MS = 12 * 60 * 60_000;
const CONCURRENT_DEADLINE_MS = 18 * 60 * 60_000;

interface ScaledOptions {
  mode: "sequential" | "concurrent";
  caseId?: ScaledCaseId;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parseOptions(args: string[]): ScaledOptions {
  if (!args.includes("--confirm-scaled")) {
    throw new Error("Scaled stress execution requires --confirm-scaled.");
  }
  const mode = optionValue(args, "--mode");
  if (mode !== "sequential" && mode !== "concurrent") {
    throw new Error("Scaled stress execution requires --mode sequential or --mode concurrent.");
  }
  const requestedCase = optionValue(args, "--case");
  if (mode === "concurrent" && requestedCase !== undefined) {
    throw new Error("--case is available only with sequential mode.");
  }
  if (requestedCase === undefined) return { mode };
  const caseId = SCALED_SEQUENTIAL_CASES.find((candidate) => candidate === requestedCase);
  if (caseId === undefined) throw new Error(`Unknown scaled stress case: ${requestedCase}`);
  return { mode, caseId };
}

function reportPath(mode: ScaledOptions["mode"]): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(process.cwd(), "packages/eval/.generated/stress", `scaled-${mode}-${timestamp}.json`);
}

async function runSelectedSuite(endpoint: string, fixtureRoot: string, options: ScaledOptions) {
  if (options.mode === "concurrent") {
    const concurrent = await runConcurrentCases({
      endpoint,
      fixtureRoot,
      ids: SCALED_CONCURRENT_CASES,
      prepare: prepareScaledCase,
      deadlineMs: CONCURRENT_DEADLINE_MS,
      removeFixtures: true,
    });
    return { sequential: null, concurrent };
  }
  const ids = options.caseId === undefined ? SCALED_SEQUENTIAL_CASES : [options.caseId];
  const sequential = await runSequentialCases({
    endpoint,
    fixtureRoot,
    ids,
    prepare: prepareScaledCase,
    deadlineMs: CASE_DEADLINE_MS,
    removeFixtures: true,
  });
  return { sequential, concurrent: null };
}

function suitePassed(suite: Awaited<ReturnType<typeof runSelectedSuite>>): boolean {
  if (suite.sequential !== null) return suite.sequential.every((item) => item.result.passed);
  return (
    suite.concurrent !== null &&
    suite.concurrent.maximumRunning >= 3 &&
    suite.concurrent.evidence.every((item) => item.result.passed)
  );
}

async function main(): Promise<void> {
  requireStressPlatform();
  const options = parseOptions(process.argv.slice(2));
  const root = await createStressRoot("vault-m3-stress-scaled");
  const output = reportPath(options.mode);
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    await mkdir(join(root, "fixtures"));
    await mkdir(dirname(output), { recursive: true });
    await prepareModelStore();
    runtime = await startStressRuntime(join(root, "state"));
    const modelBefore = await requireRealModel(runtime.endpoint, false);
    const suite = await runSelectedSuite(
      runtime.endpoint,
      join(root, "fixtures", options.mode),
      options,
    );
    const modelAfter = await requireRealModel(runtime.endpoint);
    const passed = suitePassed(suite);
    const report = {
      classification: passed ? "scaled_stress_passed" : "scaled_stress_limit_found",
      createdAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      totalMemoryBytes: totalmem(),
      options,
      workloadPlan: SCALED_WORKLOAD_PLAN,
      modelBefore,
      modelAfter,
      ...suite,
    };
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ classification: report.classification, output }));
    if (!passed) process.exitCode = 1;
  } finally {
    await runtime?.daemon.close();
    await runtime?.core.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
