import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  failedEvaluationEvidence,
  type M3EvaluationFailureStage,
  reportEvidenceClassification,
  reportQualityCandidates,
} from "../stress/m3-evidence-classification.js";
import {
  prepareModelStore,
  requireRealModel,
  startStressRuntime,
  stressFailureStage,
} from "../stress/m3-stress-runtime.js";
import { createStressRoot, requireStressPlatform } from "../stress/stress-platform.js";
import { runSequentialCases } from "../stress/stress-suite.js";
import {
  type ProfessionalRoutingCaseId,
  prepareProfessionalRoutingCase,
  ROUTING_CASE_IDS,
} from "./professional-skill-routing-profile.js";
import {
  DOMAIN_SKILLS,
  type ProfessionalSkillId,
  prepareProfessionalSkillCase,
} from "./professional-skills-profile.js";

const CASE_DEADLINE_MS = 5 * 60_000;

type ProfessionalCaseId = ProfessionalSkillId | ProfessionalRoutingCaseId;
const CASE_IDS: readonly ProfessionalCaseId[] = [...DOMAIN_SKILLS, ...ROUTING_CASE_IDS];

function requestedCase(): ProfessionalCaseId | undefined {
  const index = process.argv.indexOf("--case");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  const id = CASE_IDS.find((candidate) => candidate === value);
  if (id === undefined) throw new Error(`Unknown professional skill case: ${value ?? "missing"}`);
  return id;
}

async function prepareCase(root: string, id: ProfessionalCaseId) {
  const domain = DOMAIN_SKILLS.find((candidate) => candidate === id);
  if (domain !== undefined) return await prepareProfessionalSkillCase(root, domain);
  return await prepareProfessionalRoutingCase(root, id as ProfessionalRoutingCaseId);
}

function reportPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(
    process.cwd(),
    "packages/eval/.generated/professional-skills",
    `${process.platform}-${timestamp}.json`,
  );
}

function professionalReport(
  evidence: Awaited<ReturnType<typeof runSequentialCases>>,
  auditValid: boolean,
  modelBefore: Awaited<ReturnType<typeof requireRealModel>>,
) {
  const passed = evidence.every(({ result }) => result.passed) && auditValid;
  const qualityCandidates = reportQualityCandidates(evidence.map(({ result }) => result));
  const evidenceClassification = reportEvidenceClassification({
    caseResults: evidence.map(({ result }) => result),
    passed,
    ...(auditValid
      ? {}
      : {
          reportFailure: {
            failureClass: "product_failure" as const,
            evidenceReference: "report.auditValid" as const,
          },
        }),
  });
  return {
    classification: passed ? "professional_skills_passed" : "professional_skills_limit_found",
    ...evidenceClassification,
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
    modelBefore,
    auditValid,
    qualityCandidates,
    evidence,
  };
}

async function writeReport(output: string, report: object): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeFailureReport(output: string, stage: M3EvaluationFailureStage): Promise<void> {
  await writeReport(output, {
    classification: "professional_skills_limit_found",
    ...failedEvaluationEvidence(stage),
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
  });
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
    const stressRoot = await createStressRoot("vault-m3-professional-skills");
    root = stressRoot;
    await mkdir(join(stressRoot, "fixtures"));
    await prepareModelStore();
    failureStage = "runtime_startup";
    runtime = await startStressRuntime(join(stressRoot, "state"));
    failureStage = "runtime_transport";
    const modelBefore = await requireRealModel(runtime.endpoint, false);
    failureStage = "fixture";
    const evidence = await runSequentialCases({
      endpoint: runtime.endpoint,
      fixtureRoot: join(stressRoot, "fixtures"),
      ids: selected === undefined ? [...CASE_IDS] : [selected],
      prepare: prepareCase,
      deadlineMs: CASE_DEADLINE_MS,
    });
    failureStage = "evaluator";
    const auditValid = await runtime.core.verifyAudit();
    const report = professionalReport(evidence, auditValid, modelBefore);
    failureStage = "report";
    await writeReport(output, report);
    console.log(
      JSON.stringify({
        classification: report.classification,
        output,
        results: evidence.map(({ result }) => result),
      }),
    );
    if (report.classification !== "professional_skills_passed") process.exitCode = 1;
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
