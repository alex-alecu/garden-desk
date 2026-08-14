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
  { name: "node-llama-cpp", version: "3.19.0", license: "MIT" },
  { name: "Gemma 4 12B IT QAT GGUF", version: "Q4_0", license: "Gemma Terms of Use" },
  { name: "React", version: "19.2.7", license: "MIT" },
  { name: "Tauri", version: "2.11.5", license: "Apache-2.0 OR MIT" },
];

function platformPackages(): NoticePackage[] {
  return process.platform === "win32"
    ? [
        {
          name: "NVIDIA cuBLAS",
          version: "13.2.0.9",
          license: "NVIDIA CUDA Toolkit EULA",
          purpose: "packaged NVIDIA CUDA inference runtime",
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

async function runtimePackages(resourcesRoot: string): Promise<NoticePackage[]> {
  const modules = join(resourcesRoot, "inference/node_modules");
  const packages: NoticePackage[] = [];
  for (const path of await files(modules)) {
    if (!path.endsWith("package.json")) continue;
    const metadata = JSON.parse(await readFile(path, "utf8")) as {
      name?: string;
      version?: string;
      license?: string;
    };
    if (metadata.name === undefined || metadata.version === undefined) continue;
    packages.push({
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? "NOASSERTION",
      purpose: "host-native inference runtime dependency",
    });
  }
  return packages;
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
    ...(await runtimePackages(resourcesRoot)),
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
        name: `Vault-Desk-M3-${platform.name}`,
        documentNamespace: `https://vaultdesk.local/spdx/v1/m3-${platform.slug}`,
        creationInfo: { created: "2026-07-20T00:00:00Z", creators: ["Organization: Vault Desk"] },
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
