import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeStreamingZip, type ZipEntry } from "../stress/streaming-zip.js";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textEntry(name: string, value: string): ZipEntry {
  return { name, content: () => [value] };
}

const ROOT_RELS = (target: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;

export async function createReviewDocx(
  source: string,
  lines: string[],
): Promise<{ bytes: number; files: number }> {
  const path = join(source, "review.docx");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("");
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
  await writeStreamingZip(path, [
    textEntry("[Content_Types].xml", contentTypes),
    textEntry("_rels/.rels", ROOT_RELS("word/document.xml")),
    textEntry("word/document.xml", document),
  ]);
  return { bytes: (await stat(path)).size, files: 1 };
}

export async function createReviewXlsx(
  source: string,
  lines: string[],
): Promise<{ bytes: number; files: number }> {
  const path = join(source, "review.xlsx");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Review" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rows = lines
    .map(
      (line, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${xml(line)}</t></is></c></row>`,
    )
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  await writeStreamingZip(path, [
    textEntry("[Content_Types].xml", contentTypes),
    textEntry("_rels/.rels", ROOT_RELS("xl/workbook.xml")),
    textEntry("xl/workbook.xml", workbook),
    textEntry("xl/_rels/workbook.xml.rels", workbookRels),
    textEntry("xl/worksheets/sheet1.xml", worksheet),
  ]);
  return { bytes: (await stat(path)).size, files: 1 };
}

function pdfObject(id: number, body: string): string {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function pdfText(lines: string[]): string {
  return lines
    .map((line, index) => {
      const escaped = line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
      return `BT /F1 10 Tf 54 ${740 - index * 20} Td (${escaped}) Tj ET`;
    })
    .join("\n");
}

export async function createReviewPdf(
  source: string,
  lines: string[],
): Promise<{ bytes: number; files: number }> {
  const path = join(source, "review.pdf");
  const stream = pdfText(lines);
  const objects = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(2, "<< /Type /Pages /Count 1 /Kids [4 0 R] >>"),
    pdfObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    pdfObject(
      4,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    ),
    pdfObject(5, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
  ];
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
  return { bytes: offset, files: 1 };
}
