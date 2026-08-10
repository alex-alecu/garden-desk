import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FixtureEvidence } from "./document-fixtures.js";
import type { ExpectedTableRow } from "./document-workloads.js";
import { writeStreamingZip, type ZipEntry } from "./streaming-zip.js";

export const XLSX_PATH_LIST_TASK =
  "Search all excel files in current folder for revenue that came into the business and return the results in a nice table here";

export const XLSX_PATH_LIST_MONTHS = [
  "01_Ianuarie",
  "02_Februarie",
  "03_Martie",
  "04_Aprilie",
  "05_Mai",
  "06_Iunie",
  "07_Iulie",
  "08_August",
  "09_Septembrie",
  "10_Octombrie",
  "11_Noiembrie",
  "12_Decembrie",
] as const;

export const XLSX_PATH_LIST_ACCOUNTS = ["71028463", "82139574", "93240685"] as const;

export function xlsxPathListFileName(account: string): string {
  return `SYNTHACC_${account}.XLSX`;
}

export const XLSX_PATH_LIST_ROWS: ExpectedTableRow[] = XLSX_PATH_LIST_MONTHS.flatMap((_, month) =>
  XLSX_PATH_LIST_ACCOUNTS.map((_, account) => ({
    marker: `SYNTH_REVENUE_M${String(month + 1).padStart(2, "0")}_A${account + 1}`,
    amount: 10_000 + (month + 1) * 100 + account + 1,
  })),
);

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const HEADER = ["date", "marker", "cash_flow", "category", "description", "amount"];

function textCell(column: string, row: number, value: string): string {
  return `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function rowXml(month: number, account: number): string {
  const expected = XLSX_PATH_LIST_ROWS[month * XLSX_PATH_LIST_ACCOUNTS.length + account];
  if (expected === undefined) throw new Error("Missing XLSX path-list fixture row.");
  const date = `2026-${String(month + 1).padStart(2, "0")}-15`;
  const income = [
    textCell("A", 2, date),
    textCell("B", 2, expected.marker),
    textCell("C", 2, "incoming"),
    textCell("D", 2, "business revenue"),
    textCell("E", 2, "customer payment received"),
    `<c r="F2"><v>${expected.amount}</v></c>`,
  ].join("");
  const outgoing = [
    textCell("A", 3, date),
    textCell("B", 3, `SYNTH_EXPENSE_M${String(month + 1).padStart(2, "0")}_A${account + 1}`),
    textCell("C", 3, "outgoing"),
    textCell("D", 3, "office expense"),
    textCell("E", 3, "supplier payment sent"),
    `<c r="F3"><v>-${500 + month * 10 + account}</v></c>`,
  ].join("");
  return `<row r="2">${income}</row><row r="3">${outgoing}</row>`;
}

function worksheetXml(month: number, account: number): string {
  const header = HEADER.map((value, index) =>
    textCell(String.fromCharCode("A".charCodeAt(0) + index), 1, value),
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F3"/><sheetData><row r="1">${header}</row>${rowXml(month, account)}</sheetData></worksheet>`;
}

function workbookEntries(month: number, account: number): ZipEntry[] {
  const textEntry = (name: string, value: string): ZipEntry => ({
    name,
    content: () => [value],
  });
  return [
    textEntry("[Content_Types].xml", CONTENT_TYPES),
    textEntry("_rels/.rels", ROOT_RELS),
    textEntry("xl/workbook.xml", WORKBOOK),
    textEntry("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
    textEntry("xl/styles.xml", STYLES),
    textEntry("xl/worksheets/sheet1.xml", worksheetXml(month, account)),
  ];
}

export async function createXlsxPathListCorpus(directory: string): Promise<FixtureEvidence> {
  let bytes = 0;
  for (let month = 0; month < XLSX_PATH_LIST_MONTHS.length; month += 1) {
    const monthDirectory = join(directory, XLSX_PATH_LIST_MONTHS[month] ?? "");
    await mkdir(monthDirectory, { recursive: true });
    for (let account = 0; account < XLSX_PATH_LIST_ACCOUNTS.length; account += 1) {
      const identifier = XLSX_PATH_LIST_ACCOUNTS[account] ?? "";
      const path = join(monthDirectory, xlsxPathListFileName(identifier));
      await writeStreamingZip(path, workbookEntries(month, account));
      bytes += (await stat(path)).size;
    }
  }
  return {
    bytes,
    files: XLSX_PATH_LIST_ROWS.length,
    expected: Object.fromEntries(
      XLSX_PATH_LIST_ROWS.flatMap((row, index) => [
        [`pathListMarker${index + 1}`, row.marker],
        [`pathListAmount${index + 1}`, row.amount],
      ]),
    ),
  };
}
