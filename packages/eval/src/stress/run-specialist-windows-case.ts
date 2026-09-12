import { runDevelopmentHeadlessEntry } from "../gates/development-inference.js";

await runDevelopmentHeadlessEntry(
  new URL("./specialist-windows-case.ts", import.meta.url),
  "specialist_case_failed",
);
