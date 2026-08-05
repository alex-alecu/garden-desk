import { rm } from "node:fs/promises";
import { dirname } from "node:path";
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

function verificationTask(expectations: NonNullable<PreparedStressCase["deliverables"]>): string {
  const requested = expectations.map((item, index) => `${index + 1}. ${item.name}`).join(" ");
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
): Promise<string[]> {
  const paths: string[] = [];
  for (const expected of active.fixture.deliverables ?? []) {
    const artifact = snapshot.artifacts.find((candidate) => candidate.name === expected.name);
    if (artifact === undefined) continue;
    paths.push(
      String(
        await rpc("artifacts.materialize", {
          sessionId: active.sessionId,
          artifactId: artifact.id,
        }),
      ),
    );
  }
  return paths;
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
  const session = SessionSummarySchema.parse(await rpc("sessions.create", { folderId: null }));
  try {
    for (const path of paths) await rpc("attachments.add", { sessionId: session.id, path });
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
      .map((item) => item.name);
    return { output, verified };
  } finally {
    await rpc("sessions.delete", { sessionId: session.id });
    await Promise.all(
      paths.map(async (path) => rm(dirname(path), { recursive: true, force: true })),
    );
  }
}
