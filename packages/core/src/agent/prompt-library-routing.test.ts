import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PromptLibrary } from "./prompt-library.js";

function library(): PromptLibrary {
  return new PromptLibrary(resolve(process.cwd(), "prompts"));
}

describe("PromptLibrary abbreviated document routing", () => {
  it("routes an abbreviated Word request to DOCX guidance alongside PDF", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({
        task: "Write a short story for children in word & pdf docs",
        inputNames: [],
      }),
    ]).toEqual(["docx-documents", "pdf-documents"]);
    expect([
      ...prompts.activeSkillNames({ task: "Save the notes as a word doc.", inputNames: [] }),
    ]).toEqual(["docx-documents"]);
  });

  it("marks only deliverable-producing skills in skill metadata", () => {
    const prompts = library();
    expect(prompts.deliverableSkill(new Set(["docx-documents"]))?.name).toBe("docx-documents");
    expect(prompts.deliverableSkill(new Set(["pdf-documents"]))?.name).toBe("pdf-documents");
    expect(prompts.deliverableSkill(new Set(["terminal-commands"]))).toBeUndefined();
  });
});

describe("PromptLibrary extension routing precision", () => {
  it.each(["report.pdfs", "report.pdfx", "report.pdf_backup", "report.docxx", "report.xlsxx"])(
    "does not route partial document extension %s",
    (name) => {
      expect([...library().activeSkillNames({ task: `Review ${name}.`, inputNames: [] })]).toEqual(
        [],
      );
    },
  );
});
