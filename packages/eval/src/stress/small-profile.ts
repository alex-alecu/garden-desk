import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCompactionCorpus,
  createOversizedRevenueCorpus,
  createRepeatedCompactionCorpus,
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
  | "romanian-task"
  | "no-skill-direct"
  | "terminal-discovery"
  | "context-compaction"
  | "repeated-context-compaction"
  | "oversized-table-result";

function expectedValue(evidence: FixtureEvidence, name: string): string {
  const value = evidence.expected[name];
  if (value === undefined) throw new Error(`Missing expected fixture value: ${name}`);
  return String(value);
}

function reportFactAlternatives(evidence: FixtureEvidence): string[][] {
  const invoiceTotal = expectedValue(evidence, "xlsxTotal");
  return [
    [
      `MATCHING_INVOICES=${expectedValue(evidence, "xlsxMatches")}`,
      `MATCHING_INVOICES: ${expectedValue(evidence, "xlsxMatches")}`,
    ],
    [
      `INVOICE_TOTAL=${invoiceTotal}`,
      `INVOICE_TOTAL=${invoiceTotal}.0`,
      `INVOICE_TOTAL: ${invoiceTotal}`,
      `INVOICE_TOTAL: ${invoiceTotal}.0`,
    ],
    [
      `MEETING_NOTES=${expectedValue(evidence, "wordPages")}`,
      `MEETING_NOTES: ${expectedValue(evidence, "wordPages")}`,
    ],
    [
      `POLICY_PAGES=${expectedValue(evidence, "pdfPages")}`,
      `POLICY_PAGES: ${expectedValue(evidence, "pdfPages")}`,
    ],
  ];
}

function deliverables(names: string[]) {
  return (evidence: FixtureEvidence): DeliverableExpectation[] =>
    names.map((name) => ({
      name,
      facts: [],
      factAlternatives: reportFactAlternatives(evidence),
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
    "The report must visibly label the four results as MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES so another local process can verify them.",
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
    maxExecutions: 5,
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
    expected: () => [
      "VAULT_PROGRESS_DONE=36",
      "VAULT_PROGRESS_TOTAL=36",
      "VAULT_PROGRESS_COMPLETE=1",
    ],
    expectedTableRows: () => XLSX_PATH_LIST_ROWS,
    forbidArtifacts: true,
    maxExecutions: 5,
    requiresDirectXlsxSource: true,
  },
  {
    id: "large-corpus-continuation",
    task: reportTask("Excel", "large-corpus-report.xlsx"),
    create: async (source) => createBusinessCorpus(source, 24),
    expected: () => [],
    deliverables: deliverables(["large-corpus-report.xlsx"]),
  },
  {
    id: "invalid-document",
    task: INVALID_TASK,
    create: async (source) => {
      const content = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog";
      await writeFile(join(source, "truncated.pdf"), content, { mode: 0o600 });
      return { bytes: Buffer.byteLength(content), files: 1, expected: {} };
    },
    expected: () => ["EOF marker not found"],
    forbidArtifacts: true,
    maxExecutions: 1,
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
    maxExecutions: 0,
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
    id: "context-compaction",
    task: [
      "Use exactly one Python execution to recursively read every CSV record under /source and print one normalized line for every record, preserving its record ID, amount, and status.",
      "After that large observation fills the live evidence context, compact it automatically and finish without rerunning the program, rereading the source, or asking the user.",
      "Return COMPACTION_TOTAL=<the amount from the record whose status is COMPACTION_TARGET>.",
    ].join(" "),
    create: createCompactionCorpus,
    expected: (evidence) => [`COMPACTION_TOTAL=${expectedValue(evidence, "compactionTarget")}`],
    maxExecutions: 2,
    requiresContextCompaction: true,
  },
  {
    id: "repeated-context-compaction",
    task: [
      "Use exactly three Python executions in this order, with one source file per execution and no combined reader.",
      "Execution 1 must read only /source/stage-1.csv, execution 2 only /source/stage-2.csv, and execution 3 only /source/stage-3.csv.",
      "Every file has the exact case-sensitive CSV header ID,Amount,Status; use those exact DictReader keys.",
      "In each execution print one normalized line for every record in that file, preserving record ID, amount, and status.",
      "Execution 1 must also print STAGE_1_TOTAL=<Amount from the row whose Status equals STAGE_1_TARGET>, execution 2 STAGE_2_TOTAL=<Amount from the row whose Status equals STAGE_2_TARGET>, and execution 3 STAGE_3_TOTAL=<Amount from the row whose Status equals STAGE_3_TARGET>.",
      "Capture each target Amount during the same loop that prints the rows; a CSV reader cannot be iterated a second time.",
      "After each large observation, continue from Vault Core's compacted task and evidence ledgers without rerunning any earlier execution.",
      "After all three executions return those three exact labels from the compacted evidence ledger. No additional skill is needed; keep the skills field empty on every turn.",
    ].join(" "),
    create: createRepeatedCompactionCorpus,
    expected: (evidence) =>
      [1, 2, 3].map(
        (stage) => `STAGE_${stage}_TOTAL=${expectedValue(evidence, `stage${stage}Total`)}`,
      ),
    maxExecutions: 3,
    minimumContextCompactions: 3,
  },
  {
    id: "oversized-table-result",
    task: [
      "Search every Excel workbook in the selected folder for rows describing revenue received and return all matching rows in a nice table.",
      "Return the complete result even when it is too large for the chat response.",
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

export const SMALL_FOCUSED_REPORT_CASES: SmallCaseId[] = [
  "pdf-report",
  "excel-report",
  "large-corpus-continuation",
];
export const SMALL_SEQUENTIAL_CASES: SmallCaseId[] = CASES.map(({ id }) => id).filter(
  (id) => !SMALL_FOCUSED_REPORT_CASES.includes(id),
);
export const SMALL_CONCURRENT_CASES: SmallCaseId[] = ["xlsx-edit", "docx-edit", "pdf-merge"];
