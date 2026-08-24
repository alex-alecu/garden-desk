import { runDevelopmentHeadlessEntry } from "../gates/development-inference.js";

await runDevelopmentHeadlessEntry(new URL("./m3-small.ts", import.meta.url));
