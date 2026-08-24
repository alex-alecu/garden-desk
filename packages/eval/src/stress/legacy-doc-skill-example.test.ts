import { readFileSync } from "node:fs";
import type { AgentExecutionSnapshot } from "@vault/shared";
import { expect, it } from "vitest";
import { legacyDocEvidence } from "./legacy-doc-evidence.js";

function documentedSource(): string {
  const skill = readFileSync(
    new URL("../../../../prompts/skills/word-documents/SKILL.md", import.meta.url),
    "utf8",
  );
  const source = /```python\r?\n([\s\S]+?)\r?\n```/u.exec(skill)?.[1];
  if (source === undefined) throw new Error("word_skill_legacy_doc_example_missing");
  return source;
}

it("accepts the legacy DOC extraction example from the Word skill", () => {
  const execution = {
    language: "python",
    state: "completed",
    exitCode: 0,
    source: documentedSource(),
  } as AgentExecutionSnapshot;

  expect(
    legacyDocEvidence("legacy-doc-read", { executions: [execution] }, undefined),
  ).toMatchObject({
    methodValid: true,
  });
});
