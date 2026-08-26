import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  failedEvaluationEvidence,
  type M3EvaluationFailureStage,
  reportEvidenceClassification,
  reportQualityCandidates,
} from "./m3-evidence-classification.js";
import {
  expectRpcFailure,
  prepareModelStore,
  requireRealModel,
  startStressRuntime,
  stressFailureStage,
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

function smallReportFailure(evidence: {
  auditValid: boolean;
  modelAfterError?: string | undefined;
}) {
  if (!evidence.auditValid) {
    return {
      failureClass: "product_failure" as const,
      evidenceReference: "report.auditValid" as const,
    };
  }
  if (evidence.modelAfterError !== undefined) {
    return {
      failureClass: "runtime_failure" as const,
      evidenceReference: "report.modelAfterError" as const,
    };
  }
  return undefined;
}

async function writeReport(output: string, report: object): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeFailureReport(output: string, stage: M3EvaluationFailureStage): Promise<void> {
  await writeReport(output, {
    classification: "small_stress_limit_found",
    ...failedEvaluationEvidence(stage),
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
  });
}

async function runSmallSuite(
  runtime: Awaited<ReturnType<typeof startStressRuntime>>,
  root: string,
  selected: (typeof SMALL_CASE_IDS)[number] | undefined,
  policyCases: string[],
) {
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
  } catch {
    modelAfterError = "m3_model_status_failure";
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

function smallReport(evidence: Awaited<ReturnType<typeof runSmallSuite>>) {
  const results = evidence.sequential.map((item) => item.result);
  const passed =
    results.every((result) => result.passed) &&
    evidence.auditValid &&
    evidence.modelAfterError === undefined;
  const reportFailure = smallReportFailure(evidence);
  const evidenceClassification = reportEvidenceClassification({
    caseResults: results,
    passed,
    ...(reportFailure === undefined ? {} : { reportFailure }),
  });
  return {
    report: {
      classification: passed ? "small_stress_passed" : "small_stress_limit_found",
      ...evidenceClassification,
      createdAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      totalMemoryBytes: totalmem(),
      qualityCandidates: reportQualityCandidates(results),
      ...evidence,
    },
    results,
  };
}

async function main(): Promise<void> {
  const output = reportPath();
  let failureStage: M3EvaluationFailureStage = "cli_input";
  let root: string | undefined;
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    const selected = requestedCase();
    failureStage = "environment_setup";
    requireStressPlatform();
    const stressRoot = await createStressRoot("vault-m3-stress-small");
    root = stressRoot;
    await mkdir(join(stressRoot, "fixtures"));
    await prepareModelStore();
    failureStage = "runtime_startup";
    runtime = await startStressRuntime(join(stressRoot, "state"));
    failureStage = "fixture";
    const policyCases = await runPolicyCases(runtime.endpoint, stressRoot);
    const evidence = await runSmallSuite(runtime, stressRoot, selected, policyCases);
    failureStage = "evaluator";
    const { report, results } = smallReport(evidence);
    failureStage = "report";
    await writeReport(output, report);
    console.log(JSON.stringify({ classification: report.classification, output, results }));
    if (report.classification !== "small_stress_passed") process.exitCode = 1;
  } catch (error) {
    await writeFailureReport(output, stressFailureStage(error, failureStage));
    throw error;
  } finally {
    await runtime?.daemon.close();
    await runtime?.core.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

await main();
