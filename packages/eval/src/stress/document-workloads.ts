import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FixtureEvidence } from "./document-fixtures.js";

export interface DeliverableExpectation {
  facts: string[];
  name: string;
}

export interface PreparedStressCase<Id extends string = string> {
  id: Id;
  source: string;
  task: string;
  fixtureMs: number;
  evidence: FixtureEvidence;
  expectedTokens: string[];
  deliverables?: DeliverableExpectation[];
  forbidArtifacts?: boolean;
  maxExecutions?: number;
}

export interface StressCaseDefinition<Id extends string = string> {
  id: Id;
  task: string;
  create(source: string): Promise<FixtureEvidence>;
  expected(evidence: FixtureEvidence): string[];
  deliverables?(evidence: FixtureEvidence): DeliverableExpectation[];
  forbidArtifacts?: boolean;
  maxExecutions?: number;
}

function value(evidence: FixtureEvidence, name: string): number | string {
  const result = evidence.expected[name];
  if (result === undefined) throw new Error(`Missing fixture expectation ${name}.`);
  return result;
}

export const PDF_TASK = [
  "Use Python and pypdf to parse every page of every PDF under /source.",
  "Do not use file metadata as the answer.",
  "From each page containing VAULT_PDF_PAGE, parse the decimal integer immediately after the literal checksum= text.",
  "Print PDF_PAGES=<matching page count> and PDF_CHECKSUM=<sum of those parsed integers>.",
  "Do not respond until the complete hierarchy and every page have been read.",
].join(" ");

export const XLSX_TASK = [
  "Use Python and openpyxl in read-only mode to inspect every worksheet row of every .xlsx file under /source.",
  "Find VAULT_STRESS_TARGET as a case-insensitive substring in every nonempty cell.",
  "Use each worksheet's header row to locate the column named amount.",
  "Print XLSX_MATCHES=<complete match count> and XLSX_TOTAL=<sum of the numeric amount-column cell in every matching row>.",
  "Do not respond until every workbook, worksheet, and row has been read.",
].join(" ");

export const MIXED_TASK = [
  XLSX_TASK,
  "Also use python-docx to inspect every paragraph of every DOCX under /source.",
  "For each VAULT_WORD_PAGE paragraph, parse the decimal integer immediately after the literal checksum= text.",
  "Print WORD_PAGES=<matching paragraph count> and WORD_CHECKSUM=<sum of those parsed integers>.",
  "All four metrics are required before responding.",
].join(" ");

export function pdfTokens(evidence: FixtureEvidence): string[] {
  return [
    `PDF_PAGES=${value(evidence, "pdfPages")}`,
    `PDF_CHECKSUM=${value(evidence, "pdfChecksum")}`,
  ];
}

export function xlsxTokens(evidence: FixtureEvidence): string[] {
  return [
    `XLSX_MATCHES=${value(evidence, "xlsxMatches")}`,
    `XLSX_TOTAL=${value(evidence, "xlsxTotal")}`,
  ];
}

export function mixedTokens(evidence: FixtureEvidence): string[] {
  return [
    ...xlsxTokens(evidence),
    `WORD_PAGES=${value(evidence, "wordPages")}`,
    `WORD_CHECKSUM=${value(evidence, "wordChecksum")}`,
  ];
}

export async function prepareStressCase<Id extends string>(
  root: string,
  definition: StressCaseDefinition<Id>,
): Promise<PreparedStressCase<Id>> {
  const source = join(root, definition.id);
  await mkdir(source, { recursive: true });
  const startedAt = performance.now();
  const evidence = await definition.create(source);
  return {
    id: definition.id,
    source,
    task: definition.task,
    fixtureMs: Math.round(performance.now() - startedAt),
    evidence,
    expectedTokens: definition.expected(evidence),
    ...(definition.deliverables === undefined
      ? {}
      : { deliverables: definition.deliverables(evidence) }),
    ...(definition.forbidArtifacts === true ? { forbidArtifacts: true } : {}),
    ...(definition.maxExecutions === undefined ? {} : { maxExecutions: definition.maxExecutions }),
  };
}
