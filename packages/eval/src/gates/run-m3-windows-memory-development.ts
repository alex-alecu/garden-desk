import { runDevelopmentHeadlessEntry } from "./development-inference.js";

await runDevelopmentHeadlessEntry(new URL("./m3-windows-memory.ts", import.meta.url));
