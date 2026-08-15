import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type AgentRunSnapshot, AgentRunSummarySchema, SessionSummarySchema } from "@vault/shared";
import {
  extractedArchiveText,
  extractedArtifactText,
  pdfArtifactEvidence,
} from "./artifact-text.js";
import type { PreparedStressCase } from "./document-workloads.js";

interface VerificationCase {
  fixture: PreparedStressCase;
  previousSnapshots: AgentRunSnapshot[];
  sessionId: string;
  runId: string;
  startedAt: number;
}

type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;

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
  retained: string[];
  verified: string[];
}

async function retainArtifacts(
  active: VerificationCase,
  paths: Array<{ name: string; path: string }>,
): Promise<string[]> {
  if (process.env.VAULT_STRESS_RETAIN_ARTIFACTS !== "1") return [];
  const directory = join(process.cwd(), "packages/eval/.generated/stress/artifacts", active.runId);
  await mkdir(directory, { recursive: true });
  return await Promise.all(
    paths.map(async (item, index) => {
      const destination = join(directory, `${index + 1}-${basename(item.name)}`);
      await copyFile(item.path, destination);
      return destination;
    }),
  );
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

type DeliverableExpectation = NonNullable<PreparedStressCase["deliverables"]>[number];

function missingOrderedFacts(extracted: string, facts: string[]): string[] {
  let offset = -1;
  return facts.filter((fact) => {
    const next = extracted.indexOf(fact, offset + 1);
    if (next === -1) return true;
    offset = next;
    return false;
  });
}

export function presentForbiddenPatterns(extracted: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => new RegExp(pattern, "iu").test(extracted));
}

export function missingFactAlternatives(extracted: string, groups: string[][]): string[] {
  return groups
    .filter((alternatives) => !alternatives.some((fact) => extracted.includes(fact)))
    .map((alternatives) => alternatives.join("|"));
}

export function missingVisibleLabelValues(
  extracted: string,
  groups: Array<{ label: string; values: string[] }>,
): string[] {
  return groups.flatMap(({ label, values }) => {
    const labelAt = extracted.indexOf(label);
    if (labelAt === -1) return [label];
    const nearby = extracted.slice(labelAt + label.length, labelAt + label.length + 256);
    return values.some((value) => nearby.includes(value)) ? [] : [`${label}=${values.join("|")}`];
  });
}

async function archiveMismatches(item: DeliverableExpectation, path: string): Promise<string[]> {
  if (item.archiveFacts === undefined && item.archiveForbiddenFacts === undefined) return ["", ""];
  const archive = await extractedArchiveText(path);
  return [
    (item.archiveFacts ?? []).filter((fact) => !archive.includes(fact)).join(","),
    (item.archiveForbiddenFacts ?? []).filter((fact) => archive.includes(fact)).join(","),
  ];
}

async function pdfMismatches(item: DeliverableExpectation, path: string): Promise<string[]> {
  if (item.pdfMetadata === undefined && item.pdfRotations === undefined) return ["", ""];
  const pdf = await pdfArtifactEvidence(path);
  const metadata = Object.entries(item.pdfMetadata ?? {})
    .filter(([key, value]) => pdf.metadata[key] !== value)
    .map(([key]) => key)
    .join(",");
  const rotations =
    item.pdfRotations === undefined ||
    JSON.stringify(pdf.rotations) === JSON.stringify(item.pdfRotations)
      ? ""
      : JSON.stringify(pdf.rotations);
  return [metadata, rotations];
}

async function deterministicMismatches(
  item: DeliverableExpectation,
  path: string,
): Promise<string[]> {
  const extracted = await extractedArtifactText(path);
  const [archive, archiveForbidden] = await archiveMismatches(item, path);
  const [metadata, rotations] = await pdfMismatches(item, path);
  return [
    `missing:${item.facts.filter((fact) => !extracted.includes(fact)).join(",")}`,
    `alternatives:${missingFactAlternatives(extracted, item.factAlternatives ?? []).join(",")}`,
    `labels:${missingVisibleLabelValues(extracted, item.visibleLabelValues ?? []).join(",")}`,
    `forbidden:${(item.forbiddenFacts ?? []).filter((fact) => extracted.includes(fact)).join(",")}`,
    `forbidden-patterns:${presentForbiddenPatterns(extracted, item.forbiddenPatterns ?? []).join(",")}`,
    `order:${missingOrderedFacts(extracted, item.orderedFacts ?? []).join(",")}`,
    `archive:${archive}`,
    `archive-forbidden:${archiveForbidden}`,
    `metadata:${metadata}`,
    `rotations:${rotations}`,
  ];
}

async function verifyOneDeterministically(
  item: DeliverableExpectation,
  artifact: { name: string; path: string },
  index: number,
): Promise<{ output: string; verified?: string }> {
  try {
    const mismatches = await deterministicMismatches(item, artifact.path);
    return mismatches.every((value) => value.endsWith(":"))
      ? { output: `VERIFIED_${index + 1}=${artifact.name}`, verified: artifact.name }
      : { output: `INVALID_${index + 1}=${mismatches.join(";")}` };
  } catch (error) {
    return { output: `INVALID_${index + 1}=extraction:${String(error)}` };
  }
}

async function verifyDeterministically(
  expectations: NonNullable<PreparedStressCase["deliverables"]>,
  paths: Array<{ name: string; path: string }>,
): Promise<Omit<DeliverableVerification, "retained">> {
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
  if (expectations.length === 0) return { output: "", retained: [], verified: [] };
  const paths = await materialize(rpc, active, snapshot);
  const retained = await retainArtifacts(active, paths);
  if (paths.length !== expectations.length) return { output: "", retained, verified: [] };
  if (expectations.every((item) => item.deterministic === true)) {
    try {
      return { ...(await verifyDeterministically(expectations, paths)), retained };
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
    if (result?.run.state !== "succeeded") return { output: "", retained, verified: [] };
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
    return { output, retained, verified };
  } finally {
    await rpc("sessions.delete", { sessionId: session.id });
    await Promise.all(
      paths.map(async (item) => rm(dirname(item.path), { recursive: true, force: true })),
    );
  }
}
