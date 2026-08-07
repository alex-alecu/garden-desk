import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

const execFileAsync = promisify(execFile);
const inflateRawAsync = promisify(inflateRaw);
const wheelRoot = join(
  process.cwd(),
  "packages/workers/images/.generated/downloads/vault-python-libraries",
);
const typingExtensionsSource = join(
  process.cwd(),
  "packages/workers/images/.generated/downloads/python-typing-extensions/typing_extensions-4.15.0.tar.gz",
);
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;

function hostPython(): string {
  return process.platform === "win32" ? "python" : "/usr/bin/python3";
}

async function runHostPython(script: string, args: string[], wheels: string[]): Promise<string> {
  const result = await execFileAsync(hostPython(), ["-c", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: wheels.join(delimiter) },
    maxBuffer: MAX_EXTRACTED_BYTES,
  });
  return result.stdout;
}

async function extractedWorkbookText(path: string): Promise<string> {
  const script = [
    "from openpyxl import load_workbook",
    "import sys",
    "workbook = load_workbook(sys.argv[1], read_only=True, data_only=True)",
    "print('\\n'.join('='.join(str(value) for value in row if value is not None) for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True)))",
  ].join("\n");
  return runHostPython(
    script,
    [path],
    [
      join(wheelRoot, "openpyxl-3.1.5-py2.py3-none-any.whl"),
      join(wheelRoot, "et_xmlfile-2.0.0-py3-none-any.whl"),
    ],
  );
}

async function extractedPdfText(path: string): Promise<string> {
  const script = [
    "from pathlib import Path",
    "from types import ModuleType",
    "import sys, tarfile",
    "archive = tarfile.open(sys.argv[2])",
    "member = next(item for item in archive.getmembers() if item.name.endswith('/src/typing_extensions.py'))",
    "module = ModuleType('typing_extensions')",
    "exec(compile(archive.extractfile(member).read(), member.name, 'exec'), module.__dict__)",
    "sys.modules['typing_extensions'] = module",
    "from pypdf import PdfReader",
    "print('\\n'.join((page.extract_text() or '') for page in PdfReader(Path(sys.argv[1])).pages))",
  ].join("\n");
  return runHostPython(
    script,
    [path, typingExtensionsSource],
    [join(wheelRoot, "pypdf-6.14.2-py3-none-any.whl")],
  );
}

interface ZipEntryLocation {
  compressed: boolean;
  compressedSize: number;
  localHeaderOffset: number;
}

function centralDirectoryEntries(archive: Buffer): ZipEntryLocation[] {
  const signature = archive.lastIndexOf("PK\u0005\u0006", archive.length, "latin1");
  if (signature === -1) throw new Error("Deliverable archive has no end-of-central-directory.");
  let offset = archive.readUInt32LE(signature + 16);
  const count = archive.readUInt16LE(signature + 10);
  const entries: ZipEntryLocation[] = [];
  for (let index = 0; index < count; index += 1) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    entries.push({
      compressed: archive.readUInt16LE(offset + 10) === 8,
      compressedSize: archive.readUInt32LE(offset + 20),
      localHeaderOffset: archive.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function entryText(archive: Buffer, entry: ZipEntryLocation): Promise<string> {
  const header = entry.localHeaderOffset;
  const start = header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28);
  const body = archive.subarray(start, start + entry.compressedSize);
  const bytes = entry.compressed ? await inflateRawAsync(body) : body;
  return bytes.toString("utf8");
}

/**
 * Reads every member of an OOXML deliverable without a platform archive tool so
 * macOS and Windows verify identical artifact bytes.
 */
async function extractedArchiveText(path: string): Promise<string> {
  const archive = await readFile(path);
  const entries = centralDirectoryEntries(archive);
  const parts = await Promise.all(entries.map(async (entry) => entryText(archive, entry)));
  return parts.join("\n");
}

export async function extractedArtifactText(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (extension === ".xlsx") return extractedWorkbookText(path);
  if (extension === ".pdf") return extractedPdfText(path);
  return extractedArchiveText(path);
}
