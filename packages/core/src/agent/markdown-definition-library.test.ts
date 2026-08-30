import { resolve } from "node:path";
import { expect, it } from "vitest";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

it("sets the supported locale for legacy DOC extraction", () => {
  const skill = new MarkdownDefinitionLibrary(resolve("prompts")).skill("word-documents");

  expect(skill.body).toContain("LANG=C LC_ALL=C LC_CTYPE=C antiword -m UTF-8.txt -w 0 <path>");
});
