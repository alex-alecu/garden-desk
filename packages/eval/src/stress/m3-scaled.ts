import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  concurrentReportFailure,
  failedEvaluationEvidence,
  type M3EvaluationFailureStage,
  reportEvidenceClassification,
  reportQualityCandidates,
} from "./m3-evidence-classification.js";
import {
  prepareModelStore,
  requireRealModel,
  startStressRuntime,
  stressFailureStage,
} from "./m3-stress-runtime.js";
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

function suiteResults(suite: Awaited<ReturnType<typeof runSelectedSuite>>) {
  if (suite.sequential !== null) return suite.sequential.map(({ result }) => result);
  return suite.concurrent?.evidence.map(({ result }) => result) ?? [];
}

function scaledReport(input: {
  modelAfter: Awaited<ReturnType<typeof requireRealModel>>;
  modelBefore: Awaited<ReturnType<typeof requireRealModel>>;
  options: ScaledOptions;
  suite: Awaited<ReturnType<typeof runSelectedSuite>>;
}) {
  const { modelAfter, modelBefore, options, suite } = input;
  const passed = suitePassed(suite);
  const maximumRunning = suite.concurrent?.maximumRunning ?? null;
  const reportFailure = concurrentReportFailure(maximumRunning);
  const qualityCandidates = reportQualityCandidates(suiteResults(suite));
  const evidenceClassification = reportEvidenceClassification({
    caseResults: suiteResults(suite),
    passed,
    ...(reportFailure === undefined ? {} : { reportFailure }),
  });
  return {
    classification: passed ? "scaled_stress_passed" : "scaled_stress_limit_found",
    ...evidenceClassification,
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
    options,
    maximumRunning,
    qualityCandidates,
    workloadPlan: SCALED_WORKLOAD_PLAN,
    modelBefore,
    modelAfter,
    ...suite,
  };
}

async function writeReport(output: string, report: object): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeFailureReport(output: string, stage: M3EvaluationFailureStage): Promise<void> {
  await writeReport(output, {
    classification: "scaled_stress_limit_found",
    ...failedEvaluationEvidence(stage),
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
  });
}

async function closeRuntime(
  root: string | undefined,
  runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined,
): Promise<void> {
  await runtime?.daemon.close();
  await runtime?.core.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
}

async function main(): Promise<void> {
  let output = reportPath("sequential");
  let failureStage: M3EvaluationFailureStage = "cli_input";
  let root: string | undefined;
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    const options = parseOptions(process.argv.slice(2));
    output = reportPath(options.mode);
    failureStage = "environment_setup";
    requireStressPlatform();
    const stressRoot = await createStressRoot("vault-m3-stress-scaled");
    root = stressRoot;
    await mkdir(join(stressRoot, "fixtures"));
    await prepareModelStore();
    failureStage = "runtime_startup";
    runtime = await startStressRuntime(join(stressRoot, "state"));
    failureStage = "runtime_transport";
    const modelBefore = await requireRealModel(runtime.endpoint, false);
    failureStage = "fixture";
    const suite = await runSelectedSuite(
      runtime.endpoint,
      join(stressRoot, "fixtures", options.mode),
      options,
    );
    failureStage = "runtime_transport";
    const modelAfter = await requireRealModel(runtime.endpoint);
    failureStage = "evaluator";
    const report = scaledReport({ modelAfter, modelBefore, options, suite });
    failureStage = "report";
    await writeReport(output, report);
    console.log(JSON.stringify({ classification: report.classification, output }));
    if (report.classification !== "scaled_stress_passed") process.exitCode = 1;
  } catch (error) {
    await writeFailureReport(output, stressFailureStage(error, failureStage));
    throw error;
  } finally {
    await closeRuntime(root, runtime);
  }
}

await main();
