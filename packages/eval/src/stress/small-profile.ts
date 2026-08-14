import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLegacyDocFixture } from "../fixtures/legacy-doc.js";
import {
  createOversizedRevenueCorpus,
  OVERSIZED_TABLE_PLAN,
} from "./context-compaction-fixture.js";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  type FixtureEvidence,
} from "./document-fixtures.js";
import {
  type DeliverableExpectation,
  type PreparedStressCase,
  prepareStressCase,
  type StressCaseDefinition,
} from "./document-workloads.js";
import {
  FILE_MANIPULATION_CASES,
  type FileManipulationCaseId,
} from "./file-manipulation-profile.js";
import {
  createXlsxPathListCorpus,
  XLSX_PATH_LIST_ROWS,
  XLSX_PATH_LIST_TASK,
} from "./xlsx-path-list-fixture.js";
import { createFilteredRowsXlsxCorpus } from "./xlsx-row-filter-fixture.js";

export type SmallCaseId =
  | FileManipulationCaseId
  | "pdf-report"
  | "word-report"
  | "excel-report"
  | "excel-row-filter"
  | "excel-chat-path-list"
  | "large-corpus-continuation"
  | "invalid-document"
  | "legacy-doc-read"
  | "romanian-task"
  | "no-skill-direct"
  | "terminal-discovery"
  | "oversized-table-result";

function expectedValue(evidence: FixtureEvidence, name: string): string {
  const value = evidence.expected[name];
  if (value === undefined) throw new Error(`Missing expected fixture value: ${name}`);
  return String(value);
}

function reportLabelValues(evidence: FixtureEvidence) {
  const invoiceTotal = expectedValue(evidence, "xlsxTotal");
  return [
    { label: "MATCHING_INVOICES", values: [expectedValue(evidence, "xlsxMatches")] },
    { label: "INVOICE_TOTAL", values: [invoiceTotal, `${invoiceTotal}.0`] },
    { label: "MEETING_NOTES", values: [expectedValue(evidence, "wordPages")] },
    { label: "POLICY_PAGES", values: [expectedValue(evidence, "pdfPages")] },
  ];
}

function deliverables(names: string[]) {
  return (evidence: FixtureEvidence): DeliverableExpectation[] =>
    names.map((name) => ({
      name,
      facts: [],
      visibleLabelValues: reportLabelValues(evidence),
      deterministic: true,
    }));
}

async function createBusinessCorpus(source: string, workbooks = 4): Promise<FixtureEvidence> {
  const xlsx = await createXlsxCorpus(join(source, "invoices"), {
    files: workbooks,
    sheets: 2,
    rowsPerSheet: 2_500,
  });
  const docx = await createDocxCorpus(join(source, "meetings"), {
    files: 3,
    pagesPerFile: 8,
  });
  const pdf = await createPdf(join(source, "policy-review.pdf"), 12);
  await writeFile(
    join(source, "README.md"),
    "Quarterly source folder. Ignore filenames as evidence.\n",
  );
  await writeFile(join(source, "reference.csv"), "kind,value\nnoise,17\n");
  await writeFile(join(source, "rules.ts"), "export const surchargeBasisPoints = 275;\n");
  return {
    bytes: xlsx.bytes + docx.bytes + pdf.bytes + 120,
    files: xlsx.files + docx.files + pdf.files + 3,
    expected: { ...xlsx.expected, ...docx.expected, ...pdf.expected },
  };
}

const REPORT_SOURCE = [
  "Review the complete selected business folder, including invoice workbooks, Word meeting notes, and the policy PDF.",
  "Find invoice rows whose note contains Priority review and total their amount values; also count Decision record paragraphs in the meeting notes and Policy section pages in the policy PDF.",
];

function reportTask(format: "PDF" | "Word" | "Excel", name: string): string {
  return [
    ...REPORT_SOURCE,
    `Create a polished ${format} management report named ${name} in the private workspace.`,
    "Visibly label the match count as MATCHING_INVOICES, the matching amount total as INVOICE_TOTAL, the meeting paragraph count as MEETING_NOTES, and the policy page count as POLICY_PAGES so another local process can verify them.",
  ].join(" ");
}

const INVALID_TASK = [
  "Use one Python execution with pypdf to discover and validate every PDF in this folder.",
  "Report clearly when any PDF is invalid.",
  "Do not run a separate discovery command, repair a PDF, or create a replacement.",
].join(" ");

const CASES: StressCaseDefinition<SmallCaseId>[] = [
  ...FILE_MANIPULATION_CASES,
  {
    id: "pdf-report",
    task: reportTask("PDF", "management-report.pdf"),
    create: createBusinessCorpus,
    expected: () => [],
    deliverables: deliverables(["management-report.pdf"]),
  },
  {
    id: "word-report",
    task: reportTask("Word", "management-report.docx"),
    create: createBusinessCorpus,
    expected: () => [],
    deliverables: deliverables(["management-report.docx"]),
  },
  {
    id: "excel-report",
    task: reportTask("Excel", "management-report.xlsx"),
    create: createBusinessCorpus,
    expected: () => [],
    deliverables: deliverables(["management-report.xlsx"]),
  },
  {
    id: "excel-row-filter",
    task: "Generate an excel with all rows in excel files containing “avans”",
    create: createFilteredRowsXlsxCorpus,
    expected: () => [],
    deliverables: (evidence) => [
      {
        deterministic: true,
        extension: ".xlsx",
        facts: Array.from({ length: 10 }, (_, index) =>
          expectedValue(evidence, `filterRow${index + 1}`),
        ),
        forbiddenFacts: ["ordinary transfer"],
      },
    ],
  },
  {
    id: "excel-chat-path-list",
    task: XLSX_PATH_LIST_TASK,
    create: createXlsxPathListCorpus,
    expected: () => [],
    expectedTableRows: () => XLSX_PATH_LIST_ROWS.map(({ amount }) => ({ amount })),
    forbidArtifacts: true,
  },
  {
    id: "large-corpus-continuation",
    task: reportTask("Excel", "large-corpus-report.xlsx"),
    create: async (source) => createBusinessCorpus(source, 24),
    expected: () => [],
    deliverables: deliverables(["large-corpus-report.xlsx"]),
  },
  {
    id: "legacy-doc-read",
    task: [
      "Read legacy-sample.doc as plain text.",
      "Report its first complete sentence as LEGACY_DOC_TITLE=<value>.",
      "Report the publisher name in the sentence about the PNG book as LEGACY_DOC_PUBLISHER=<value>.",
      "Do not create or modify a file.",
    ].join(" "),
    create: async (source) => ({
      bytes: await createLegacyDocFixture(source),
      files: 1,
      expected: {},
    }),
    expected: () => [
      "LEGACY_DOC_TITLE=This is just a small test document.",
      "LEGACY_DOC_PUBLISHER=O’Reilly",
    ],
    requiredExecutionText: ["/usr/bin/antiword", "UTF-8.txt"],
    requiredSkills: ["word-documents"],
    forbidArtifacts: true,
  },
  {
    id: "invalid-document",
    task: INVALID_TASK,
    create: async (source) => {
      const content = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog";
      await writeFile(join(source, "truncated.pdf"), content, { mode: 0o600 });
      return { bytes: Buffer.byteLength(content), files: 1, expected: {} };
    },
    expected: () => ["invalid"],
    forbidArtifacts: true,
  },
  {
    id: "romanian-task",
    task: "Analizează toate registrele cu tranzacții și avansuri din folder și raportează totalul valorilor din coloana `amount` pentru rândurile în care coloana `note` conține Priority review ca TOTAL_AVANS=<valoare>.",
    create: async (source) =>
      createXlsxCorpus(source, { files: 3, sheets: 2, rowsPerSheet: 2_500 }),
    expected: (evidence) => [`TOTAL_AVANS=${expectedValue(evidence, "xlsxTotal")}`],
  },
  {
    id: "no-skill-direct",
    task: "Explain in one concise sentence what offline-first means.",
    create: async () => ({ bytes: 0, files: 0, expected: {} }),
    expected: () => [],
  },
  {
    id: "terminal-discovery",
    task: "Inspect this source folder and report SURCHARGE_BPS=<value> from the pricing rule.",
    create: async (source) => {
      const content = "export const surchargeBasisPoints = 275;\n";
      await writeFile(join(source, "pricing-rules.ts"), content);
      return { bytes: Buffer.byteLength(content), files: 1, expected: {} };
    },
    expected: () => ["SURCHARGE_BPS=275"],
  },
  {
    id: "oversized-table-result",
    task: [
      "Search every Excel workbook in the selected folder for rows describing revenue received and return all matching rows in a nice table.",
      "Create a complete XLSX workbook in the private workspace because the result is too large for the chat response.",
      "Do not omit rows, abbreviate cells, use placeholders, or ask which output format to use.",
    ].join(" "),
    create: createOversizedRevenueCorpus,
    expected: () => [],
    deliverables: (evidence) => [
      {
        deterministic: true,
        extension: ".xlsx",
        facts: Array.from({ length: OVERSIZED_TABLE_PLAN.rows }, (_, index) =>
          expectedValue(evidence, `revenueRow${index + 1}`),
        ),
      },
    ],
  },
];

export async function prepareSmallCase(
  root: string,
  id: SmallCaseId,
): Promise<PreparedStressCase<SmallCaseId>> {
  const definition = CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown small stress case: ${id}`);
  return prepareStressCase(root, definition);
}

export const SMALL_CASE_IDS: SmallCaseId[] = CASES.map(({ id }) => id);

export const SMALL_GATE_CASES: SmallCaseId[] = [
  "terminal-discovery",
  "legacy-doc-read",
  "xlsx-edit",
  "docx-edit",
  "invalid-document",
];
