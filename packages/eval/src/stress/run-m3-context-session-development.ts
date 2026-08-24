import { runDevelopmentHeadlessEntry } from "../gates/development-inference.js";

await runDevelopmentHeadlessEntry(new URL("./m3-context-session.ts", import.meta.url));
