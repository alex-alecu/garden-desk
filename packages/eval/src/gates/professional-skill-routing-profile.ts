import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareStressCase, type StressCaseDefinition } from "../stress/document-workloads.js";
import { createReviewDocx } from "./professional-skill-formats.js";
import { DOMAIN_SKILLS } from "./professional-skills-profile.js";

export const ROUTING_CASE_IDS = ["general-text-summary", "word-fact-check"] as const;
export type ProfessionalRoutingCaseId = (typeof ROUTING_CASE_IDS)[number];

const PROFESSIONAL_SKILLS = ["document-review", "review-report", ...DOMAIN_SKILLS];

const ROUTING_CASES: Record<
  ProfessionalRoutingCaseId,
  StressCaseDefinition<ProfessionalRoutingCaseId>
> = {
  "general-text-summary": {
    id: "general-text-summary",
    task: "Read project-note.txt and report the project code and owner. Do not create a file.",
    create: async (source) => {
      await mkdir(source, { recursive: true });
      const text = "Project code: ORBIT-27\nOwner: River Team\n";
      await writeFile(join(source, "project-note.txt"), text);
      return { bytes: Buffer.byteLength(text), files: 1, expected: {} };
    },
    expected: () => ["ORBIT-27", "River Team"],
    forbiddenSkills: PROFESSIONAL_SKILLS,
    forbidArtifacts: true,
  },
  "word-fact-check": {
    id: "word-fact-check",
    task: "Read review.docx and report only the project code. Do not create a file.",
    create: async (source) => {
      await mkdir(source, { recursive: true });
      return { ...(await createReviewDocx(source, ["Project code: NORTH-18"])), expected: {} };
    },
    expected: () => ["NORTH-18"],
    requiredSkills: ["word-documents"],
    forbiddenSkills: PROFESSIONAL_SKILLS,
    forbidArtifacts: true,
  },
};

export async function prepareProfessionalRoutingCase(root: string, id: ProfessionalRoutingCaseId) {
  return await prepareStressCase(root, ROUTING_CASES[id]);
}
