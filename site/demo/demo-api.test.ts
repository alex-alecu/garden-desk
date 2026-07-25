import { describe, expect, it } from "vitest";
import { DemoDesktopApi } from "./demo-api.js";
import { prompts } from "./demo-content.js";
import { initialRun, sessions } from "./fixtures.js";

describe("public demo fixtures and runs", () => {
  it("opens on the completed synthetic financial review", async () => {
    const api = new DemoDesktopApi();
    const bootstrap = await api.bootstrapDesktop();
    expect(bootstrap.initialSessionId).toBe(sessions[0].id);
    expect((await api.listMessages(sessions[0].id))[1]?.content).toContain(
      "Items for human review",
    );
    expect((await api.listAgentRuns(sessions[0].id))[0]).toEqual(initialRun.run);
  });

  it("moves guided examples through queued, running, and succeeded", async () => {
    const api = new DemoDesktopApi();
    const run = await api.startAgent(sessions[0].id, prompts.agreement);
    expect((await api.getAgentRun(run.id)).run.state).toBe("queued");
    expect((await api.getAgentRun(run.id)).run.state).toBe("running");
    expect((await api.getAgentRun(run.id)).run.state).toBe("succeeded");
    expect((await api.listMessages(sessions[0].id)).at(-1)?.content).toContain("Agreement summary");
  });

  it("answers arbitrary prompts with the public-demo limitation", async () => {
    const api = new DemoDesktopApi();
    const run = await api.startAgent(sessions[0].id, "Read my private file");
    expect(run.state).toBe("succeeded");
    expect((await api.listMessages(sessions[0].id)).at(-1)?.content).toContain(
      "does not run a model",
    );
  });

  it("resets all in-memory changes when a new adapter is created", async () => {
    const changed = new DemoDesktopApi();
    await changed.startAgent(sessions[0].id, "Different prompt");
    const reloaded = new DemoDesktopApi();
    expect(await reloaded.listMessages(sessions[0].id)).toHaveLength(2);
  });
});
