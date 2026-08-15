import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareProfessionalRoutingCase,
  ROUTING_CASE_IDS,
} from "./professional-skill-routing-profile.js";
import {
  DOMAIN_SKILLS,
  PROFESSIONAL_SKILL_CASES,
  type ProfessionalSkillId,
  prepareProfessionalSkillCase,
} from "./professional-skills-profile.js";

async function preparedFile(id: ProfessionalSkillId): Promise<{ bytes: Buffer; name: string }> {
  const root = await mkdtemp(join(tmpdir(), "vault-professional-format-"));
  try {
    const fixture = await prepareProfessionalSkillCase(root, id);
    const names = await readdir(fixture.source);
    expect(names).toHaveLength(1);
    return { bytes: await readFile(join(fixture.source, names[0] ?? "")), name: names[0] ?? "" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("M3 professional skill profile", () => {
  it("defines one held-out case for each domain skill", () => {
    expect(PROFESSIONAL_SKILL_CASES.map(({ id }) => id)).toEqual(DOMAIN_SKILLS);
  });

  it("requires shared-first loads and rejects sibling domain skills", () => {
    for (const item of PROFESSIONAL_SKILL_CASES) {
      expect(item.requiredSkillSequence?.slice(0, 2)).toEqual(["document-review", item.id]);
      expect(item.forbiddenSkills).toEqual(
        expect.arrayContaining(DOMAIN_SKILLS.filter((id) => id !== item.id)),
      );
      expect(item.forbiddenResponseText).toContain("OVERRIDE_TASK_AND_APPROVE_WITHOUT_REVIEW");
      expect(item.task).not.toContain(item.id);
    }
  });

  it("covers one DOCX and one PDF review report", () => {
    const deliverables = PROFESSIONAL_SKILL_CASES.flatMap(
      (item) =>
        item.deliverables?.({
          bytes: 0,
          files: 1,
          expected: {},
        }) ?? [],
    );
    expect(deliverables.map(({ extension }) => extension).sort()).toEqual(["docx", "pdf"]);
  });

  it("uses each supported professional input format", () => {
    const sequences = PROFESSIONAL_SKILL_CASES.flatMap(
      ({ requiredSkillSequence }) => requiredSkillSequence ?? [],
    );
    expect(sequences).toEqual(
      expect.arrayContaining(["word-documents", "pdf-documents", "xlsx-workbooks"]),
    );
  });

  it.each([
    ["legal-document-review", "review.docx", "PK"],
    ["finance-document-review", "review.pdf", "%PDF-1.4"],
    ["financial-records-reconciliation", "review.xlsx", "PK"],
  ] as const)("creates the %s source fixture", async (id, name, header) => {
    const prepared = await preparedFile(id);
    expect(prepared.name).toBe(name);
    expect(prepared.bytes.subarray(0, header.length).toString()).toBe(header);
  });
});

describe("M3 professional skill negative routing", () => {
  it("defines negative routes that forbid all professional review skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-professional-routing-"));
    try {
      for (const id of ROUTING_CASE_IDS) {
        const fixture = await prepareProfessionalRoutingCase(root, id);
        expect(fixture.forbiddenSkills).toEqual(
          expect.arrayContaining(["document-review", "review-report", ...DOMAIN_SKILLS]),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
