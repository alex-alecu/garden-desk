import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractedArchiveText,
  extractedArtifactText,
  pdfArtifactEvidence,
} from "./artifact-text.js";
import {
  createEditableDocument,
  createEditableWorkbook,
  createPdfMergeInputs,
} from "./file-manipulation-fixtures.js";

const roots: string[] = [];

async function root(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), name));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("realistic file-manipulation fixtures", () => {
  it("creates an editable workbook with formulas and preservation sentinels", async () => {
    const source = await root("vault-xlsx-edit-");
    await createEditableWorkbook(source);
    const path = join(source, "budget-model.xlsx");
    const visible = await extractedArtifactText(path);
    const archive = await extractedArchiveText(path);

    expect(visible).toContain("125000");
    expect(visible).toContain("AUDIT_KEEP_7F4B");
    expect(archive).toContain("<f>B3*1.1</f>");
    expect(archive).toContain('state="hidden"');
    expect(archive).toContain('topLeftCell="A3"');
    expect(archive).toContain('ref="A1:D1"');
  });
});

describe("realistic document fixtures", () => {
  it("creates an editable document with body, table, header, and footer sentinels", async () => {
    const source = await root("vault-docx-edit-");
    await createEditableDocument(source);
    const path = join(source, "risk-brief.docx");
    const visible = await extractedArtifactText(path);
    const archive = await extractedArchiveText(path);

    for (const fact of [
      "Pending legal review",
      "BODY_KEEP_A91C",
      "TABLE_KEEP_D22E",
      "HEADER_KEEP_18C2",
      "FOOTER_KEEP_42B7",
      "w:headerReference",
      "w:footerReference",
    ]) {
      expect(archive).toContain(fact);
    }
    for (const fact of [
      "BODY_KEEP_A91C",
      "TABLE_KEEP_D22E",
      "HEADER_KEEP_18C2",
      "FOOTER_KEEP_42B7",
    ]) {
      expect(visible).toContain(fact);
    }
  });

  it("creates ordered PDF inputs whose pages reopen independently", async () => {
    const source = await root("vault-pdf-merge-");
    await createPdfMergeInputs(source);
    const cover = await pdfArtifactEvidence(join(source, "cover.pdf"));
    const appendix = await pdfArtifactEvidence(join(source, "appendix.pdf"));

    expect(cover.pageTexts).toHaveLength(1);
    expect(cover.pageTexts[0]).toContain("COVER_KEEP_10A4");
    expect(appendix.pageTexts).toHaveLength(2);
    expect(appendix.pageTexts[0]).toContain("APPENDIX_PAGE_ONE_20B5");
    expect(appendix.pageTexts[1]).toContain("APPENDIX_PAGE_TWO_30C6");
    expect(appendix.rotations).toEqual([0, 0]);
  });
});
