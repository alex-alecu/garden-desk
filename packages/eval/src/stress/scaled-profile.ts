import { join } from "node:path";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  type FixtureEvidence,
  type FixtureProgress,
} from "./document-fixtures.js";
import {
  MIXED_TASK,
  mixedTokens,
  PDF_TASK,
  type PreparedStressCase,
  pdfTokens,
  prepareStressCase,
  type StressCaseDefinition,
  XLSX_TASK,
  xlsxTokens,
} from "./document-workloads.js";

export type ScaledCaseId = "pdf" | "workbook" | "xlsx-folder" | "mixed-folder";

interface ScaledXlsxPlan {
  files: number;
  sheets: number;
  rowsPerFile: number;
}

export const SCALED_WORKLOAD_PLAN = {
  pdf: { files: 1, pagesPerFile: 100 },
  workbook: { files: 1, sheets: 10, rowsPerFile: 1_000_000 },
  xlsxFolder: { files: 50, sheets: 10, rowsPerFile: 200_000 },
  mixedFolder: {
    xlsx: { files: 20, sheets: 10, rowsPerFile: 500_000 },
    docx: { files: 30, pagesPerFile: 100 },
  },
  concurrentCases: ["workbook", "xlsx-folder", "mixed-folder"],
} as const;

function xlsxShape(plan: ScaledXlsxPlan) {
  if (plan.rowsPerFile % plan.sheets !== 0) {
    throw new Error("Scaled XLSX rows must divide evenly across sheets.");
  }
  return { files: plan.files, sheets: plan.sheets, rowsPerSheet: plan.rowsPerFile / plan.sheets };
}

function logProgress(id: ScaledCaseId) {
  return (progress: FixtureProgress) => {
    console.log(JSON.stringify({ phase: "fixture.progress", id, ...progress }));
  };
}

const CASES: StressCaseDefinition<ScaledCaseId>[] = [
  {
    id: "pdf",
    task: PDF_TASK,
    create: async (source) =>
      createPdf(join(source, "long-report.pdf"), SCALED_WORKLOAD_PLAN.pdf.pagesPerFile),
    expected: pdfTokens,
  },
  {
    id: "workbook",
    task: XLSX_TASK,
    create: async (source) =>
      createXlsxCorpus(source, xlsxShape(SCALED_WORKLOAD_PLAN.workbook), logProgress("workbook")),
    expected: xlsxTokens,
  },
  {
    id: "xlsx-folder",
    task: XLSX_TASK,
    create: async (source) =>
      createXlsxCorpus(
        source,
        xlsxShape(SCALED_WORKLOAD_PLAN.xlsxFolder),
        logProgress("xlsx-folder"),
      ),
    expected: xlsxTokens,
  },
  {
    id: "mixed-folder",
    task: MIXED_TASK,
    create: createMixedCorpus,
    expected: mixedTokens,
  },
];

async function createMixedCorpus(source: string): Promise<FixtureEvidence> {
  const xlsx = await createXlsxCorpus(
    join(source, "spreadsheets"),
    xlsxShape(SCALED_WORKLOAD_PLAN.mixedFolder.xlsx),
    logProgress("mixed-folder"),
  );
  const docx = await createDocxCorpus(
    join(source, "documents"),
    { ...SCALED_WORKLOAD_PLAN.mixedFolder.docx },
    logProgress("mixed-folder"),
  );
  return {
    bytes: xlsx.bytes + docx.bytes,
    files: xlsx.files + docx.files,
    expected: { ...xlsx.expected, ...docx.expected },
  };
}

export async function prepareScaledCase(
  root: string,
  id: ScaledCaseId,
): Promise<PreparedStressCase<ScaledCaseId>> {
  const definition = CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown scaled stress case: ${id}`);
  return prepareStressCase(root, definition);
}

export const SCALED_SEQUENTIAL_CASES: ScaledCaseId[] = [
  "pdf",
  "workbook",
  "xlsx-folder",
  "mixed-folder",
];

export const SCALED_CONCURRENT_CASES: ScaledCaseId[] = [...SCALED_WORKLOAD_PLAN.concurrentCases];
