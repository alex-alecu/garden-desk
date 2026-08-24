import { runDevelopmentHeadlessEntry } from "../gates/development-inference.js";

await runDevelopmentHeadlessEntry(new URL("./m3-scaled.ts", import.meta.url));
