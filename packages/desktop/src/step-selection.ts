import type { DesktopApi } from "./api.js";
import type { DesktopAction } from "./state.js";
import type { AgentStep } from "./steps.js";

interface StepSelection {
  api: Pick<DesktopApi, "getAgentTrace">;
  dispatch(action: DesktopAction): void;
  openDetails(): void;
  setError(message: string | undefined): void;
  steps: AgentStep[];
}

/**
 * Selecting a step opens its recorded prompts, so the expensive trace read happens on
 * demand for that step's run and never inside the run-polling loop.
 */
export function selectStep(selection: StepSelection, stepId: string | undefined): void {
  const { api, dispatch, openDetails, setError, steps } = selection;
  if (stepId !== undefined) openDetails();
  dispatch({ type: "step.select", stepId });
  const runId = steps.find((step) => step.id === stepId)?.runId;
  if (runId === undefined || runId === null) return;
  void api
    .getAgentTrace(runId)
    .then((trace) => dispatch({ type: "trace.load", trace }))
    .catch(() => setError("The recorded prompts for this task could not be loaded."));
}
