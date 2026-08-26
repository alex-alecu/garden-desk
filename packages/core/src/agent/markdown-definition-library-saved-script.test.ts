import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

describe("saved-script prompt contracts", () => {
  it("keeps saved-script repair instructions consistent", () => {
    const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
    const primary = library.agent("primary");
    const general = library.agent("general");
    const word = library.skill("word-documents");
    expect(primary.body).toContain("For compaction, save facts/code in `/workspace/steps`");
    expect(primary.body).toContain("Optional integers: safe values clamp to range");
    expect(primary.body).toContain("wrong/nonfinite/unsafe fail");
    expect(primary.body).toContain(
      "Fix saved scripts with `edit` (unique `old`); `write` replaces a `/workspace` file",
    );
    expect(primary.body).toContain("Rerun the `steps/...` path");
    expect(primary.body).toContain("`/workspace/steps` is internal");
    expect(primary.body).toContain("Python/Node `path` is relative `steps/...`");
    expect(primary.body).not.toContain("attachments `/run/attachments`. Use absolute paths");
    expect(primary.body).not.toContain("Never retype saved code");
    expect(primary.body).not.toContain("shorter complete replacement; do not patch/repeat");
    expect(primary.body).not.toContain("run an extended `/workspace` copy");
    expect(general.body).toContain("read and edit a simple saved script");
    expect(general.body).toContain("Use a shorter complete replacement");
    expect(general.body).toContain("Save at the same path, rerun that path");
    expect(general.body).not.toContain("Do not repeat or patch the malformed program");
    expect(word.body).toContain("Repair by edit or short replacement; rerun path");
    expect(word.body).not.toContain("after syntax error use a shorter program");
  });
});
