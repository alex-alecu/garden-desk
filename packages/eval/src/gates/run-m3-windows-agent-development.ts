import { runDevelopmentHeadlessEntry } from "./development-inference.js";

await runDevelopmentHeadlessEntry(new URL("./m3-windows-agent.ts", import.meta.url));
