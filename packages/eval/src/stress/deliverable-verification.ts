import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { type AgentRunSnapshot, AgentRunSummarySchema, SessionSummarySchema } from "@vault/shared";
import type { PreparedStressCase } from "./document-workloads.js";

interface VerificationCase {
  fixture: PreparedStressCase;
  previousSnapshots: AgentRunSnapshot[];
  sessionId: string;
  runId: string;
  startedAt: number;
}

type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const execFileAsync = promisify(execFile);
const wheelRoot = join(
  process.cwd(),
  "packages/workers/images/.generated/downloads/vault-python-libraries",
);
const typingExtensionsSource = join(
  process.cwd(),
  "packages/workers/images/.generated/downloads/python-typing-extensions/typing_extensions-4.15.0.tar.gz",
);

async function extractedWorkbookText(path: string): Promise<string> {
  const script = [
    "from openpyxl import load_workbook",
    "import sys",
    "workbook = load_workbook(sys.argv[1], read_only=True, data_only=True)",
    "print('\\n'.join('='.join(str(value) for value in row if value is not None) for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True)))",
  ].join("\n");
  return (
    await execFileAsync("/usr/bin/python3", ["-c", script, path], {
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH: [
          join(wheelRoot, "openpyxl-3.1.5-py2.py3-none-any.whl"),
          join(wheelRoot, "et_xmlfile-2.0.0-py3-none-any.whl"),
        ].join(":"),
      },
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
}

async function extractedArtifactText(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (extension === ".xlsx") return extractedWorkbookText(path);
  if (extension === ".pdf") {
    const script = [
      "from pathlib import Path",
      "from types import ModuleType",
      "import sys, tarfile",
      "archive = tarfile.open(sys.argv[2])",
      "member = next(item for item in archive.getmembers() if item.name.endswith('/src/typing_extensions.py'))",
      "module = ModuleType('typing_extensions')",
      "exec(compile(archive.extractfile(member).read(), member.name, 'exec'), module.__dict__)",
      "sys.modules['typing_extensions'] = module",
      "from pypdf import PdfReader",
      "print('\\n'.join((page.extract_text() or '') for page in PdfReader(Path(sys.argv[1])).pages))",
    ].join("\n");
    const extracted = await execFileAsync(
      "/usr/bin/python3",
      ["-c", script, path, typingExtensionsSource],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: join(wheelRoot, "pypdf-6.14.2-py3-none-any.whl"),
        },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return extracted.stdout;
  }
  return (
    await execFileAsync("/usr/bin/unzip", ["-p", path], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
}

function expectationLabel(item: NonNullable<PreparedStressCase["deliverables"]>[number]): string {
  return item.name ?? `one ${item.extension ?? "deliverable"} artifact`;
}

function verificationTask(expectations: NonNullable<PreparedStressCase["deliverables"]>): string {
  const requested = expectations
    .map((item, index) => `${index + 1}. ${expectationLabel(item)}`)
    .join(" ");
  return [
    "Independently reopen every attached deliverable with the appropriate local document library.",
    "Extract visible text and cell values from the real artifact bytes, never from filenames.",
    `For each artifact print one line named VERIFIED_<number> containing all visible uppercase label=value facts found in that artifact: ${requested}`,
    "Do not create or edit files.",
  ].join(" ");
}

function verifiedFactLine(output: string, index: number): string | undefined {
  return output.split(/\r?\n/u).find((line) => line.includes(`VERIFIED_${index + 1}=`));
}

export interface DeliverableVerification {
  output: string;
  verified: string[];
}

async function materialize(
  rpc: Rpc,
  active: VerificationCase,
  snapshot: AgentRunSnapshot,
): Promise<Array<{ name: string; path: string }>> {
  const paths: Array<{ name: string; path: string }> = [];
  for (const expected of active.fixture.deliverables ?? []) {
    const matches = snapshot.artifacts.filter(
      (candidate) =>
        (expected.name !== undefined && candidate.name === expected.name) ||
        (expected.extension !== undefined &&
          candidate.name.toLowerCase().endsWith(expected.extension)),
    );
    const artifact = matches.length === 1 ? matches[0] : undefined;
    if (artifact === undefined) continue;
    paths.push({
      name: artifact.name,
      path: String(
        await rpc("artifacts.materialize", {
          sessionId: active.sessionId,
          artifactId: artifact.id,
        }),
      ),
    });
  }
  return paths;
}

async function verifyOneDeterministically(
  item: NonNullable<PreparedStressCase["deliverables"]>[number],
  artifact: { name: string; path: string },
  index: number,
): Promise<{ output: string; verified?: string }> {
  try {
    const extracted = await extractedArtifactText(artifact.path);
    const missing = item.facts.filter((fact) => !extracted.includes(fact));
    const forbidden = (item.forbiddenFacts ?? []).filter((fact) => extracted.includes(fact));
    return missing.length === 0 && forbidden.length === 0
      ? { output: `VERIFIED_${index + 1}=${artifact.name}`, verified: artifact.name }
      : {
          output: `INVALID_${index + 1}=missing:${missing.join(",")};forbidden:${forbidden.join(",")}`,
        };
  } catch (error) {
    return { output: `INVALID_${index + 1}=extraction:${String(error)}` };
  }
}

async function verifyDeterministically(
  expectations: NonNullable<PreparedStressCase["deliverables"]>,
  paths: Array<{ name: string; path: string }>,
): Promise<DeliverableVerification> {
  const results = await Promise.all(
    expectations.map(async (item, index) => {
      const artifact = paths[index];
      return artifact === undefined ? undefined : verifyOneDeterministically(item, artifact, index);
    }),
  );
  return {
    output: results.flatMap((result) => result?.output ?? []).join("\n"),
    verified: results.flatMap((result) => result?.verified ?? []),
  };
}

export async function verifyDeliverables(
  rpc: Rpc,
  active: VerificationCase,
  snapshot: AgentRunSnapshot,
  awaitRun: (item: VerificationCase) => Promise<AgentRunSnapshot | undefined>,
): Promise<DeliverableVerification> {
  const expectations = active.fixture.deliverables ?? [];
  if (expectations.length === 0) return { output: "", verified: [] };
  const paths = await materialize(rpc, active, snapshot);
  if (paths.length !== expectations.length) return { output: "", verified: [] };
  if (expectations.every((item) => item.deterministic === true)) {
    try {
      return await verifyDeterministically(expectations, paths);
    } finally {
      await Promise.all(
        paths.map(async (item) => rm(dirname(item.path), { recursive: true, force: true })),
      );
    }
  }
  const session = SessionSummarySchema.parse(await rpc("sessions.create", { folderId: null }));
  try {
    for (const item of paths)
      await rpc("attachments.add", { sessionId: session.id, path: item.path });
    const run = AgentRunSummarySchema.parse(
      await rpc("agent.start", { sessionId: session.id, task: verificationTask(expectations) }),
    );
    const result = await awaitRun({
      ...active,
      previousSnapshots: [],
      sessionId: session.id,
      runId: run.id,
      startedAt: performance.now(),
    });
    if (result?.run.state !== "succeeded") return { output: "", verified: [] };
    const output = [
      result.run.response ?? "",
      ...result.executions.map((item) => item.stdout),
    ].join("\n");
    const verified = expectations
      .filter((item, index) => {
        const line = verifiedFactLine(output, index);
        return line !== undefined && item.facts.every((fact) => line.includes(fact));
      })
      .map((item, index) => item.name ?? paths[index]?.name)
      .filter((name): name is string => name !== undefined);
    return { output, verified };
  } finally {
    await rpc("sessions.delete", { sessionId: session.id });
    await Promise.all(
      paths.map(async (item) => rm(dirname(item.path), { recursive: true, force: true })),
    );
  }
}
