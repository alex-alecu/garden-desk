import { join } from "node:path";
import {
  createDocxCorpus,
  createPdf,
  createXlsxCorpus,
  type FixtureEvidence,
  type FixtureProgress,
} from "./document-fixtures.js";
import {
  type DeliverableExpectation,
  type PreparedStressCase,
  prepareStressCase,
  type StressCaseDefinition,
} from "./document-workloads.js";

export type ScaledCaseId = "pdf-report" | "excel-report" | "cross-format-report";

interface ScaledXlsxPlan {
  files: number;
  sheets: number;
  rowsPerFile: number;
}

export const SCALED_WORKLOAD_PLAN = {
  pdfReport: { files: 1, pagesPerFile: 100 },
  excelReport: { files: 50, sheets: 10, rowsPerFile: 200_000 },
  crossFormatReport: {
    xlsx: { files: 20, sheets: 10, rowsPerFile: 500_000 },
    docx: { files: 29, pagesPerFile: 100 },
    pdf: { files: 1, pagesPerFile: 100 },
  },
  concurrentCases: ["pdf-report", "excel-report", "cross-format-report"],
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

function value(evidence: FixtureEvidence, name: string): string {
  const result = evidence.expected[name];
  if (result === undefined) throw new Error(`Missing expected fixture value: ${name}`);
  return String(result);
}

function facts(evidence: FixtureEvidence): string[] {
  return [
    ...(evidence.expected.xlsxMatches === undefined
      ? []
      : [
          `MATCHING_INVOICES=${value(evidence, "xlsxMatches")}`,
          `INVOICE_TOTAL=${value(evidence, "xlsxTotal")}`,
        ]),
    ...(evidence.expected.wordPages === undefined
      ? []
      : [`MEETING_NOTES=${value(evidence, "wordPages")}`]),
    ...(evidence.expected.pdfPages === undefined
      ? []
      : [`POLICY_PAGES=${value(evidence, "pdfPages")}`]),
  ];
}

function deliverables(names: string[]) {
  return (evidence: FixtureEvidence): DeliverableExpectation[] =>
    names.map((name) => ({ name, facts: facts(evidence), deterministic: true }));
}

function task(names: string[], sources: string, labels: string): string {
  return [
    `Review the complete selected corpus containing ${sources}.`,
    `Create the requested polished management reports in the private workspace. In each deliverable, visibly include each requested label exactly as LABEL=value, with the value derived from the selected corpus. For each requested value, count all source items with the stated marker. For a requested total, instead sum the numeric amount values of all matching records. Requested labels: ${labels}.`,
    `Required deliverables: ${names.join(", ")}.`,
  ].join(" ");
}

export const SCALED_CASES: StressCaseDefinition<ScaledCaseId>[] = [
  {
    id: "pdf-report",
    task: task(
      ["scaled-policy-report.pdf"],
      "one PDF whose policy pages start with Policy section",
      "POLICY_PAGES",
    ),
    create: async (source) =>
      createPdf(join(source, "policy-source.pdf"), SCALED_WORKLOAD_PLAN.pdfReport.pagesPerFile),
    expected: () => [],
    deliverables: deliverables(["scaled-policy-report.pdf"]),
  },
  {
    id: "excel-report",
    task: task(
      ["scaled-invoice-report.xlsx"],
      "XLSX invoice workbooks whose attention rows contain Priority review",
      "MATCHING_INVOICES and INVOICE_TOTAL",
    ),
    create: async (source) =>
      createXlsxCorpus(
        source,
        xlsxShape(SCALED_WORKLOAD_PLAN.excelReport),
        logProgress("excel-report"),
      ),
    expected: () => [],
    deliverables: deliverables(["scaled-invoice-report.xlsx"]),
  },
  {
    id: "cross-format-report",
    task: task(
      ["scaled-report.pdf", "scaled-report.docx", "scaled-report.xlsx"],
      "XLSX invoices, DOCX meeting notes, and one policy PDF; attention rows contain Priority review, meeting-note entries start Decision record, and policy pages start Policy section",
      "MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES",
    ),
    create: createCrossFormatCorpus,
    expected: () => [],
    deliverables: deliverables(["scaled-report.pdf", "scaled-report.docx", "scaled-report.xlsx"]),
  },
];

async function createCrossFormatCorpus(source: string): Promise<FixtureEvidence> {
  const plan = SCALED_WORKLOAD_PLAN.crossFormatReport;
  const xlsx = await createXlsxCorpus(
    join(source, "invoices"),
    xlsxShape(plan.xlsx),
    logProgress("cross-format-report"),
  );
  const docx = await createDocxCorpus(
    join(source, "meetings"),
    plan.docx,
    logProgress("cross-format-report"),
  );
  const pdf = await createPdf(join(source, "policy-source.pdf"), plan.pdf.pagesPerFile);
  return {
    bytes: xlsx.bytes + docx.bytes + pdf.bytes,
    files: xlsx.files + docx.files + pdf.files,
    expected: { ...xlsx.expected, ...docx.expected, ...pdf.expected },
  };
}

export async function prepareScaledCase(
  root: string,
  id: ScaledCaseId,
): Promise<PreparedStressCase<ScaledCaseId>> {
  const definition = SCALED_CASES.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown scaled stress case: ${id}`);
  return prepareStressCase(root, definition);
}

export const SCALED_SEQUENTIAL_CASES: ScaledCaseId[] = SCALED_CASES.map(({ id }) => id);
export const SCALED_CONCURRENT_CASES: ScaledCaseId[] = [...SCALED_WORKLOAD_PLAN.concurrentCases];
