import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractedArtifactText } from "./artifact-text.js";

const temporaryRoots: string[] = [];
const squareContent = "BT\n/F1 24 Tf\n72 720 Td\n<0001> Tj\nET";
const squareCmap = [
  "/CIDInit /ProcSet findresource begin",
  "12 dict begin",
  "begincmap",
  "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def",
  "/CMapName /Adobe-Identity-UCS def",
  "/CMapType 2 def",
  "1 begincodespacerange",
  "<0000> <FFFF>",
  "endcodespacerange",
  "1 beginbfchar",
  "<0001> <25A0>",
  "endbfchar",
  "endcmap",
  "CMapName currentdict /CMap defineresource pop",
  "end",
  "end",
].join("\n");

function pdfWithSquare(): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(squareContent)} >>\nstream\n${squareContent}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Identity-H /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n",
    "6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Identity-H /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>\nendobj\n",
    `7 0 obj\n<< /Length ${Buffer.byteLength(squareCmap)} >>\nstream\n${squareCmap}\nendstream\nendobj\n`,
  ];
  const header = "%PDF-1.4\n";
  let offset = Buffer.byteLength(header);
  const offsets = objects.map((object) => {
    const start = offset;
    offset += Buffer.byteLength(object);
    return start;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((start) => `${String(start).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
  ].join("\n");
  return Buffer.from(`${header}${objects.join("")}${xref}`, "utf8");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe.runIf(process.platform === "win32")("Windows PDF artifact extraction", () => {
  it("returns U+25A0 as UTF-8 instead of failing extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-pdf-utf8-"));
    temporaryRoots.push(root);
    const path = join(root, "square.pdf");
    await writeFile(path, pdfWithSquare());

    await expect(extractedArtifactText(path)).resolves.toContain("■");
  });
});
