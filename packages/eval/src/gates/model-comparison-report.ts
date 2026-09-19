import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Json = Record<string, unknown>;
interface Timings {
  prompt_per_second?: number;
  predicted_per_second?: number;
  prompt_n?: number;
  draft_n?: number;
  draft_n_accepted?: number;
}

const directory = join(process.cwd(), "packages/eval/.generated/model-comparison");
const gib = (bytes: unknown) => (typeof bytes === "number" ? (bytes / 1024 ** 3).toFixed(2) : "-");
const rate = (value: unknown) => (typeof value === "number" ? value.toFixed(1) : "-");
const percent = (value: unknown) =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "-";

async function reports(): Promise<Array<{ raw: Json; agent: Json | undefined }>> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const result = [];
  for (const name of files.filter((file) => !file.endsWith("-agent.json")).sort()) {
    const raw = JSON.parse(await readFile(join(directory, name), "utf8")) as Json;
    const agentName = name.replace(/\.json$/u, "-agent.json");
    const agent = files.includes(agentName)
      ? (JSON.parse(await readFile(join(directory, agentName), "utf8")) as Json)
      : undefined;
    result.push({ raw, agent });
  }
  return result;
}

function throughputRow(raw: Json): string[] {
  const throughput = (raw.throughput ?? {}) as Record<string, Timings>;
  const code = throughput.code ?? {};
  const long = throughput.long_prefill ?? {};
  const accepted =
    typeof code.draft_n === "number" && code.draft_n > 0
      ? percent((code.draft_n_accepted ?? 0) / code.draft_n)
      : "-";
  return [
    rate(long.prompt_per_second),
    String(long.prompt_n ?? "-"),
    rate(code.predicted_per_second),
    rate(throughput.prose?.predicted_per_second),
    rate(throughput.code_thinking?.predicted_per_second),
    accepted,
  ];
}

function contextRows(raw: Json): string {
  const contexts = (raw.contexts ?? []) as Json[];
  return contexts
    .map((entry) => {
      const memory = (entry.memory ?? {}) as Json;
      return `${entry.contextTokens} tokens: GPU ${gib(memory.gpuMemoryBytes)} GiB, CPU ${gib(memory.cpuRamBytes)} GiB, load ${entry.loadMs} ms`;
    })
    .join("<br>");
}

const rows = await reports();
const lines = [
  "| Run | Speculation | Prefill tok/s (long) | Prefill tokens | Gen tok/s (code) | Gen tok/s (prose) | Gen tok/s (thinking) | Draft accepted | Tool precision | Specialist choice (prompt) | Specialist choice (agent) | Agent success | Agent quality | Memory by context |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const { raw, agent } of rows) {
  const tool = (raw.toolPrecision ?? {}) as Json;
  const choice = (raw.specialistChoice ?? {}) as Json;
  lines.push(
    `| ${raw.label} | ${raw.speculation} | ${throughputRow(raw).join(" | ")} | ${percent(tool.precision)} | ${percent(choice.precision)} | ${percent(agent?.specialistPrecision)} | ${agent === undefined ? "-" : `${agent.succeeded}/${agent.cases}`} | ${percent(agent?.meanQuality)} | ${contextRows(raw)} |`,
  );
}
const output = join(directory, "comparison.md");
await writeFile(output, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(JSON.stringify({ stage: "finished", output }));
