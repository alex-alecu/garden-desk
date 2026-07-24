import { describe, expect, it } from "vitest";
import { debugSnapshotReducer, initialDebugSnapshotState } from "./debug-snapshot.js";

describe("debug snapshot state", () => {
  it("clears stale paths while creating and after failures", () => {
    const ready = debugSnapshotReducer(initialDebugSnapshotState, {
      type: "create.succeeded",
      path: "/tmp/vault-session-debug-ready",
    });
    expect(debugSnapshotReducer(ready, { type: "create.start" })).toEqual({
      creating: true,
      error: undefined,
      path: undefined,
      revealing: false,
    });
    expect(debugSnapshotReducer(ready, { type: "create.failed" }).path).toBeUndefined();
  });

  it("retains the created path across reveal failures and resets for another session", () => {
    const ready = debugSnapshotReducer(initialDebugSnapshotState, {
      type: "create.succeeded",
      path: "/tmp/vault-session-debug-ready",
    });
    const failure = debugSnapshotReducer(ready, { type: "reveal.failed" });
    expect(failure.path).toBe(ready.path);
    expect(failure.error).toContain("could not be revealed");
    expect(debugSnapshotReducer(failure, { type: "session.reset" })).toBe(
      initialDebugSnapshotState,
    );
  });
});
