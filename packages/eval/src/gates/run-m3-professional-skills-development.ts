import { runDevelopmentHeadlessEntry } from "./development-inference.js";

await runDevelopmentHeadlessEntry(
  new URL("./m3-professional-skills.ts", import.meta.url),
  "professional_skills_limit_found",
);
