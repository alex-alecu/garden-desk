import { rm } from "node:fs/promises";
import type { PreparedStressCase } from "./document-workloads.js";
import {
  awaitCases,
  cleanupCase,
  collectEvidence,
  type StressRunEvidence,
  startCase,
} from "./m3-stress-runtime.js";

type PrepareCase<Id extends string> = (root: string, id: Id) => Promise<PreparedStressCase<Id>>;

interface SuiteOptions<Id extends string> {
  endpoint: string;
  fixtureRoot: string;
  ids: Id[];
  prepare: PrepareCase<Id>;
  deadlineMs: number;
  removeFixtures?: boolean;
}

async function removeFixture(fixture: PreparedStressCase, enabled: boolean): Promise<void> {
  if (enabled) await rm(fixture.source, { recursive: true, force: true });
}

async function runOne<Id extends string>(
  options: SuiteOptions<Id>,
  id: Id,
): Promise<StressRunEvidence> {
  console.log(JSON.stringify({ phase: "fixture.start", id }));
  const fixture = await options.prepare(options.fixtureRoot, id);
  console.log(
    JSON.stringify({
      phase: "fixture.ready",
      id,
      fixtureMs: fixture.fixtureMs,
      bytes: fixture.evidence.bytes,
      files: fixture.evidence.files,
    }),
  );
  const active = await startCase(options.endpoint, fixture);
  try {
    const awaited = await awaitCases(options.endpoint, [active], options.deadlineMs);
    const snapshot = awaited.snapshots.get(active.runId);
    if (snapshot === undefined) throw new Error(`Missing terminal snapshot for ${id}.`);
    const evidence = await collectEvidence(options.endpoint, active, snapshot);
    console.log(JSON.stringify({ phase: "case.done", ...evidence.result }));
    return evidence;
  } finally {
    try {
      await cleanupCase(options.endpoint, active);
    } finally {
      await removeFixture(fixture, options.removeFixtures ?? false);
    }
  }
}

export async function runSequentialCases<Id extends string>(
  options: SuiteOptions<Id>,
): Promise<StressRunEvidence[]> {
  const evidence: StressRunEvidence[] = [];
  for (const id of options.ids) evidence.push(await runOne(options, id));
  return evidence;
}

export async function runConcurrentCases<Id extends string>(options: SuiteOptions<Id>) {
  const startedAt = performance.now();
  const fixtures = [];
  for (const id of options.ids) {
    console.log(JSON.stringify({ phase: "concurrent.fixture.start", id }));
    fixtures.push(await options.prepare(options.fixtureRoot, id));
  }
  const active = await Promise.all(
    fixtures.map(async (fixture) => startCase(options.endpoint, fixture)),
  );
  try {
    const awaited = await awaitCases(options.endpoint, active, options.deadlineMs);
    const evidence = await Promise.all(
      active.map(async (item) => {
        const snapshot = awaited.snapshots.get(item.runId);
        if (snapshot === undefined)
          throw new Error(`Missing terminal snapshot for ${item.fixture.id}.`);
        return collectEvidence(options.endpoint, item, snapshot);
      }),
    );
    const result = {
      maximumRunning: awaited.maximumRunning,
      wallMs: Math.round(performance.now() - startedAt),
      evidence,
    };
    console.log(
      JSON.stringify({
        phase: "concurrent.done",
        maximumRunning: result.maximumRunning,
        wallMs: result.wallMs,
        results: evidence.map((item) => item.result),
      }),
    );
    return result;
  } finally {
    await Promise.all(
      active.map(async (item) => {
        try {
          await cleanupCase(options.endpoint, item);
        } finally {
          await removeFixture(item.fixture, options.removeFixtures ?? false);
        }
      }),
    );
  }
}
