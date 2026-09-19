import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

interface DependencyOrigin {
  file: string;
  sha256: string;
  url: string;
}

interface NoticePackage {
  installedBytes?: Record<string, number | string>;
  license: string;
  name: string;
  notice?: string;
  patches?: DependencyOrigin & { series?: string[]; set?: string };
  purpose: string;
  runtimeBytes?: Record<string, number | string>;
  source?: DependencyOrigin;
  version: string;
}

interface GuestManifest {
  contents: NoticePackage[];
}

export interface ExternalPackageFile {
  source: string;
  path: string;
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((accept, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", accept);
  });
  return digest.digest("hex");
}

async function files(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(root, path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const hostPackages = [
  { name: "Node.js", version: "24.18.0", license: "MIT" },
  {
    name: "llama.cpp (PrismML fork)",
    version: "prism-b10685-7dffb15",
    license: "MIT",
    notice: "License text: licenses/llama.cpp-LICENSE.txt",
    source: {
      file:
        process.platform === "win32"
          ? "llama-prism-b10685-7dffb15-bin-win-cuda-13.3-x64.zip"
          : "llama-prism-b10685-7dffb15-bin-macos-arm64.tar.gz",
      sha256:
        process.platform === "win32"
          ? "0b0e44045b0b55bb892c5afa8fd4c988194c47c02967ff1da55cd01c0c8eda69"
          : "7fffa7a40c74f3e9bd78f3f2f9f12f9befb7b13af45d5a69c239cf3fd37b9045",
      url:
        process.platform === "win32"
          ? "https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10685-7dffb15/llama-prism-b10685-7dffb15-bin-win-cuda-13.3-x64.zip"
          : "https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10685-7dffb15/llama-prism-b10685-7dffb15-bin-macos-arm64.tar.gz",
    },
  },
  {
    name: "Ternary Bonsai 2 27B GGUF",
    version: "PQ2_0",
    license: "Apache-2.0",
    notice:
      "Copyright 2026-present Prism ML, Inc. Created using Bonsai by Prism ML. License text: licenses/ternary-bonsai-2-LICENSE.txt. Notice: licenses/ternary-bonsai-2-NOTICE.txt.",
  },
  {
    name: "Qwen3.8-27B",
    version: "base model of Ternary Bonsai 2",
    license: "Apache-2.0",
    notice:
      "Copyright 2026 Alibaba Cloud. License text: licenses/qwen3.8-LICENSE.txt. https://huggingface.co/Qwen/Qwen3.8-27B",
  },
  { name: "React", version: "19.2.7", license: "MIT" },
  { name: "Tauri", version: "2.11.5", license: "Apache-2.0 OR MIT" },
];

function platformPackages(): NoticePackage[] {
  return process.platform === "win32"
    ? [
        {
          name: "Microsoft windows-rs",
          version: "0.61.3",
          license: "MIT OR Apache-2.0",
          purpose: "DXCore GPU and installed-memory discovery in the Windows inference helper",
        },
        {
          name: "Microsoft Visual C++ Desktop Runtime",
          version: "14.0.33321.0",
          license: "Microsoft Software License Terms",
          purpose: "application-local Windows inference runtime dependency",
          source: {
            file: "Microsoft.VCLibs.x64.14.00.Desktop.appx",
            sha256: "b56a9101f706f9d95f815f5b7fa6efbac972e86573d378b96a07cff5540c5961",
            url: "https://download.microsoft.com/download/4/7/c/47c6134b-d61f-4024-83bd-b9c9ea951c25/Microsoft.VCLibs.x64.14.00.Desktop.appx",
          },
        },
        {
          name: "NVIDIA CUDA Runtime",
          version: "13.3",
          license: "NVIDIA CUDA Toolkit EULA",
          purpose: "packaged NVIDIA CUDA inference runtime",
          notice: "License text: licenses/cuda-EULA.html (CUDA 13.3).",
          source: {
            file: "cudart-llama-bin-win-cuda-13.3-x64.zip",
            sha256: "1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e",
            url: "https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10685-7dffb15/cudart-llama-bin-win-cuda-13.3-x64.zip",
          },
        },
        {
          name: "llama.cpp (PrismML fork) Vulkan",
          version: "prism-b10685-7dffb15",
          license: "MIT",
          purpose: "packaged Windows Vulkan inference runtime",
          notice: "License text: licenses/llama.cpp-LICENSE.txt",
          source: {
            file: "llama-prism-b10685-7dffb15-bin-win-vulkan-x64.zip",
            sha256: "f1e8090392390e5c26b184ff90f5350a5e6421bfdd74606f12c8c5de9c668b2b",
            url: "https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10685-7dffb15/llama-prism-b10685-7dffb15-bin-win-vulkan-x64.zip",
          },
        },
      ]
    : [];
}

function platformIdentity(): { name: string; slug: string } {
  return process.platform === "win32"
    ? { name: "Windows", slug: "windows" }
    : { name: "macOS", slug: "macos" };
}

function spdxComment(item: NoticePackage): string {
  return JSON.stringify({
    purpose: item.purpose,
    ...(item.notice === undefined ? {} : { notice: item.notice }),
    ...(item.installedBytes === undefined ? {} : { installedBytes: item.installedBytes }),
    ...(item.runtimeBytes === undefined ? {} : { runtimeBytes: item.runtimeBytes }),
    ...(item.patches === undefined ? {} : { patches: item.patches }),
  });
}

function spdxPackage(item: NoticePackage, index: number) {
  return {
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: item.source?.url ?? "NOASSERTION",
    ...(item.source === undefined
      ? {}
      : {
          packageFileName: item.source.file,
          checksums: [{ algorithm: "SHA256", checksumValue: item.source.sha256 }],
        }),
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: item.license,
    summary: item.purpose,
    comment: spdxComment(item),
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: notices, SBOM, and hashes are emitted together so a package cannot contain only part of its compliance record.
export async function writePackageCompliance(
  resourcesRoot: string,
  guestManifestPath: string,
  externalFiles: ExternalPackageFile[] = [],
): Promise<string> {
  const platform = platformIdentity();
  const guest = JSON.parse(await readFile(guestManifestPath, "utf8")) as GuestManifest;
  const packageCandidates = [
    ...hostPackages.map((item) => ({ ...item, purpose: "packaged desktop runtime" })),
    ...platformPackages(),
    ...guest.contents,
  ];
  const packages = [
    ...new Map(packageCandidates.map((item) => [`${item.name}@${item.version}`, item])).values(),
  ];
  await writeFile(
    join(resourcesRoot, "THIRD_PARTY_NOTICES.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        notice: "License texts shipped by upstream runtime packages remain authoritative.",
        packages,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(resourcesRoot, "sbom.spdx.json"),
    `${JSON.stringify(
      {
        spdxVersion: "SPDX-2.3",
        dataLicense: "CC0-1.0",
        SPDXID: "SPDXRef-DOCUMENT",
        name: `Garden-Desk-M3-${platform.name}`,
        documentNamespace: `https://gardendesk.ai/spdx/v1/m3-${platform.slug}`,
        creationInfo: { created: "2026-07-20T00:00:00Z", creators: ["Organization: Garden Desk"] },
        packages: packages.map(spdxPackage),
        relationships: packages.map((_, index) => ({
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: `SPDXRef-Package-${index + 1}`,
        })),
      },
      null,
      2,
    )}\n`,
  );
  const entries: Array<{ path: string; byteLength: number; sha256: string }> = [];
  for (const path of (await files(resourcesRoot)).sort()) {
    const metadata = await stat(path);
    entries.push({
      path: relative(resourcesRoot, path),
      byteLength: metadata.size,
      sha256: await hashFile(path),
    });
  }
  for (const external of externalFiles) {
    const metadata = await stat(external.source);
    entries.push({
      path: external.path,
      byteLength: metadata.size,
      sha256: await hashFile(external.source),
    });
  }
  for (const entry of entries) entry.path = entry.path.split(sep).join("/");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) {
      throw new Error(`Packaged resource manifest contains duplicate ${entry.path}.`);
    }
    paths.add(entry.path);
  }
  const manifest = join(resourcesRoot, "resource-manifest.json");
  await writeFile(manifest, `${JSON.stringify({ schemaVersion: 1, files: entries }, null, 2)}\n`);
  return await hashFile(manifest);
}

export async function writePackageIdentity(
  resourcesRoot: string,
  identity: unknown,
): Promise<void> {
  await writeFile(
    join(resourcesRoot, "package-identity.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
}
