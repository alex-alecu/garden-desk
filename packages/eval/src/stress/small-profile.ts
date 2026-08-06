import { writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { createFilteredRowsXlsxCorpus } from "./xlsx-row-filter-fixture.js";

export type SmallCaseId =
  | "pdf-report"
  | "word-report"
  | "excel-report"
  | "excel-row-filter"
  | "cross-format-report"
  | "large-corpus-continuation"
  | "invalid-document"
  | "romanian-task"
  | "no-skill-direct"
  | "terminal-discovery";

function expectedValue(evidence: FixtureEvidence, name: string): string {
  const value = evidence.expected[name];
  if (value === undefined) throw new Error(`Missing expected fixture value: ${name}`);
  return String(value);
}

function reportFacts(evidence: FixtureEvidence): string[] {
  return [
    `MATCHING_INVOICES=${expectedValue(evidence, "xlsxMatches")}`,
    `INVOICE_TOTAL=${expectedValue(evidence, "xlsxTotal")}`,
    `MEETING_NOTES=${expectedValue(evidence, "wordPages")}`,
    `POLICY_PAGES=${expectedValue(evidence, "pdfPages")}`,
  ];
}

function deliverables(names: string[]) {
  return (evidence: FixtureEvidence): DeliverableExpectation[] =>
    names.map((name) => ({ name, facts: reportFacts(evidence) }));
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
    id: "cross-format-report",
    task: [
      ...REPORT_SOURCE,
      "Create matching management-report.pdf, management-report.docx, and management-report.xlsx deliverables in the private workspace.",
      "Each report must visibly label the four results as MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES.",
    ].join(" "),
    create: createBusinessCorpus,
    expected: () => [],
    deliverables: deliverables([
      "management-report.pdf",
      "management-report.docx",
      "management-report.xlsx",
    ]),
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
];

export async function prepareSmallCase(
  root: string,
  id: SmallCaseId,
): Promise<PreparedStressCase<SmallCaseId>> {
  const definition = CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown small stress case: ${id}`);
  return prepareStressCase(root, definition);
}

export const SMALL_SEQUENTIAL_CASES: SmallCaseId[] = CASES.map(({ id }) => id);
export const SMALL_CONCURRENT_CASES: SmallCaseId[] = ["pdf-report", "word-report", "excel-report"];
