import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PromptLibrary, parsePromptSkill } from "./prompt-library.js";

function library(): PromptLibrary {
  return new PromptLibrary(resolve(process.cwd(), "prompts"));
}

describe("PromptLibrary discovery", () => {
  it("loads Agent Skills-compatible metadata from the root prompt directory", () => {
    expect(library().skills.map(({ name }) => name)).toEqual([
      "pdf-reading",
      "terminal-commands",
      "xlsx-workbooks",
    ]);
  });

  it("loads terminal guidance for a source-tree location task without command-specific routing", () => {
    const prompts = library();
    const input = {
      task: "Tell me where the system prompt is in this source code folder.",
      inputNames: [],
    };
    expect([...prompts.activeSkillNames(input)]).toEqual(["terminal-commands"]);
    expect(
      prompts.activeSkills(input, {
        shell_command_character_limit: "4,096",
        shell_path: "/bin/sh",
        tool_capabilities: "find, grep",
        workspace_path: "/workspace",
      }),
    ).toContain("Confirm every executable, option, redirection, and pipeline stage");
  });
});

describe("PromptLibrary skill selection", () => {
  it("uses task and attachment evidence to disclose format skills", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({
        task: "Summarize the attachment.",
        inputNames: ["REPORT.PDF"],
      }),
    ]).toEqual(["pdf-reading", "terminal-commands"]);
    expect([
      ...prompts.activeSkillNames({
        task: "Total every salary in the workbooks.",
        inputNames: [],
      }),
    ]).toEqual(["terminal-commands", "xlsx-workbooks"]);
  });

  it("allows typed workflows to require a skill without routing on untrusted output", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({
        task: "Calculate monthly totals.",
        inputNames: [],
        requiredSkillNames: ["xlsx-workbooks"],
      }),
    ]).toEqual(["terminal-commands", "xlsx-workbooks"]);
  });

  it("keeps template-shaped runtime data literal", () => {
    expect(
      library().state("observation-elision", { omitted_characters: "{{untrusted_value}}" }),
    ).toContain("{{untrusted_value}} characters omitted");
  });

  it("rejects mismatched skill directory metadata", () => {
    expect(() =>
      parsePromptSkill(
        "terminal-commands",
        "---\nname: other-skill\ndescription: Guides a workflow. Use when needed.\n---\n# Skill",
      ),
    ).toThrow("Agent Skills contract");
  });
});
