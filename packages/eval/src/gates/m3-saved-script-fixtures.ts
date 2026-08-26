import type { SavedScriptRequirement } from "./m3-saved-script-evidence.js";

const pythonArtifactStatements = [
  "from pathlib import Path",
  'value = Path("/source/python-input.txt").read_text()',
  'Path("/workspace/python-result.txt").write_text(value)',
];

const nodeArtifactStatements = [
  'import { readFile, writeFile } from "node:fs/promises";',
  'const value = await readFile("/source/node-input.txt", "utf8");',
  'await writeFile("/workspace/node-result.txt", value);',
];

const windowsArtifactStatements = [
  "from pathlib import Path",
  'value = "windows-saved-repair"',
  'Path("/workspace/windows-saved-repair.txt").write_text(value)',
];

export function savedScriptRepairPrompt(requirement: SavedScriptRequirement): string {
  return [
    `Use the ${requirement.language} tool and, only when useful, bash to edit the saved file.`,
    `Run exactly three ${requirement.language} executions at ${requirement.path}.`,
    "First, execute the following exact source with that path and observe its failure:",
    requirement.brokenSource,
    `Repair the same saved path. You can edit it with bash or save this shorter replacement with ${requirement.language}:`,
    requirement.repairedSource,
    `After either repair method, use ${requirement.language} with path only until two successful executions used the same committed bytes.`,
    `Do not respond before all three executions complete. Your final response must include ${requirement.finalOutput}.`,
  ].join(" ");
}

export function macosSavedScriptRequirement(language: "python" | "node"): SavedScriptRequirement {
  const finalOutput = `${language}-saved-repair`;
  return language === "python"
    ? {
        brokenSource: [...pythonArtifactStatements, 'raise RuntimeError("repair-needed")'].join(
          "\n",
        ),
        finalOutput,
        language,
        path: "steps/python-saved-repair.py",
        repairedSource: [...pythonArtifactStatements, `print("${finalOutput}")`].join("\n"),
      }
    : {
        brokenSource: [...nodeArtifactStatements, 'throw new Error("repair-needed");'].join("\n"),
        finalOutput,
        language,
        path: "steps/node-saved-repair.mjs",
        repairedSource: [...nodeArtifactStatements, `console.log("${finalOutput}");`].join("\n"),
      };
}

export const windowsSavedScriptRequirement: SavedScriptRequirement = {
  brokenSource: [...windowsArtifactStatements, 'raise RuntimeError("repair-needed")'].join("\n"),
  finalOutput: "windows-saved-repair",
  language: "python",
  path: "steps/windows-saved-repair.py",
  repairedSource: [...windowsArtifactStatements, "print(value)"].join("\n"),
};
