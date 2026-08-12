import type { AgentQuestion } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import { askRunQuestion, createPendingQuestion, settleRunQuestion } from "./agent-questions.js";
import type { ActiveRun } from "./service-active.js";
import type { AgentStore } from "./store.js";

const runId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const questions: AgentQuestion[] = [
  {
    header: "Direction",
    question: "Which output?",
    options: [
      { label: "Short", description: "" },
      { label: "Full", description: "" },
    ],
  },
];

function activeRun(): ActiveRun {
  return {
    controller: new AbortController(),
    finished: Promise.resolve(),
    runId,
    sessionId: "00000000-0000-4000-8000-000000000003",
    thinking: null,
  };
}

describe("agent question lifecycle", () => {
  it("fails immediately when the owning active run is missing", async () => {
    await expect(
      askRunQuestion({
        active: new Map(),
        store: { appendEvent: vi.fn() } as unknown as AgentStore,
        run: { id: runId, jobId },
        signal: new AbortController().signal,
        questions,
      }),
    ).rejects.toThrow("active_run_missing");
  });

  it("clears the pending request when the run is aborted", async () => {
    const controller = new AbortController();
    const current = activeRun();
    const active = new Map([[jobId, current]]);
    const waiting = askRunQuestion({
      active,
      store: { appendEvent: vi.fn() } as unknown as AgentStore,
      run: { id: runId, jobId },
      signal: controller.signal,
      questions,
    });

    expect(current.question?.request.runId).toBe(runId);
    controller.abort();

    await expect(waiting).rejects.toThrow();
    expect(current.question).toBeNull();
  });
});

describe("agent question answers", () => {
  it("validates direct facade answers before settling", async () => {
    const current = activeRun();
    const created = createPendingQuestion(runId, questions);
    current.question = created.pending;
    const active = new Map([[jobId, current]]);

    expect(
      settleRunQuestion(active, runId, created.pending.request.id, {
        dismissed: false,
        answers: [["x".repeat(301)]],
      }),
    ).toBe(false);
    expect(
      settleRunQuestion(active, runId, created.pending.request.id, {
        dismissed: false,
        answers: [["Short", "Full"]],
      }),
    ).toBe(false);
    expect(
      settleRunQuestion(active, runId, created.pending.request.id, {
        dismissed: false,
        answers: [["Full"]],
      }),
    ).toBe(true);
    await expect(created.answered).resolves.toEqual({ dismissed: false, answers: [["Full"]] });
  });

  it("accepts five options plus a custom answer for a multiple-choice question", async () => {
    const multi = [
      {
        ...questions[0],
        multiple: true,
        options: ["One", "Two", "Three", "Four", "Five"].map((label) => ({
          label,
          description: "",
        })),
      },
    ] as AgentQuestion[];
    const current = activeRun();
    const created = createPendingQuestion(runId, multi);
    current.question = created.pending;
    const active = new Map([[jobId, current]]);
    const answers = [["One", "Two", "Three", "Four", "Five", "Custom"]];

    expect(
      settleRunQuestion(active, runId, created.pending.request.id, {
        dismissed: false,
        answers,
      }),
    ).toBe(true);
    await expect(created.answered).resolves.toEqual({ dismissed: false, answers });
  });
});
