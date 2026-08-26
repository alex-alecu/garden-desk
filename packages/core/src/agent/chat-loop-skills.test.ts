import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

function skillNames(request: Parameters<InferenceService["chat"]>[0] | undefined): string[] {
  const skill = request?.tools.find((item) => item.name === "skill");
  if (skill === undefined) return [];
  const properties = skill.params.properties as Record<string, { enum?: string[] }>;
  return properties.name?.enum ?? [];
}

const unusedExecutor = {
  async execute() {
    throw new Error("unused");
  },
};
const inspectionExecutor = {
  async execute(run: Parameters<typeof source>[0]) {
    return execution(source(run));
  },
  async inspect(run: Parameters<typeof source>[0]) {
    return execution(source(run));
  },
};
const documentSkills = {
  metadata: () => [{ name: "documents-a", description: "Handles documents." }],
  read: () => "Skill body.",
};
const professionalLibrary = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
const professionalSkills = {
  metadata: () => [...professionalLibrary.skills],
  read: (name: string) => professionalLibrary.skill(name).body,
};

describe("ChatAgentLoop duplicate skill state", () => {
  it("loads one skill body once and handles a same-turn duplicate without failure", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const reads: string[] = [];
    const events: string[] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [
            tool("skill", "skill-1", { name: "documents-a" }),
            tool("skill", "skill-2", { name: "documents-a" }),
          ]),
          generated("Done."),
        ],
        requests,
      ),
    );

    const result = await loop.run(
      input(unusedExecutor, ["skill"], {
        onEvent: (_type, summary) => events.push(summary),
        skills: {
          metadata: () => [{ name: "documents-a", description: "Handles documents." }],
          read(name) {
            reads.push(name);
            return "Skill body.";
          },
        },
      }),
    );

    expect(result.response).toBe("Done.");
    expect(reads).toEqual(["documents-a"]);
    expect(requests[1]?.tools.some((item) => item.name === "skill")).toBe(false);
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "skill-2",
          result: expect.stringContaining("already loaded"),
        }),
      ]),
    );
    expect(events).toContain("documents-a skill was already loaded.");
  });
});

describe("ChatAgentLoop repeated loaded skills", () => {
  it("stops repeated stale calls without removing earlier context", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const reads: string[] = [];
    const events: string[] = [];
    const skillTurn = (id: string) => generated("", [tool("skill", id, { name: "documents-a" })]);
    const loop = new ChatAgentLoop(
      model(
        [
          skillTurn("skill-1"),
          skillTurn("skill-2"),
          skillTurn("skill-3"),
          skillTurn("skill-4"),
          skillTurn("skill-5"),
          generated("Done."),
        ],
        requests,
      ),
    );

    const result = await loop.run(
      input(unusedExecutor, ["skill"], {
        onEvent: (_type, summary) => events.push(summary),
        skills: {
          metadata: documentSkills.metadata,
          read(name) {
            reads.push(name);
            return "Skill body.";
          },
        },
      }),
    );

    expect(result.response).toBe("Done.");
    expect(reads).toEqual(["documents-a"]);
    expect(events.filter((item) => item === "documents-a skill was already loaded.")).toHaveLength(
      1,
    );
    expect(events.filter((item) => item === "Loading documents-a skill failed.")).toHaveLength(3);
    expect(events).not.toContain("Backtracking to the last working step.");
  });
});

describe("ChatAgentLoop available skills", () => {
  it("keeps other skill names available after a load", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [generated("", [tool("skill", "skill-1", { name: "documents-a" })]), generated("Done.")],
        requests,
      ),
    );

    await loop.run(
      input(unusedExecutor, ["skill"], {
        skills: {
          metadata: () => [
            { name: "documents-a", description: "Handles A." },
            { name: "documents-b", description: "Handles B." },
          ],
          read: () => "Skill body.",
        },
      }),
    );

    expect(skillNames(requests[0])).toEqual(["documents-a", "documents-b"]);
    expect(skillNames(requests[1])).toEqual(["documents-b"]);
  });
});

describe("ChatAgentLoop compacted skills", () => {
  it("makes document-review available after compaction removes its body", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [tool("skill", "skill-1", { name: "document-review" })]),
          generated("", [tool("list", "list-1", { path: "/source" })]),
          generated("", [tool("glob", "glob-1", { path: "/source", pattern: "*" })], 6_554),
          generated("The earlier skill was loaded."),
          generated("Done."),
        ],
        requests,
      ),
    );

    await loop.run(
      input(inspectionExecutor, ["skill", "list", "glob"], {
        skills: professionalSkills,
      }),
    );

    expect(skillNames(requests[1])).not.toContain("document-review");
    expect(requests[3]?.tools).toEqual([]);
    expect(skillNames(requests[4])).toContain("document-review");
  });
});

describe("ChatAgentLoop inference recovery skills", () => {
  it("rebuilds the skill schema after inference recovery compacts out a body", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const results = [
      generated("", [tool("skill", "skill-1", { name: "documents-a" })]),
      generated("", [tool("list", "list-1", { path: "/source" })]),
      generated("", [tool("glob", "glob-1", { path: "/source", pattern: "*" })]),
      generated("Keep only the recent file inspection."),
      generated("Done."),
    ];
    let call = 0;
    const loop = new ChatAgentLoop({
      async chat(request) {
        requests.push(structuredClone(request));
        call += 1;
        if (call === 4) throw new InferenceFailure("worker_crash", "Worker stopped.");
        const result = results.shift();
        if (result === undefined) throw new Error("Missing chat result.");
        return result;
      },
    });

    await loop.run(
      input(inspectionExecutor, ["skill", "list", "glob"], { skills: documentSkills }),
    );

    expect(requests[3]?.tools.some((item) => item.name === "skill")).toBe(false);
    expect(requests[4]?.tools).toEqual([]);
    expect(skillNames(requests[5])).toEqual(["documents-a"]);
    expect(requests[5]?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", toolCallId: "skill-1" })]),
    );
  });
});
