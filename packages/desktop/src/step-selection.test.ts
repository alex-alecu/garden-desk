import { describe, expect, it, vi } from "vitest";
import { selectStep } from "./step-selection.js";

describe("step selection", () => {
  it("opens Technical details when a step is selected", () => {
    const dispatch = vi.fn();
    const openDetails = vi.fn();

    selectStep(
      {
        api: { getAgentTrace: vi.fn() },
        dispatch,
        openDetails,
        setError: vi.fn(),
        steps: [
          {
            id: "step-1",
            runId: null,
            ordinal: 1,
            kind: "planning",
            title: "Planning",
          },
        ],
      },
      "step-1",
    );

    expect(openDetails).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: "step.select", stepId: "step-1" });
  });
});

describe("step trace selection", () => {
  it("reloads a run trace whenever one of its steps is selected", async () => {
    const getAgentTrace = vi.fn().mockResolvedValue({
      runId: "run-1",
      captureVersion: 0,
      status: "not_recorded",
      turns: [],
    });
    const dispatch = vi.fn();
    const selection = {
      api: { getAgentTrace },
      dispatch,
      openDetails: vi.fn(),
      setError: vi.fn(),
      steps: [
        {
          id: "step-1",
          runId: "run-1",
          ordinal: 1,
          kind: "planning" as const,
          title: "Planning",
        },
      ],
    };

    selectStep(selection, "step-1");
    selectStep(selection, "step-1");
    await vi.waitFor(() => expect(getAgentTrace).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenCalledWith({
      type: "trace.load",
      trace: expect.objectContaining({ runId: "run-1" }),
    });
  });
});
