import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FixtureEvidence } from "./document-fixtures.js";
import { writeStreamingZip, type ZipEntry } from "./streaming-zip.js";

export const XLSX_ROW_FILTER_PLAN = { files: 10, rowsPerFile: 100, subfolders: 10 } as const;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet 1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const HEADER =
  '<row r="1"><c r="A1" t="inlineStr"><is><t>transaction_date</t></is></c><c r="B1" t="inlineStr"><is><t>posting_date</t></is></c><c r="C1" t="inlineStr"><is><t>amount</t></is></c><c r="D1" t="inlineStr"><is><t>status</t></is></c><c r="E1" t="inlineStr"><is><t>sequence</t></is></c><c r="F1" t="inlineStr"><is><t>beneficiary</t></is></c><c r="G1" t="inlineStr"><is><t>bank</t></is></c><c r="H1" t="inlineStr"><is><t>iban</t></is></c><c r="I1" t="inlineStr"><is><t>note</t></is></c></row>';

function textEntry(name: string, value: string): ZipEntry {
  return { name, content: () => [value] };
}

async function* worksheetXml(workbook: number): AsyncGenerator<string> {
  yield `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${XLSX_ROW_FILTER_PLAN.rowsPerFile}"/><sheetData>${HEADER}`;
  for (let dataRow = 1; dataRow < XLSX_ROW_FILTER_PLAN.rowsPerFile; dataRow += 1) {
    const row = dataRow + 1;
    const target = dataRow === XLSX_ROW_FILTER_PLAN.rowsPerFile - 1;
    const amount = target ? (workbook + 1) * 1_000 : dataRow * 3;
    const note = target
      ? `OPIB/1 |avans trezoerie FILTER_ROW_${String(workbook + 1).padStart(2, "0")}=${amount}`
      : "ordinary transfer";
    yield `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>2026-08-${String(workbook + 1).padStart(2, "0")}</t></is></c><c r="B${row}" t="inlineStr"><is><t>2026-08-${String(workbook + 1).padStart(2, "0")}</t></is></c><c r="C${row}"><v>${amount}</v></c><c r="D${row}" t="inlineStr"><is><t>${target ? "target" : "posted"}</t></is></c><c r="E${row}"><v>${dataRow}</v></c><c r="F${row}" t="inlineStr"><is><t>Alecu Marian</t></is></c><c r="G${row}" t="inlineStr"><is><t>RAIFFEISEN BANK S.A.</t></is></c><c r="H${row}" t="inlineStr"><is><t>RO52RZBR0000060016391487</t></is></c><c r="I${row}" t="inlineStr"><is><t>${note}</t></is></c></row>`;
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
    { name: "xl/worksheets/sheet1.xml", content: () => worksheetXml(workbook) },
  ];
}

export async function createFilteredRowsXlsxCorpus(directory: string): Promise<FixtureEvidence> {
  let bytes = 0;
  for (let workbook = 0; workbook < XLSX_ROW_FILTER_PLAN.files; workbook += 1) {
    const subfolder = join(directory, `month-${String(workbook + 1).padStart(2, "0")}`);
    await mkdir(subfolder, { recursive: true });
    const path = join(subfolder, `transactions-${String(workbook + 1).padStart(2, "0")}.XLSX`);
    await writeStreamingZip(path, workbookEntries(workbook));
    bytes += (await stat(path)).size;
  }
  return {
    bytes,
    files: XLSX_ROW_FILTER_PLAN.files,
    expected: Object.fromEntries(
      Array.from({ length: XLSX_ROW_FILTER_PLAN.files }, (_, index) => [
        `filterRow${index + 1}`,
        `FILTER_ROW_${String(index + 1).padStart(2, "0")}=${(index + 1) * 1_000}`,
      ]),
    ),
  };
}
