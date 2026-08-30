// biome-ignore lint/style/noRestrictedImports: this verification test runs the real guest Python module.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isUserArtifactWorkspacePath } from "@vault/shared";
import { describe, expect, it } from "vitest";

const agentPath = fileURLToPath(
  new URL(
    "../../images/buildroot-external/package/vault-agent-init/src/vault-agent.py",
    import.meta.url,
  ),
);
const python = process.platform === "win32" ? "python" : "python3";

function nextArtifactState(successful: boolean): Record<string, string> {
  const program = `
import importlib.util
import json
import sys

if sys.platform == "win32":
    import types
    sys.modules["resource"] = types.ModuleType("resource")

spec = importlib.util.spec_from_file_location("vault_agent", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous = {"keep.txt": "keep", "report.xlsx": "old", "removed.txt": "removed"}
workspace = [
    {"kind": "file", "path": "keep.txt", "contentHash": "keep"},
    {"kind": "file", "path": "report.xlsx", "contentHash": "new"},
    {"kind": "file", "path": "created.txt", "contentHash": "created"},
]
delta = {
    "entries": [workspace[1], workspace[2]],
    "removedPaths": ["removed.txt"],
}
execution = {
    "exitCode": 0 if sys.argv[2] == "success" else 1,
    "termination": "completed",
    "artifacts": [
        {"name": "report.xlsx"},
        {"name": "created.txt"},
    ],
}
print(json.dumps(module.next_artifact_state(previous, workspace, delta, execution), sort_keys=True))
`;
  return JSON.parse(
    execFileSync(python, ["-B", "-c", program, agentPath, successful ? "success" : "failure"], {
      encoding: "utf8",
    }),
  ) as Record<string, string>;
}

function artifactLimitRecovery(): { first: string[]; second: string[] } {
  const program = `
import base64
import importlib.util
import json
import sys

if sys.platform == "win32":
    import types
    sys.modules["resource"] = types.ModuleType("resource")

spec = importlib.util.spec_from_file_location("vault_agent", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
content = base64.b64encode(b"x").decode("ascii")
workspace = [
    {"kind": "file", "path": ".vault-tools/internal.py", "contentHash": "internal", "bytesBase64": content},
    *[
        {"kind": "file", "path": f"result-{index:02}.txt", "contentHash": str(index), "bytesBase64": content}
        for index in range(17)
    ],
]
delta = {"entries": workspace, "removedPaths": []}
first = module.collect_artifacts(workspace, {})
state = module.next_artifact_state(
    {},
    workspace,
    delta,
    {"exitCode": 0, "termination": "completed", "artifacts": first},
)
second = module.collect_artifacts(workspace, state)
print(json.dumps({"first": [item["name"] for item in first], "second": [item["name"] for item in second]}))
`;
  return JSON.parse(
    execFileSync(python, ["-B", "-c", program, agentPath], { encoding: "utf8" }),
  ) as { first: string[]; second: string[] };
}

function recoveredArtifacts(): Array<{ name: string; bytesBase64: string }> {
  const program = `
import base64
import importlib.util
import json
import sys

if sys.platform == "win32":
    import types
    sys.modules["resource"] = types.ModuleType("resource")

spec = importlib.util.spec_from_file_location("vault_agent", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
content = base64.b64encode(b"same bytes").decode("ascii")
workspace = [{"kind": "file", "path": "report.txt", "contentHash": "current", "bytesBase64": content}]
delta = {"entries": workspace, "removedPaths": []}
state = module.next_artifact_state({}, workspace, delta, {"exitCode": 1, "termination": "completed"})
print(json.dumps(module.collect_artifacts(workspace, state), sort_keys=True))
`;
  return JSON.parse(
    execFileSync(python, ["-B", "-c", program, agentPath], { encoding: "utf8" }),
  ) as Array<{
    name: string;
    bytesBase64: string;
  }>;
}

function pythonArtifactPolicy(paths: string[]): boolean[] {
  const program = `
import importlib.util
import json
import sys

if sys.platform == "win32":
    import types
    sys.modules["resource"] = types.ModuleType("resource")

spec = importlib.util.spec_from_file_location("vault_agent", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps([module.is_artifact_candidate(path) for path in json.loads(sys.argv[2])]))
`;
  return JSON.parse(
    execFileSync(python, ["-B", "-c", program, agentPath, JSON.stringify(paths)], {
      encoding: "utf8",
    }),
  ) as boolean[];
}

describe("guest artifact baseline", () => {
  it("keeps the shared and guest artifact path rules equal", () => {
    const paths = [
      "report.txt",
      "steps",
      "steps/repair.py",
      ".vault-tools/run.py",
      ".vault-output/result.txt",
      "checkpoint.json",
      "nested/Checkpoints.JSON",
      "reports/checkpoint.json.tmp",
    ];
    const expected = [true, true, true, false, false, true, true, true];

    expect(paths.map(isUserArtifactWorkspacePath)).toEqual(expected);
    expect(pythonArtifactPolicy(paths)).toEqual(expected);
  });

  it("uses the complete current workspace after a successful execution", () => {
    expect(nextArtifactState(true)).toEqual({
      "created.txt": "created",
      "keep.txt": "keep",
      "report.xlsx": "new",
    });
  });

  it("makes every failed changed path eligible for a later successful execution", () => {
    expect(nextArtifactState(false)).toEqual({ "keep.txt": "keep" });
  });

  it("returns byte-identical failed output after a later successful execution", () => {
    expect(recoveredArtifacts()).toEqual([
      {
        bytesBase64: Buffer.from("same bytes").toString("base64"),
        mediaType: "application/octet-stream",
        name: "report.txt",
      },
    ]);
  });

  it("keeps a successful artifact-limit omission eligible without using slots for internals", () => {
    expect(artifactLimitRecovery()).toEqual({
      first: Array.from(
        { length: 16 },
        (_, index) => `result-${String(index).padStart(2, "0")}.txt`,
      ),
      second: ["result-16.txt"],
    });
  });
});
