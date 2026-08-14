// biome-ignore lint/style/noRestrictedImports: isolated test fixtures use temporary directories.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

function fixture(): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "vault-markdown-definitions-"));
  for (const path of ["agents", "skills/example-skill"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(
    join(root, "agents/primary.md"),
    "---\nname: primary\ndescription: Leads a task.\nmode: primary\ntools: [read, search]\ntemperature: 0.2\nsteps: 6\n---\nPrimary body.",
  );
  writeFileSync(
    join(root, "skills/example-skill/SKILL.md"),
    "---\nname: example-skill\ndescription: Handles an example.\n---\nSkill body.",
  );
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

function expectApprovedAgents(library: MarkdownDefinitionLibrary): void {
  expect(library.agents.map(({ mode, name }) => ({ mode, name }))).toEqual([
    { mode: "subagent", name: "explore" },
    { mode: "subagent", name: "general" },
    { mode: "primary", name: "primary" },
    { mode: "subagent", name: "probe" },
  ]);
  expect(library.agent("primary")).toMatchObject({
    steps: 40,
    temperature: 0,
    tools: ["bash", "python", "node", "read", "glob", "grep", "list", "skill", "task", "question"],
  });
  expect(library.agent("primary").body).toContain(
    "first turn must contain only one `question` tool call",
  );
  expect(library.agent("explore")).toMatchObject({
    steps: 16,
    tools: ["read", "glob", "grep", "list", "skill"],
  });
  expect(library.agent("general")).toMatchObject({
    steps: 24,
    tools: ["bash", "python", "node", "read", "glob", "grep", "list", "skill"],
  });
  expect(library.agent("probe")).toMatchObject({
    steps: 16,
    tools: ["bash", "python", "node", "read", "glob", "grep", "list", "skill"],
  });
}

describe("MarkdownDefinitionLibrary", () => {
  it("loads the approved generic agent and skill catalog", () => {
    const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
    expectApprovedAgents(library);
    expect(library.skills.map(({ name }) => name)).toEqual([
      "pdf-documents",
      "terminal-commands",
      "word-documents",
      "xlsx-workbooks",
    ]);
    const word = library.skill("word-documents");
    expect(word.description).toContain("legacy .doc file");
    expect(word.body).toContain('/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0"');
    expect(word.body).toContain("Never create or edit a `.doc` file.");
    expect(() => library.skill("docx-documents")).toThrow("Unknown skill");
    expect(library.skill("xlsx-workbooks").body).toContain("reset_dimensions()");
  });

  it("catalogs validated metadata before explicitly loading a body", () => {
    const { root, remove } = fixture();
    try {
      const library = new MarkdownDefinitionLibrary(root);
      expect(library.agents).toEqual([
        expect.objectContaining({ mode: "primary", name: "primary", tools: ["read", "search"] }),
      ]);
      expect(library.skills).toEqual([
        { description: "Handles an example.", name: "example-skill" },
      ]);
      expect(library.skill("example-skill").body).toBe("Skill body.");
      expect(library.agent("primary").body).toBe("Primary body.");
    } finally {
      remove();
    }
  });

  it("rejects unknown agent metadata without loading any definition", () => {
    const { root, remove } = fixture();
    try {
      writeFileSync(
        join(root, "agents/primary.md"),
        "---\nname: primary\ndescription: Leads a task.\nmode: primary\ntools: [read]\ntemperature: 0\nsteps: 1\nobsolete: true\n---\nBody.",
      );
      expect(() => new MarkdownDefinitionLibrary(root)).toThrow("Unsupported Markdown metadata");
    } finally {
      remove();
    }
  });
});
