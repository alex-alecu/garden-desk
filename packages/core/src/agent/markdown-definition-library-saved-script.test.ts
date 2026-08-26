import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

describe("saved-script prompt contracts", () => {
  it("keeps saved-script repair instructions consistent", () => {
    const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
    const primary = library.agent("primary");
    const general = library.agent("general");
    const word = library.skill("word-documents");
    expect(primary.body).toContain(
      "save intermediate facts and reusable Python/Node with source + `steps/...` under `/workspace/steps/`",
    );
    expect(primary.body).toContain("Optional integers: safe values clamp to range");
    expect(primary.body).toContain("wrong/nonfinite/unsafe fail");
    expect(primary.body).toContain("read/edit a saved script");
    expect(primary.body).toContain(
      "small or shell editing is risky, use shorter complete replacement",
    );
    expect(primary.body).toContain("Save at same path; rerun path only");
    expect(primary.body).toContain("`/workspace/steps` is internal, not an artifact");
    expect(primary.body).toContain("A Python/Node `path` field is relative and uses `steps/...`");
    expect(primary.body).not.toContain("attachments `/run/attachments`. Use absolute paths");
    expect(primary.body).not.toContain("Never retype saved code");
    expect(primary.body).not.toContain("shorter complete replacement; do not patch/repeat");
    expect(primary.body).not.toContain("run an extended `/workspace` copy");
    expect(general.body).toContain("read and edit a simple saved script");
    expect(general.body).toContain("Use a shorter complete replacement");
    expect(general.body).toContain("Save at the same path, rerun that path");
    expect(general.body).not.toContain("Do not repeat or patch the malformed program");
    expect(word.body).toContain("Repair: edit or short replacement; rerun script path");
    expect(word.body).not.toContain("after syntax error use a shorter program");
  });
});
