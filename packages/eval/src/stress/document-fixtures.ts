import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeStreamingZip, type ZipEntry } from "./streaming-zip.js";

export const XLSX_TARGET = "VAULT_STRESS_TARGET";
export const WORD_PAGE_TARGET = "VAULT_WORD_PAGE";
export const PDF_PAGE_TARGET = "VAULT_PDF_PAGE";

export interface XlsxFixtureShape {
  files: number;
  sheets: number;
  rowsPerSheet: number;
}

export interface DocxFixtureShape {
  files: number;
  pagesPerFile: number;
}

export interface FixtureEvidence {
  bytes: number;
  files: number;
  expected: Record<string, number | string>;
}

const ROOT_RELS_XLSX = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS_DOCX = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

function textEntry(name: string, value: string): ZipEntry {
  return { name, content: () => [value] };
}

function xlsxContentTypes(sheets: number): string {
  const worksheets = Array.from(
    { length: sheets },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheets}</Types>`;
}

function workbookXml(sheets: number): string {
  const rows = Array.from(
    { length: sheets },
    (_, index) =>
      `<sheet name="Sheet ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${rows}</sheets></workbook>`;
}

function workbookRelationships(sheets: number): string {
  const rows = Array.from(
    { length: sheets },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
}

function targetAmount(workbook: number, sheet: number): number {
  return (workbook + 1) * 1_000 + sheet + 1;
}

async function* worksheetXml(
  workbook: number,
  sheet: number,
  rowsPerSheet: number,
): AsyncGenerator<string> {
  yield `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D${rowsPerSheet}"/><sheetData>`;
  yield '<row r="1"><c r="A1" t="inlineStr"><is><t>record_id</t></is></c><c r="B1" t="inlineStr"><is><t>category</t></is></c><c r="C1" t="inlineStr"><is><t>amount</t></is></c><c r="D1" t="inlineStr"><is><t>note</t></is></c></row>';
  let batch = "";
  for (let row = 2; row <= rowsPerSheet; row += 1) {
    const target = row === rowsPerSheet;
    const amount = target ? targetAmount(workbook, sheet) : row % 97;
    const note = target ? XLSX_TARGET : "ordinary";
    batch += `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>W${workbook + 1}-S${sheet + 1}-R${row}</t></is></c><c r="B${row}" t="inlineStr"><is><t>${target ? "target" : "baseline"}</t></is></c><c r="C${row}"><v>${amount}</v></c><c r="D${row}" t="inlineStr"><is><t>${note}</t></is></c></row>`;
    if (row % 1_000 === 0) {
      yield batch;
      batch = "";
    }
  }
  if (batch.length > 0) yield batch;
  yield "</sheetData></worksheet>";
}

function xlsxEntries(workbook: number, shape: XlsxFixtureShape): ZipEntry[] {
  const entries = [
    textEntry("[Content_Types].xml", xlsxContentTypes(shape.sheets)),
    textEntry("_rels/.rels", ROOT_RELS_XLSX),
    textEntry("xl/workbook.xml", workbookXml(shape.sheets)),
    textEntry("xl/_rels/workbook.xml.rels", workbookRelationships(shape.sheets)),
    textEntry("xl/styles.xml", XLSX_STYLES),
  ];
  for (let sheet = 0; sheet < shape.sheets; sheet += 1) {
    entries.push({
      name: `xl/worksheets/sheet${sheet + 1}.xml`,
      content: () => worksheetXml(workbook, sheet, shape.rowsPerSheet),
    });
  }
  return entries;
}

export async function createXlsxCorpus(
  directory: string,
  shape: XlsxFixtureShape,
): Promise<FixtureEvidence> {
  if (shape.rowsPerSheet < 2) throw new Error("XLSX fixtures require a header and data row.");
  await mkdir(directory, { recursive: true });
  let bytes = 0;
  let targetTotal = 0;
  for (let workbook = 0; workbook < shape.files; workbook += 1) {
    const path = join(directory, `workbook-${String(workbook + 1).padStart(3, "0")}.xlsx`);
    await writeStreamingZip(path, xlsxEntries(workbook, shape));
    bytes += (await stat(path)).size;
    for (let sheet = 0; sheet < shape.sheets; sheet += 1) {
      targetTotal += targetAmount(workbook, sheet);
    }
  }
  return {
    bytes,
    files: shape.files,
    expected: { xlsxMatches: shape.files * shape.sheets, xlsxTotal: targetTotal },
  };
}

async function* documentXml(document: number, pages: number): AsyncGenerator<string> {
  yield '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  for (let page = 1; page <= pages; page += 1) {
    const text = `${WORD_PAGE_TARGET} document=${document + 1} page=${page} checksum=${(document + 1) * 1_000 + page}`;
    const pageBreak = page === pages ? "" : '<w:r><w:br w:type="page"/></w:r>';
    yield `<w:p><w:r><w:t>${text}</w:t></w:r>${pageBreak}</w:p>`;
  }
  yield "<w:sectPr/></w:body></w:document>";
}

function docxEntries(document: number, pages: number): ZipEntry[] {
  return [
    textEntry("[Content_Types].xml", CONTENT_TYPES_DOCX),
    textEntry("_rels/.rels", ROOT_RELS_DOCX),
    { name: "word/document.xml", content: () => documentXml(document, pages) },
    textEntry("word/_rels/document.xml.rels", DOCX_RELS),
    textEntry("word/styles.xml", DOCX_STYLES),
  ];
}

export async function createDocxCorpus(
  directory: string,
  shape: DocxFixtureShape,
): Promise<FixtureEvidence> {
  await mkdir(directory, { recursive: true });
  let bytes = 0;
  let checksum = 0;
  for (let document = 0; document < shape.files; document += 1) {
    const path = join(directory, `document-${String(document + 1).padStart(3, "0")}.docx`);
    await writeStreamingZip(path, docxEntries(document, shape.pagesPerFile));
    bytes += (await stat(path)).size;
    for (let page = 1; page <= shape.pagesPerFile; page += 1) {
      checksum += (document + 1) * 1_000 + page;
    }
  }
  return {
    bytes,
    files: shape.files,
    expected: { wordPages: shape.files * shape.pagesPerFile, wordChecksum: checksum },
  };
}

function pdfObject(id: number, body: string): string {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function pdfObjects(pages: number): string[] {
  const pageObjects = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  const objects = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(
      2,
      `<< /Type /Pages /Count ${pages} /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ),
    pdfObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  for (let page = 1; page <= pages; page += 1) {
    const pageId = pageObjects[page - 1] ?? 0;
    const contentId = pageId + 1;
    const text = `${PDF_PAGE_TARGET} page=${page} checksum=${page * 17}`;
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      pdfObject(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
      pdfObject(
        contentId,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ),
    );
  }
  return objects;
}

async function writePdfObjects(path: string, objects: string[]): Promise<number> {
  const file = await open(path, "wx", 0o600);
  let offset = 0;
  const offsets = [0];
  const write = async (value: string) => {
    const chunk = Buffer.from(value);
    let written = 0;
    while (written < chunk.length) {
      const result = await file.write(chunk, written, chunk.length - written, offset + written);
      if (result.bytesWritten === 0) throw new Error("PDF write made no progress.");
      written += result.bytesWritten;
    }
    offset += chunk.length;
  };
  await write("%PDF-1.4\n%VaultDesk\n");
  for (const object of objects) {
    offsets.push(offset);
    await write(object);
  }
  const xrefOffset = offset;
  await write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const objectOffset of offsets.slice(1)) {
    await write(`${String(objectOffset).padStart(10, "0")} 00000 n \n`);
  }
  await write(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  await file.close();
  return offset;
}

export async function createPdf(path: string, pages: number): Promise<FixtureEvidence> {
  if (pages < 1) throw new Error("PDF fixtures require at least one page.");
  const bytes = await writePdfObjects(path, pdfObjects(pages));
  return {
    bytes,
    files: 1,
    expected: { pdfPages: pages, pdfChecksum: (pages * (pages + 1) * 17) / 2 },
  };
}
