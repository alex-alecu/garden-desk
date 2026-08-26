import { runDevelopmentHeadlessEntry } from "./development-inference.js";

await runDevelopmentHeadlessEntry(
  new URL("./m3-macos-agent.ts", import.meta.url),
  "m3_macos_gate_failed",
);
