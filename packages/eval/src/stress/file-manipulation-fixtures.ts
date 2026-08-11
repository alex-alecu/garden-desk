import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FixtureEvidence } from "./document-fixtures.js";
import { writeStreamingZip, type ZipEntry } from "./streaming-zip.js";

const ROOT_RELS = (target: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;
const textEntry = (name: string, value: string): ZipEntry => ({
  name,
  content: () => [value],
});

const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Audit" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`;
const XLSX_WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="00D9EAD3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const XLSX_BUDGET_SHEET = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D4"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Annual operating budget</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Quarter</t></is></c><c r="B2" t="inlineStr"><is><t>Approved</t></is></c><c r="C2" t="inlineStr"><is><t>Forecast</t></is></c><c r="D2" t="inlineStr"><is><t>Review note</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Q2</t></is></c><c r="B3" s="1"><v>125000</v></c><c r="C3" s="1"><f>B3*1.1</f><v>137500</v></c><c r="D3" t="inlineStr"><is><t>Pending</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Q3</t></is></c><c r="B4" s="1"><v>141000</v></c><c r="C4" s="1"><f>B4*1.1</f><v>155100</v></c><c r="D4" t="inlineStr"><is><t>Approved</t></is></c></row></sheetData><autoFilter ref="A2:D4"/><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells></worksheet>`;
const XLSX_AUDIT_SHEET = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Control</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Retention marker</t></is></c><c r="B2" t="inlineStr"><is><t>AUDIT_KEEP_7F4B</t></is></c></row></sheetData></worksheet>`;

export async function createEditableWorkbook(source: string): Promise<FixtureEvidence> {
  const path = join(source, "budget-model.xlsx");
  await writeStreamingZip(path, [
    textEntry("[Content_Types].xml", XLSX_CONTENT_TYPES),
    textEntry("_rels/.rels", ROOT_RELS("xl/workbook.xml")),
    textEntry("xl/workbook.xml", XLSX_WORKBOOK),
    textEntry("xl/_rels/workbook.xml.rels", XLSX_WORKBOOK_RELS),
    textEntry("xl/styles.xml", XLSX_STYLES),
    textEntry("xl/worksheets/sheet1.xml", XLSX_BUDGET_SHEET),
    textEntry("xl/worksheets/sheet2.xml", XLSX_AUDIT_SHEET),
  ]);
  return { bytes: (await stat(path)).size, files: 1, expected: {} };
}

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;
const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
const DOCX_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Risk committee brief</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Risk status: </w:t></w:r><w:r><w:t>Pending legal review</w:t></w:r></w:p><w:p><w:r><w:t>Preserve this evidence marker: BODY_KEEP_A91C</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Control</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>TABLE_KEEP_D22E</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Legal</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
const DOCX_HEADER = `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Northstar Board Pack HEADER_KEEP_18C2</w:t></w:r></w:p></w:hdr>`;
const DOCX_FOOTER = `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Confidential FOOTER_KEEP_42B7</w:t></w:r></w:p></w:ftr>`;

export async function createEditableDocument(source: string): Promise<FixtureEvidence> {
  const path = join(source, "risk-brief.docx");
  await writeStreamingZip(path, [
    textEntry("[Content_Types].xml", DOCX_CONTENT_TYPES),
    textEntry("_rels/.rels", ROOT_RELS("word/document.xml")),
    textEntry("word/document.xml", DOCX_DOCUMENT),
    textEntry("word/_rels/document.xml.rels", DOCX_RELS),
    textEntry("word/styles.xml", DOCX_STYLES),
    textEntry("word/header1.xml", DOCX_HEADER),
    textEntry("word/footer1.xml", DOCX_FOOTER),
  ]);
  return { bytes: (await stat(path)).size, files: 1, expected: {} };
}

function pdfObject(id: number, body: string): string {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function pdfObjects(markers: string[]): string[] {
  const pages = markers.map((_, index) => 4 + index * 2);
  const objects = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(
      2,
      `<< /Type /Pages /Count ${markers.length} /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ),
    pdfObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  for (let index = 0; index < markers.length; index += 1) {
    const pageId = pages[index] ?? 0;
    const stream = `BT /F1 12 Tf 72 720 Td (${markers[index]}) Tj ET`;
    objects.push(
      pdfObject(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      ),
      pdfObject(
        pageId + 1,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ),
    );
  }
  return objects;
}

async function writePdf(path: string, markers: string[]): Promise<number> {
  const objects = pdfObjects(markers);
  const file = await open(path, "wx", 0o600);
  let offset = 0;
  const offsets = [0];
  const write = async (value: string) => {
    const bytes = Buffer.from(value);
    await file.write(bytes, 0, bytes.length, offset);
    offset += bytes.length;
  };
  await write("%PDF-1.4\n%VaultDesk\n");
  for (const object of objects) {
    offsets.push(offset);
    await write(object);
  }
  const xref = offset;
  await write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const item of offsets.slice(1)) await write(`${String(item).padStart(10, "0")} 00000 n \n`);
  await write(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  await file.close();
  return offset;
}

export async function createPdfMergeInputs(source: string): Promise<FixtureEvidence> {
  const cover = await writePdf(join(source, "cover.pdf"), ["COVER_KEEP_10A4"]);
  const appendix = await writePdf(join(source, "appendix.pdf"), [
    "APPENDIX_PAGE_ONE_20B5",
    "APPENDIX_PAGE_TWO_30C6",
  ]);
  return { bytes: cover + appendix, files: 2, expected: {} };
}
