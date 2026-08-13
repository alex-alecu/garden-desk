import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FixtureEvidence } from "./document-fixtures.js";
import { writeStreamingZip, type ZipEntry } from "./streaming-zip.js";

export const OVERSIZED_TABLE_PLAN = { rows: 2_000, sheetsPerWorkbook: 2, workbooks: 4 } as const;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Revenue A" sheetId="1" r:id="rId1"/><sheet name="Revenue B" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function textEntry(name: string, value: string): ZipEntry {
  return { name, content: () => [value] };
}

async function* revenueSheet(workbook: number, sheet: number): AsyncGenerator<string> {
  const rows =
    OVERSIZED_TABLE_PLAN.rows /
    OVERSIZED_TABLE_PLAN.workbooks /
    OVERSIZED_TABLE_PLAN.sheetsPerWorkbook;
  yield `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D${rows + 1}"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>record_id</t></is></c><c r="B1" t="inlineStr"><is><t>date</t></is></c><c r="C1" t="inlineStr"><is><t>amount</t></is></c><c r="D1" t="inlineStr"><is><t>note</t></is></c></row>`;
  for (let index = 0; index < rows; index += 1) {
    const serial =
      workbook * rows * OVERSIZED_TABLE_PLAN.sheetsPerWorkbook + sheet * rows + index + 1;
    const row = index + 2;
    const marker = `REVENUE_ROW_${String(serial).padStart(4, "0")}`;
    yield `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${marker}</t></is></c><c r="B${row}" t="inlineStr"><is><t>2026-${String(workbook + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}</t></is></c><c r="C${row}"><v>${serial * 7}</v></c><c r="D${row}" t="inlineStr"><is><t>Revenue received ${marker}</t></is></c></row>`;
  }
  yield "</sheetData></worksheet>";
}

function workbookEntries(workbook: number): ZipEntry[] {
  return [
    textEntry("[Content_Types].xml", CONTENT_TYPES),
    textEntry("_rels/.rels", ROOT_RELS),
    textEntry("xl/workbook.xml", WORKBOOK),
    textEntry("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
    textEntry("xl/styles.xml", STYLES),
    { name: "xl/worksheets/sheet1.xml", content: () => revenueSheet(workbook, 0) },
    { name: "xl/worksheets/sheet2.xml", content: () => revenueSheet(workbook, 1) },
  ];
}

export async function createOversizedRevenueCorpus(directory: string): Promise<FixtureEvidence> {
  let bytes = 0;
  for (let workbook = 0; workbook < OVERSIZED_TABLE_PLAN.workbooks; workbook += 1) {
    const folder = join(directory, `month-${workbook + 1}`);
    await mkdir(folder, { recursive: true });
    const path = join(folder, `revenue-${workbook + 1}.XLSX`);
    await writeStreamingZip(path, workbookEntries(workbook));
    bytes += (await stat(path)).size;
  }
  return {
    bytes,
    files: OVERSIZED_TABLE_PLAN.workbooks,
    expected: Object.fromEntries(
      Array.from({ length: OVERSIZED_TABLE_PLAN.rows }, (_, index) => [
        `revenueRow${index + 1}`,
        `REVENUE_ROW_${String(index + 1).padStart(4, "0")}`,
      ]),
    ),
  };
}
