import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const siteRoot = resolve(process.cwd(), "site");
const projectPath = "/vault-desk/";
const publicOrigin = "https://alex-alecu.github.io";
const publicRoutes = ["", "downloads/", "privacy/", "terms/", "security/"];
const pageFiles = new Map([
  ["", "index.html"],
  ["downloads/", "downloads/index.html"],
  ["privacy/", "privacy/index.html"],
  ["terms/", "terms/index.html"],
  ["security/", "security/index.html"],
  ["404.html", "404.html"],
]);

const failures: string[] = [];

function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function text(path: string): Promise<string> {
  return readFile(resolve(siteRoot, path), "utf8");
}

function expectedCanonical(route: string): string {
  return `${publicOrigin}${projectPath}${route}`;
}

function metadataChecks(route: string, html: string): void {
  const file = pageFiles.get(route) ?? route;
  expect(/^<!doctype html>/iu.test(html), `${file}: missing doctype`);
  expect(/<html lang="en">/u.test(html), `${file}: missing language`);
  expect(/<meta name="viewport"/u.test(html), `${file}: missing viewport metadata`);
  expect(/<title>[^<]+<\/title>/u.test(html), `${file}: missing title`);
  expect(/<meta\s+name="description"/u.test(html), `${file}: missing description`);
  expect(
    html.includes(`<link rel="canonical" href="${expectedCanonical(route)}"`),
    `${file}: canonical URL does not match its public route`,
  );
  for (const property of ["og:title", "og:description", "og:url", "og:image"]) {
    expect(html.includes(`property="${property}"`), `${file}: missing ${property}`);
  }
  expect(html.includes('name="twitter:card"'), `${file}: missing social-card metadata`);
  expect(html.includes("assets/styles.css"), `${file}: missing shared stylesheet`);
  expect(html.includes("<main"), `${file}: missing main landmark`);
}

function safetyChecks(file: string, html: string): void {
  expect(!/<form\b/iu.test(html), `${file}: forms are not allowed`);
  expect(!/<iframe\b/iu.test(html), `${file}: iframes are not allowed`);
  expect(
    !/<(?:script|img|source)[^>]+src="https?:/iu.test(html),
    `${file}: remote runtime or image resource is not allowed`,
  );
  expect(
    !/<link[^>]+rel="(?:stylesheet|preload|modulepreload)"[^>]+href="https?:/iu.test(html),
    `${file}: remote linked resources are not allowed`,
  );
  expect(
    !/(google-analytics|googletagmanager|plausible\.io|posthog|mixpanel|segment\.com)/iu.test(html),
    `${file}: tracker reference is not allowed`,
  );
  const runtimeScripts = [...html.matchAll(/<script\b([^>]*)>/giu)].filter(
    (match) => !match[1].includes('type="application/ld+json"'),
  );
  expect(runtimeScripts.length === 0, `${file}: runtime scripts are not allowed`);
}

function routeUrl(route: string): URL {
  return new URL(`${projectPath}${route}`, publicOrigin);
}

function localTarget(route: string, value: string): { anchor: string; path: string } | undefined {
  if (/^(?:https?:|mailto:|tel:)/iu.test(value)) return undefined;
  const url = new URL(value, routeUrl(route));
  if (!url.pathname.startsWith(projectPath)) {
    failures.push(`${pageFiles.get(route)}: internal link escapes the project path: ${value}`);
    return undefined;
  }
  let path = url.pathname.slice(projectPath.length);
  if (path === "" || path.endsWith("/")) path += "index.html";
  return { anchor: decodeURIComponent(url.hash.slice(1)), path };
}

async function linkChecks(route: string, html: string, pages: Map<string, string>): Promise<void> {
  const file = pageFiles.get(route) ?? route;
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/giu)].map((match) => match[1]);
  for (const reference of references) {
    if (reference.startsWith("#")) {
      const id = reference.slice(1);
      expect(html.includes(`id="${id}"`), `${file}: missing local anchor #${id}`);
      continue;
    }
    const target = localTarget(route, reference);
    if (target === undefined) continue;
    try {
      await stat(resolve(siteRoot, target.path));
    } catch {
      failures.push(`${file}: missing internal target ${reference}`);
      continue;
    }
    if (target.anchor !== "") {
      const targetHtml = pages.get(target.path);
      expect(
        targetHtml?.includes(`id="${target.anchor}"`) === true,
        `${file}: missing anchor ${reference}`,
      );
    }
  }
}

async function pngSize(path: string): Promise<[number, number]> {
  const bytes = await readFile(resolve(siteRoot, path));
  expect(bytes.subarray(1, 4).toString("ascii") === "PNG", `${path}: expected a PNG image`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const pages = new Map<string, string>();
for (const [route, file] of pageFiles) {
  const html = await text(file);
  pages.set(file, html);
  metadataChecks(route, html);
  safetyChecks(file, html);
}

for (const [route, file] of pageFiles) {
  await linkChecks(route, pages.get(file) ?? "", pages);
}

const home = pages.get("index.html") ?? "";
const structuredData = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u);
expect(structuredData !== null, "index.html: missing structured application data");
if (structuredData !== null) {
  const schema = JSON.parse(structuredData[1]) as { [key: string]: unknown };
  expect(schema["@type"] === "SoftwareApplication", "index.html: incorrect structured data type");
}

const downloads = pages.get("downloads/index.html") ?? "";
expect(
  (downloads.match(/data-download-status="unavailable"/gu) ?? []).length === 2,
  "downloads/index.html: both platform cards must be unavailable",
);
expect(
  (downloads.match(/>Coming soon</gu) ?? []).length === 2,
  "downloads/index.html: both platform cards must say Coming soon",
);
for (const card of downloads.matchAll(/<article class="download-card"[\s\S]*?<\/article>/gu)) {
  expect(!/<a\b/iu.test(card[0]), "downloads/index.html: unavailable card contains a link");
}

const sitemap = await text("sitemap.xml");
for (const route of publicRoutes) {
  expect(
    sitemap.includes(`<loc>${expectedCanonical(route)}</loc>`),
    `sitemap.xml: missing ${route}`,
  );
}

const screenshotSize = await pngSize("assets/vault-desk-sample.png");
expect(screenshotSize[0] === 1440 && screenshotSize[1] === 960, "app screenshot must be 1440x960");
const socialSize = await pngSize("assets/social-preview.png");
expect(socialSize[0] === 1200 && socialSize[1] === 630, "social preview must be 1200x630");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Site check passed (${pageFiles.size} pages, ${publicRoutes.length} public routes).`);
}
