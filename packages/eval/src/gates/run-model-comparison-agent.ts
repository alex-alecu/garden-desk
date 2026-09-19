import { runDevelopmentHeadlessEntry } from "./development-inference.js";

await runDevelopmentHeadlessEntry(
  new URL("./model-comparison-agent.ts", import.meta.url),
  "model_comparison_agent_failed",
);
