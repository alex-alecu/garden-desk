import { describe, expect, it } from "vitest";
import { requiredArtifactNames } from "./artifact-completion.js";

describe("artifact requirement parsing regressions", () => {
  it.each([
    ["input after of", "Write a summary of data.csv."],
    ["dotted term in prose", "Create Node.js and Python versions of the tool."],
    ["extensionless prose", "Required deliverables: a summary of the key findings."],
  ])("does not require %s", (_name, task) => {
    expect(requiredArtifactNames(task)).toEqual([]);
  });

  it.each([
    ["quoted", 'Required deliverables: "report"'],
    ["explicit", "Required deliverables: file report"],
  ])("accepts one %s extensionless deliverable", (_name, task) => {
    expect(requiredArtifactNames(task)).toEqual(["report"]);
  });

  it.each(["pdf", "docx", "xlsx"])("accepts a named %s stress report", (extension) => {
    const name = `management-report.${extension}`;
    const task = `Create a polished report named ${name} in the private workspace.`;

    expect(requiredArtifactNames(task)).toEqual([name]);
  });
});
