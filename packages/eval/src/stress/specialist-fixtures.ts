import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeStreamingZip } from "./streaming-zip.js";

export type SpecialistFiles = Record<
  string,
  string | { sheet: string; rows: (string | number)[][] }
>;
export interface SpecialistCase {
  id: string;
  agentId: string;
  command?: string;
  files: SpecialistFiles;
  addedAfterGrant?: SpecialistFiles;
  request: string;
  expected: Record<string, unknown>;
  sources: string[];
}

const relationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function officeFiles(main: string, types: Record<string, string>): Record<string, string> {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      types,
    )
      .map(
        ([name, type]) =>
          `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`,
      )
      .join("")}</Types>`,
    "_rels/.rels": `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="${main}"/></Relationships>`,
  };
}

function docx(text: string): Record<string, string> {
  return {
    ...officeFiles("word/document.xml", { "word/document.xml": "wordprocessingml.document.main" }),
    "word/document.xml": `<w:document xmlns:w="${word}"><w:body>${text
      .split("\n")
      .map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  };
}

function xlsx(value: Exclude<SpecialistFiles[string], string>): Record<string, string> {
  const rows = value.rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((cell, c) => {
            const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
            return typeof cell === "number"
              ? `<c r="${ref}"><v>${cell}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return {
    ...officeFiles("xl/workbook.xml", {
      "xl/workbook.xml": "spreadsheetml.sheet.main",
      "xl/worksheets/sheet1.xml": "spreadsheetml.worksheet",
    }),
    "xl/workbook.xml": `<workbook xmlns="${spreadsheet}" xmlns:r="${office}"><sheets><sheet name="${xml(value.sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${spreadsheet}"><sheetData>${rows}</sheetData></worksheet>`,
  };
}

function pdf(text: string): string {
  const lines = text
    .split("\n")
    .map(
      (line) =>
        `(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj 0 -18 Td`,
    )
    .join("\n");
  const stream = `BT /F1 10 Tf 40 760 Td ${lines} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = ["0000000000 65535 f \n"];
  for (const [index, body] of objects.entries()) {
    offsets.push(`${String(Buffer.byteLength(result)).padStart(10, "0")} 00000 n \n`);
    result += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const offset = Buffer.byteLength(result);
  return `${result}xref\n0 6\n${offsets.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
}

export async function prepareSpecialistFiles(root: string, files: SpecialistFiles): Promise<void> {
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    if (typeof value === "string" && !name.endsWith(".docx")) {
      await writeFile(path, name.endsWith(".pdf") ? pdf(value) : value);
      continue;
    }
    const entries = typeof value === "string" ? docx(value) : xlsx(value);
    await writeStreamingZip(
      path,
      Object.entries(entries).map(([entry, text]) => ({ name: entry, content: () => [text] })),
    );
  }
}
