import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const output = join(root, "site", "dist");
const publishedRoot = new URL("https://alex-alecu.github.io/vault-desk/");
const failures: string[] = [];
const routeFiles = [
  "index.html",
  "demo/index.html",
  "downloads/index.html",
  "privacy/index.html",
  "terms/index.html",
  "security/index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "assets/social-card.png",
];

async function text(path: string): Promise<string> {
  return readFile(join(output, path), "utf8");
}

function requireText(source: string, value: string, label: string): void {
  if (!source.includes(value)) failures.push(`${label}: missing ${value}`);
}

function publicPath(path: string): string {
  return relative(output, path).split(sep).join("/");
}

function publishedUrl(path: string): URL {
  const route = path === "index.html" ? "" : path.replace(/index\.html$/u, "");
  return new URL(route, publishedRoot);
}

function localOutputPath(url: URL): string | undefined {
  if (url.origin !== publishedRoot.origin) return undefined;
  if (!url.pathname.startsWith(publishedRoot.pathname)) {
    failures.push(`link: outside project path ${url.href}`);
    return undefined;
  }
  const route = decodeURIComponent(url.pathname.slice(publishedRoot.pathname.length));
  const targetRoute = route === "" || route.endsWith("/") ? `${route}index.html` : route;
  return join(output, targetRoute);
}

async function validateLink(path: string, from: URL, href: string): Promise<void> {
  if (/^(?:mailto|tel):/iu.test(href)) return;
  const url = new URL(href, from);
  const target = localOutputPath(url);
  if (target === undefined) return;
  try {
    if (!(await stat(target)).isFile()) throw new Error("not a file");
    if (url.hash === "" || extname(target) !== ".html") return;
    const id = decodeURIComponent(url.hash.slice(1));
    const targetSource = await readFile(target, "utf8");
    if (!targetSource.includes(`id="${id}"`) && !targetSource.includes(`id='${id}'`)) {
      failures.push(`${publicPath(path)}: missing anchor ${url.hash}`);
    }
  } catch {
    failures.push(`${publicPath(path)}: broken link ${href}`);
  }
}

async function validateLinks(path: string, source: string): Promise<void> {
  const from = publishedUrl(publicPath(path));
  for (const match of source.matchAll(/href=["']([^"']+)["']/giu)) {
    const href = match[1];
    if (href !== undefined) await validateLink(path, from, href);
  }
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

for (const path of routeFiles) {
  try {
    if (!(await stat(join(output, path))).isFile()) failures.push(`${path}: not a file`);
  } catch {
    failures.push(`${path}: missing route`);
  }
}

const htmlFiles = (await files(output)).filter((path) => extname(path) === ".html");
for (const path of htmlFiles) {
  const source = await readFile(path, "utf8");
  const label = publicPath(path);
  requireText(source, 'rel="canonical"', label);
  requireText(source, `href="${publishedUrl(label).href}"`, `${label} canonical`);
  if (/<(?:script|img|iframe)[^>]+src=["']https?:/iu.test(source)) {
    failures.push(`${label}: remote executable or image asset`);
  }
  if (/<link[^>]+(?:stylesheet|font)[^>]+href=["']https?:/iu.test(source)) {
    failures.push(`${label}: remote stylesheet or font`);
  }
  if (/<form[^>]+action=/iu.test(source)) {
    failures.push(`${label}: data-submitting form`);
  }
  await validateLinks(path, source);
}

const home = await text("index.html");
requireText(home, 'src="./demo/"', "home");
requireText(home, 'href="./demo/"', "home");
requireText(home, "SoftwareApplication", "home");
requireText(home, "social-card.png", "home");

const downloads = await text("downloads/index.html");
if ((downloads.match(/Coming soon/gu) ?? []).length < 2) {
  failures.push("downloads: both platforms must be unavailable");
}

const sitemap = await text("sitemap.xml");
for (const route of ["/", "/demo/", "/downloads/", "/privacy/", "/terms/", "/security/"]) {
  requireText(sitemap, `vault-desk${route}`, "sitemap");
}

const socialCard = await readFile(join(output, "assets", "social-card.png"));
if (socialCard.readUInt32BE(16) !== 1200 || socialCard.readUInt32BE(20) !== 630) {
  failures.push("social card: expected 1200x630 PNG");
}

const assets = (await files(output)).filter((path) => [".js", ".css"].includes(extname(path)));
const assetText = (await Promise.all(assets.map((path) => readFile(path, "utf8")))).join("\n");
for (const forbidden of [
  "@tauri-apps",
  "__TAURI",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "sendBeacon",
  "google-analytics",
  "googletagmanager",
  "mixpanel",
  "plausible.io",
  "posthog",
  "segment.com",
]) {
  if (assetText.includes(forbidden)) failures.push(`bundle: contains forbidden ${forbidden}`);
}
if (/\bfetch\s*\(/u.test(assetText)) failures.push("bundle: contains a network fetch");

const demoHtml = await text("demo/index.html");
const demoScript = demoHtml.match(/src="([^"]+\.js)"/u)?.[1];
if (demoScript === undefined) {
  failures.push("demo: missing bundled script");
} else {
  const bundlePath = demoScript.startsWith("/vault-desk/")
    ? resolve(output, demoScript.slice("/vault-desk/".length))
    : resolve(output, "demo", demoScript);
  const demoBundle = await readFile(bundlePath, "utf8").catch(() => "");
  if (demoBundle.length === 0) failures.push("demo: bundled script does not resolve");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Site contract check passed (${routeFiles.length} public files).`);
}
