import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { createVaultCore } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  PDF_PAGE_TARGET,
  WORD_PAGE_TARGET,
  XLSX_TARGET,
} from "../stress/document-fixtures.js";
import { pollAgentRun } from "./m3-gate-support.js";

type Core = Awaited<ReturnType<typeof createVaultCore>>;

interface GoldenTask {
  name: string;
  prepare(sourceDir: string): Promise<void>;
  prompt: string;
  expectation: string;
  check(text: string): boolean;
}

const GOLDEN_TASKS: GoldenTask[] = [
  {
    name: "xlsx-extraction",
    prepare: async (sourceDir) => {
      await createXlsxCorpus(sourceDir, { files: 1, sheets: 1, rowsPerSheet: 8 });
    },
    prompt:
      "Read the spreadsheet in /source and write a short plain-text summary to /workspace with the total number of data rows and the note on the row marked as a priority review.",
    expectation: `deliverable contains "${XLSX_TARGET}" and "1001"`,
    check: (text) => text.includes(XLSX_TARGET) && text.includes("1001"),
  },
  {
    name: "docx-extraction",
    prepare: async (sourceDir) => {
      await createDocxCorpus(sourceDir, { files: 1, pagesPerFile: 3 });
    },
    prompt:
      "Read the Word document in /source and write a short plain-text summary to /workspace with the total page count and the exact text of the last page.",
    expectation: `deliverable contains "${WORD_PAGE_TARGET}" and "checksum=1003"`,
    check: (text) => text.includes(WORD_PAGE_TARGET) && text.includes("checksum=1003"),
  },
  {
    name: "pdf-extraction",
    prepare: async (sourceDir) => {
      await createPdf(join(sourceDir, "policy-brief.pdf"), 3);
    },
    prompt:
      "Read the PDF in /source and write a short plain-text summary to /workspace with the total page count and the exact text on the last page.",
    expectation: `deliverable contains "${PDF_PAGE_TARGET}" and "checksum=51"`,
    check: (text) => text.includes(PDF_PAGE_TARGET) && text.includes("checksum=51"),
  },
  {
    name: "mixed-folder-report",
    prepare: async (sourceDir) => {
      await createXlsxCorpus(sourceDir, { files: 1, sheets: 1, rowsPerSheet: 4 });
      await createDocxCorpus(sourceDir, { files: 1, pagesPerFile: 1 });
      await createPdf(join(sourceDir, "policy-brief.pdf"), 1);
    },
    prompt:
      "Look at the different documents in /source and write a short plain-text report to /workspace listing each file's exact name.",
    expectation: "deliverable lists all three source file names",
    check: (text) =>
      text.includes("workbook-001.xlsx") &&
      text.includes("document-001.docx") &&
      text.includes("policy-brief.pdf"),
  },
];

async function awaitTerminalRun(core: Core, runId: string): Promise<AgentRunSnapshot> {
  const deadline = performance.now() + 10 * 60_000;
  while (performance.now() < deadline) {
    const snapshot = await pollAgentRun(core, runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 500));
  }
  throw new Error(`Golden task run timed out: ${runId}`);
}

async function deliverableText(core: Core, sessionId: string, artifactId: string): Promise<string> {
  const materialized = await core.materializeArtifact(sessionId, artifactId);
  try {
    return await readFile(materialized, "utf8");
  } finally {
    await rm(dirname(materialized), { recursive: true, force: true });
  }
}

interface GoldenResult {
  name: string;
  passed: boolean;
  reason: string;
}

async function runOneTask(core: Core, root: string, task: GoldenTask): Promise<GoldenResult> {
  try {
    const sourceDir = join(root, task.name);
    await mkdir(sourceDir, { recursive: true });
    await task.prepare(sourceDir);
    const folder = await core.addFolder(sourceDir);
    const session = await core.createSession(folder.id);
    const run = await core.startAgent(session.id, task.prompt);
    const snapshot = await awaitTerminalRun(core, run.id);
    if (snapshot.run.state !== "succeeded" || snapshot.artifacts.length === 0) {
      return {
        name: task.name,
        passed: false,
        reason: `run ended "${snapshot.run.state}" with ${snapshot.artifacts.length} deliverable files`,
      };
    }
    for (const artifact of snapshot.artifacts) {
      const text = await deliverableText(core, session.id, artifact.id);
      if (task.check(text)) {
        return {
          name: task.name,
          passed: true,
          reason: `${artifact.name} matched: ${task.expectation}`,
        };
      }
    }
    return {
      name: task.name,
      passed: false,
      reason: `no deliverable matched: ${task.expectation}`,
    };
  } catch (error) {
    return {
      name: task.name,
      passed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs the four golden folder tasks (XLSX, DOCX, PDF extraction, and a mixed-folder report) through
 * one real agent run each, and checks the deliverable file deterministically against known fixture
 * values. Prints one line per task plus a pass count; exits non-zero when a task fails.
 */
export async function runGoldenTasks(core: Core, root: string): Promise<void> {
  let passed = 0;
  for (const task of GOLDEN_TASKS) {
    const result = await runOneTask(core, root, task);
    if (result.passed) passed += 1;
    console.log(`golden: ${result.name}: ${result.passed ? "pass" : "fail"} — ${result.reason}`);
  }
  console.log(`golden: ${passed}/${GOLDEN_TASKS.length} passed`);
  if (passed < GOLDEN_TASKS.length) process.exitCode = 1;
}
