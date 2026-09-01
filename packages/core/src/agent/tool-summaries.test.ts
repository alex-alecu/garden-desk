import type { ChatToolCall } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { subagentTitle, toolCompletedSummary, toolStartedSummary } from "./tool-summaries.js";

function call(name: string, params: Record<string, unknown>): ChatToolCall {
  return { id: "call_1", name, params };
}

describe("tool summaries", () => {
  it("renders verb-object gerund and past-tense pairs per tool", () => {
    const read = call("read", { path: "/source/data" });
    expect(toolStartedSummary(read)).toBe("Reading /source/data");
    expect(toolCompletedSummary(read, false)).toBe("Read /source/data.");

    const grep = call("grep", { pattern: "revenue", path: "/source" });
    expect(toolStartedSummary(grep)).toBe("Searching for revenue in /source");
    expect(toolCompletedSummary(grep, false)).toBe("Searched for revenue in /source.");

    expect(toolStartedSummary(call("python", { source: "print(1)" }))).toBe("Running code");
    expect(toolStartedSummary(call("node", { source: "console.log(1)" }))).toBe("Running code");
    expect(toolCompletedSummary(call("python", { source: "print(1)" }), false)).toBe("Ran code.");
    expect(toolStartedSummary(call("skill", { name: "workbooks" }))).toBe(
      "Loading workbooks skill",
    );
  });

  it("marks a failed completion", () => {
    expect(toolCompletedSummary(call("bash", { command: "ls" }), true)).toBe("Running ls failed.");
  });

  it("middle-truncates a long object so both ends stay readable", () => {
    const path = `/source/${"a".repeat(90)}/deep/name`;
    const summary = toolStartedSummary(call("read", { path }));
    expect(summary.startsWith("Reading /source/")).toBe(true);
    expect(summary).toContain("…");
    expect(summary.endsWith("name")).toBe(true);
  });

  it("uses the sub-agent description as the lane title", () => {
    expect(subagentTitle(call("task", { description: "Explore the folder" }))).toBe(
      "Explore the folder",
    );
    expect(subagentTitle(call("task", {}))).toBe("Sub-agent task");
  });
});
