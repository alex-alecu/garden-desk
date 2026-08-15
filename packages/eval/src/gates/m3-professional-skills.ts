import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import {
  prepareModelStore,
  requireRealModel,
  startStressRuntime,
} from "../stress/m3-stress-runtime.js";
import { createStressRoot, requireStressPlatform } from "../stress/stress-platform.js";
import { runSequentialCases } from "../stress/stress-suite.js";
import {
  DOMAIN_SKILLS,
  type ProfessionalSkillId,
  prepareProfessionalSkillCase,
} from "./professional-skills-profile.js";

const CASE_DEADLINE_MS = 5 * 60_000;

function requestedCase(): ProfessionalSkillId | undefined {
  const index = process.argv.indexOf("--case");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  const id = DOMAIN_SKILLS.find((candidate) => candidate === value);
  if (id === undefined) throw new Error(`Unknown professional skill case: ${value ?? "missing"}`);
  return id;
}

function reportPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(
    process.cwd(),
    "packages/eval/.generated/professional-skills",
    `${process.platform}-${timestamp}.json`,
  );
}

async function main(): Promise<void> {
  requireStressPlatform();
  const root = await createStressRoot("vault-m3-professional-skills");
  const output = reportPath();
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  try {
    await mkdir(join(root, "fixtures"));
    await mkdir(dirname(output), { recursive: true });
    await prepareModelStore();
    runtime = await startStressRuntime(join(root, "state"));
    const modelBefore = await requireRealModel(runtime.endpoint, false);
    const selected = requestedCase();
    const evidence = await runSequentialCases({
      endpoint: runtime.endpoint,
      fixtureRoot: join(root, "fixtures"),
      ids: selected === undefined ? [...DOMAIN_SKILLS] : [selected],
      prepare: prepareProfessionalSkillCase,
      deadlineMs: CASE_DEADLINE_MS,
    });
    const auditValid = await runtime.core.verifyAudit();
    const passed = evidence.every(({ result }) => result.passed) && auditValid;
    const report = {
      classification: passed ? "professional_skills_passed" : "professional_skills_limit_found",
      createdAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      totalMemoryBytes: totalmem(),
      modelBefore,
      auditValid,
      evidence,
    };
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(
      JSON.stringify({
        classification: report.classification,
        output,
        results: evidence.map(({ result }) => result),
      }),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await runtime?.daemon.close();
    await runtime?.core.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
