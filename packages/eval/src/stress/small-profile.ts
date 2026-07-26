import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  type FixtureEvidence,
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

export type SmallCaseId = "pdf" | "workbook" | "xlsx-folder" | "mixed-folder" | "invalid-document";

const INVALID_TASK = [
  "Use exactly one Python execution with pypdf to validate every PDF under /source.",
  "When parsing fails, stop immediately without repair or artifacts and print INVALID_DOCUMENT_STOP=1.",
  "Do not respond before the validation execution.",
].join(" ");

const CASES: StressCaseDefinition<SmallCaseId>[] = [
  {
    id: "pdf",
    task: PDF_TASK,
    create: async (source) => createPdf(join(source, "long-report.pdf"), 12),
    expected: pdfTokens,
  },
  {
    id: "workbook",
    task: XLSX_TASK,
    create: async (source) =>
      createXlsxCorpus(source, { files: 1, sheets: 2, rowsPerSheet: 2_500 }),
    expected: xlsxTokens,
  },
  {
    id: "xlsx-folder",
    task: XLSX_TASK,
    create: async (source) =>
      createXlsxCorpus(source, { files: 3, sheets: 2, rowsPerSheet: 2_500 }),
    expected: xlsxTokens,
  },
  {
    id: "mixed-folder",
    task: MIXED_TASK,
    create: createMixedCorpus,
    expected: mixedTokens,
  },
  {
    id: "invalid-document",
    task: INVALID_TASK,
    create: createInvalidCorpus,
    expected: () => ["INVALID_DOCUMENT_STOP=1"],
    maxExecutions: 2,
  },
];

async function createMixedCorpus(source: string): Promise<FixtureEvidence> {
  const xlsx = await createXlsxCorpus(join(source, "spreadsheets"), {
    files: 2,
    sheets: 2,
    rowsPerSheet: 2_500,
  });
  const docx = await createDocxCorpus(join(source, "documents"), {
    files: 3,
    pagesPerFile: 12,
  });
  return {
    bytes: xlsx.bytes + docx.bytes,
    files: xlsx.files + docx.files,
    expected: { ...xlsx.expected, ...docx.expected },
  };
}

async function createInvalidCorpus(source: string): Promise<FixtureEvidence> {
  const content = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog";
  await writeFile(join(source, "truncated.pdf"), content, {
    mode: 0o600,
  });
  return { bytes: Buffer.byteLength(content), files: 1, expected: { invalid: 1 } };
}

export async function prepareSmallCase(
  root: string,
  id: SmallCaseId,
): Promise<PreparedStressCase<SmallCaseId>> {
  const definition = CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown small stress case: ${id}`);
  return prepareStressCase(root, definition);
}

export const SMALL_SEQUENTIAL_CASES: SmallCaseId[] = [
  "pdf",
  "workbook",
  "xlsx-folder",
  "mixed-folder",
  "invalid-document",
];

export const SMALL_CONCURRENT_CASES: SmallCaseId[] = ["pdf", "xlsx-folder", "mixed-folder"];
