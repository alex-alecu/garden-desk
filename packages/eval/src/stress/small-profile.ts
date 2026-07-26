import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  type FixtureEvidence,
} from "./document-fixtures.js";

export type SmallCaseId = "pdf" | "workbook" | "xlsx-folder" | "mixed-folder" | "invalid-document";

export interface PreparedStressCase {
  id: SmallCaseId;
  source: string;
  task: string;
  fixtureMs: number;
  evidence: FixtureEvidence;
  expectedTokens: string[];
  maxExecutions?: number;
}

interface CaseDefinition {
  id: SmallCaseId;
  task: string;
  create(source: string): Promise<FixtureEvidence>;
  expected(evidence: FixtureEvidence): string[];
  maxExecutions?: number;
}

function value(evidence: FixtureEvidence, name: string): number | string {
  const result = evidence.expected[name];
  if (result === undefined) throw new Error(`Missing fixture expectation ${name}.`);
  return result;
}

const PDF_TASK = [
  "Use Python and pypdf to parse every page of every PDF under /source.",
  "Do not use file metadata as the answer.",
  "From each page containing VAULT_PDF_PAGE, parse the decimal integer immediately after the literal checksum= text.",
  "Print PDF_PAGES=<matching page count> and PDF_CHECKSUM=<sum of those parsed integers>.",
  "Do not respond until the complete hierarchy and every page have been read.",
].join(" ");

const XLSX_TASK = [
  "Use Python and openpyxl in read-only mode to inspect every worksheet row of every .xlsx file under /source.",
  "Find VAULT_STRESS_TARGET as a case-insensitive substring in every nonempty cell.",
  "Use each worksheet's header row to locate the column named amount.",
  "Print XLSX_MATCHES=<complete match count> and XLSX_TOTAL=<sum of the numeric amount-column cell in every matching row>.",
  "Do not respond until every workbook, worksheet, and row has been read.",
].join(" ");

const MIXED_TASK = [
  XLSX_TASK,
  "Also use python-docx to inspect every paragraph of every DOCX under /source.",
  "For each VAULT_WORD_PAGE paragraph, parse the decimal integer immediately after the literal checksum= text.",
  "Print WORD_PAGES=<matching paragraph count> and WORD_CHECKSUM=<sum of those parsed integers>.",
  "All four metrics are required before responding.",
].join(" ");

const INVALID_TASK = [
  "Use exactly one Python execution with pypdf to validate every PDF under /source.",
  "When parsing fails, stop immediately without repair or artifacts and print INVALID_DOCUMENT_STOP=1.",
  "Do not respond before the validation execution.",
].join(" ");

const CASES: CaseDefinition[] = [
  {
    id: "pdf",
    task: PDF_TASK,
    create: async (source) => createPdf(join(source, "long-report.pdf"), 12),
    expected: (evidence) => [
      `PDF_PAGES=${value(evidence, "pdfPages")}`,
      `PDF_CHECKSUM=${value(evidence, "pdfChecksum")}`,
    ],
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
    expected: (evidence) => [
      ...xlsxTokens(evidence),
      `WORD_PAGES=${value(evidence, "wordPages")}`,
      `WORD_CHECKSUM=${value(evidence, "wordChecksum")}`,
    ],
  },
  {
    id: "invalid-document",
    task: INVALID_TASK,
    create: createInvalidCorpus,
    expected: () => ["INVALID_DOCUMENT_STOP=1"],
    maxExecutions: 2,
  },
];

function xlsxTokens(evidence: FixtureEvidence): string[] {
  return [
    `XLSX_MATCHES=${value(evidence, "xlsxMatches")}`,
    `XLSX_TOTAL=${value(evidence, "xlsxTotal")}`,
  ];
}

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

export async function prepareSmallCase(root: string, id: SmallCaseId): Promise<PreparedStressCase> {
  const definition = CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown small stress case: ${id}`);
  const source = join(root, id);
  await mkdir(source, { recursive: true });
  const startedAt = performance.now();
  const evidence = await definition.create(source);
  return {
    id,
    source,
    task: definition.task,
    fixtureMs: Math.round(performance.now() - startedAt),
    evidence,
    expectedTokens: definition.expected(evidence),
    ...(definition.maxExecutions === undefined ? {} : { maxExecutions: definition.maxExecutions }),
  };
}

export const SMALL_SEQUENTIAL_CASES: SmallCaseId[] = [
  "pdf",
  "workbook",
  "xlsx-folder",
  "mixed-folder",
  "invalid-document",
];

export const SMALL_CONCURRENT_CASES: SmallCaseId[] = ["pdf", "xlsx-folder", "mixed-folder"];
