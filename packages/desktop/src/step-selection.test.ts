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
        traces: [],
      },
      "step-1",
    );

    expect(openDetails).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: "step.select", stepId: "step-1" });
  });
});
