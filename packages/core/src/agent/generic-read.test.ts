import { describe, expect, it } from "vitest";
import { executeRead, readRegistry, readSource } from "./generic-read-test-support.js";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused read contracts share one guest fixture.
describe("generic read", () => {
  it("streams plain UTF-8 text, accented paths, offsets, and line limits", async () => {
    const program = await readSource({ path: "notes-ă.txt", offset: 2, limit: 1 });
    const readProgram = program.split("elif op == 'glob':")[0] as string;

    expect(program).toContain("notes-ă.txt");
    expect(program).toContain("offset = args.get('offset', 1)");
    expect(program).toContain("limit = args.get('limit', 2000)");
    expect(program).toContain("codecs.getincrementaldecoder('utf-8')('strict')");
    expect(program).toContain("with path.open('rb') as handle:");
    expect(program).toContain("def stream(handle):");
    expect(program).toContain("def consume(text):");
    expect(program).toContain("sys.stdout.write(text)");
    expect(program).toContain("if offset <= current_line < offset + limit:");
    expect(program).toContain("handle.seek(0)");
    expect(program).toContain("read_utf8_lines(root, offset, limit)");
    expect(readProgram.match(/path\.open\(/gu)).toHaveLength(1);
    expect(readProgram.indexOf("handle.seek(0)")).toBeGreaterThan(
      readProgram.indexOf("decoder.decode(b'', final=True)"),
    );
    expect(readProgram).not.toContain("read_text(");
    expect(readProgram).not.toContain("splitlines()");
    expect(readProgram).not.toContain("selected = []");
    expect(readProgram).not.toContain("selected.append");
    expect(readProgram).not.toContain("line = []");
    expect(readProgram).not.toContain("''.join(");

    await expect(
      executeRead(Buffer.from("first\nă second\nthird\n"), { offset: 2, limit: 1 }),
    ).resolves.toEqual({
      code: 0,
      stderr: "",
      stdout: "2: ă second\n",
    });
  });

  it("accepts one multibyte sequence split across the 65,536-byte chunk boundary", async () => {
    const bytes = Buffer.concat([Buffer.alloc(65_535, "a"), Buffer.from("ă\n")]);

    const result = await executeRead(bytes);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toMatch(/^1: a+/u);
    expect(result.stdout).toMatch(/ă\n$/u);
  });

  it("keeps a requested final line with no line ending", async () => {
    await expect(executeRead(Buffer.from("first\nlast"), { offset: 2, limit: 1 })).resolves.toEqual(
      {
        code: 0,
        stderr: "",
        stdout: "2: last\n",
      },
    );
  });
  it("keeps CR, LF, and CRLF line boundaries", async () => {
    await expect(
      executeRead(Buffer.from("first\rsecond\nthird\r\nlast"), { offset: 2, limit: 3 }),
    ).resolves.toEqual({
      code: 0,
      stderr: "",
      stdout: "2: second\n3: third\n4: last\n",
    });
  });
  it("discards an unrequested long line without returning it", async () => {
    const result = await executeRead(Buffer.alloc(2 * 65_536, "x"), { offset: 2, limit: 1 });

    expect(result).toEqual({ code: 0, stderr: "", stdout: "" });
  });

  it("stops the second pass after the requested final line ending", async () => {
    const bytes = Buffer.concat([Buffer.from("selected\n"), Buffer.alloc(3 * 65_536, "x")]);

    await expect(
      executeRead(bytes, { offset: 1, limit: 1 }, { maximumSecondPassReads: 1 }),
    ).resolves.toEqual({
      code: 0,
      stderr: "",
      stdout: "1: selected\n",
    });
  });

  it("validates the complete file before it returns a short range", async () => {
    const bytes = Buffer.concat([
      Buffer.from("selected\n"),
      Buffer.alloc(2 * 65_536, "x"),
      Buffer.from([0xc3, 0x28]),
    ]);

    const result = await executeRead(bytes, { offset: 1, limit: 1 });

    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("ValueError: read_requires_utf8_text");
  });

  it("streams a requested long single line without retaining it", async () => {
    const length = 2 * 65_536;
    const result = await executeRead(Buffer.alloc(length, "x"), {}, { maximumWrite: 65_536 });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toHaveLength(length + 4);
    expect(result.stdout.startsWith("1: ")).toBe(true);
    expect(result.stdout.endsWith("x\n")).toBe(true);
  });

  it("rejects a NUL byte added after validation and before the second pass", async () => {
    const result = await executeRead(
      Buffer.from("first line\n"),
      {},
      { secondPassBytes: Buffer.from("\0irst line\n") },
    );

    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("ValueError: read_requires_utf8_text");
  });

  it("streams a valid live-file update in the second pass", async () => {
    await expect(
      executeRead(
        Buffer.from("first\nsecond\n"),
        {},
        {
          secondPassBytes: Buffer.from("third\nfourth\n"),
        },
      ),
    ).resolves.toEqual({
      code: 0,
      stderr: "",
      stdout: "1: third\n2: fourth\n",
    });
  });

  it.each([
    ["invalid UTF-8", Buffer.from([0xc3, 0x28])],
    ["a NUL byte", Buffer.from("plain\0text")],
    ["OLE-like random binary", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    [
      "an incomplete final UTF-8 sequence",
      Buffer.concat([Buffer.alloc(65_535, "a"), Buffer.from([0xc4])]),
    ],
  ])("rejects %s with one error code and no raw output", async (_name, bytes) => {
    const program = await readSource({ path: "input.bin" });
    const result = await executeRead(bytes);

    expect(program).toContain("while chunk := handle.read(65536)");
    expect(program).toContain("if b'\\0' in chunk: raise ValueError('read_requires_utf8_text')");
    expect(program).toContain("except UnicodeDecodeError:");
    expect(program.match(/read_requires_utf8_text/gu)).toHaveLength(3);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("ValueError: read_requires_utf8_text");
  });

  it.each([
    ["read offset below minimum", "read", { path: "text.txt", offset: 0 }],
    [
      "read offset above safe range",
      "read",
      { path: "text.txt", offset: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["read limit below minimum", "read", { path: "text.txt", limit: 0 }],
    ["read limit above maximum", "read", { path: "text.txt", limit: 2_001 }],
    [
      "read limit above safe range",
      "read",
      {
        path: "text.txt",
        limit: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    ["list depth below minimum", "list", { depth: -1 }],
    ["list depth above maximum", "list", { depth: 9 }],
  ])("rejects %s instead of clamping", async (_name, tool, params) => {
    const runs: Parameters<AgentExecutor["execute"]>[0][] = [];
    const result = await readRegistry(runs).execute(tool, params);

    expect(result).toMatchObject({ failed: true, invalidInput: true });
    expect(runs).toHaveLength(0);
  });

  it("returns the schema-aligned correction for bounded numbers and optional text", async () => {
    const registry = readRegistry([]);
    const offset = await registry.execute("read", { path: "text.txt", offset: 0 });
    const limit = await registry.execute("read", { path: "text.txt", limit: 2_001 });
    const depth = await registry.execute("list", { depth: 9 });
    const include = await registry.execute("grep", { pattern: "value", include: "" });
    const [read, glob, grep, list] = registry.definitions(["read", "glob", "grep", "list"]);

    expect(offset.content).toContain(
      `invalid_offset: use an integer from 1 to ${Number.MAX_SAFE_INTEGER}`,
    );
    expect(limit.content).toContain("invalid_limit: use an integer from 1 to 2000");
    expect(depth.content).toContain("invalid_depth: use an integer from 0 to 8");
    expect(include.content).toContain(
      "invalid_include: use non-empty text with at most 4096 characters",
    );
    expect(read?.description).toContain(
      "Offset defaults to 1; limit defaults to 2000 and must be 1-2000.",
    );
    expect(read?.params).toMatchObject({
      properties: {
        path: { minLength: 1, maxLength: 4_096 },
        offset: { maximum: Number.MAX_SAFE_INTEGER, default: 1 },
        limit: { minimum: 1, maximum: 2_000, default: 2_000 },
      },
    });
    expect(grep?.description).toContain(
      "Include defaults to *; when set, use non-empty text up to 4096 characters.",
    );
    expect(grep?.params).toMatchObject({
      properties: {
        pattern: { minLength: 1, maxLength: 4_096 },
        path: { minLength: 1, maxLength: 4_096 },
        include: { minLength: 1, maxLength: 4_096 },
      },
    });
    expect(glob?.params).toMatchObject({
      properties: {
        pattern: { minLength: 1, maxLength: 4_096 },
        path: { minLength: 1, maxLength: 4_096 },
      },
    });
    expect(list?.description).toContain("Depth defaults to 2 and must be 0-8.");
    expect(list?.params).toMatchObject({
      properties: { path: { minLength: 1, maxLength: 4_096 }, depth: { default: 2 } },
    });
  });
});
