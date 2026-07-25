import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const host = "127.0.0.1";
const port = 4173;
const basePath = "/vault-desk";
const siteRoot = resolve(process.cwd(), "site");
const allowedMethods = new Set(["GET", "HEAD"]);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function send(response: ServerResponse, status: number, contentType: string, body: Buffer): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": contentType,
  });
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location });
  response.end();
}

function localPath(pathname: string): string | undefined {
  if (!pathname.startsWith(`${basePath}/`)) return undefined;
  const relative = decodeURIComponent(pathname.slice(basePath.length + 1));
  const target = relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative;
  const candidate = resolve(siteRoot, target);
  return candidate.startsWith(`${siteRoot}${sep}`) ? candidate : undefined;
}

async function pathKind(path: string | undefined): Promise<"directory" | "file" | undefined> {
  if (path === undefined) return undefined;
  try {
    const entry = await stat(path);
    if (entry.isDirectory()) return "directory";
    return entry.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}

async function serveNotFound(response: ServerResponse): Promise<void> {
  const body = await readFile(resolve(siteRoot, "404.html"));
  send(response, 404, contentTypes[".html"], body);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!allowedMethods.has(request.method ?? "")) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/" || url.pathname === basePath) {
    redirect(response, `${basePath}/`);
    return;
  }
  const path = localPath(url.pathname);
  const kind = await pathKind(path);
  if (kind === "directory") {
    redirect(response, `${url.pathname}/`);
    return;
  }
  if (kind !== "file" || path === undefined) {
    await serveNotFound(response);
    return;
  }
  const body = request.method === "HEAD" ? Buffer.alloc(0) : await readFile(path);
  send(response, 200, contentTypes[extname(path)] ?? "application/octet-stream", body);
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    response.writeHead(500);
    response.end("Local site server failed.");
  });
});

server.listen(port, host, () => {
  console.log(`Vault Desk website: http://${host}:${port}${basePath}/`);
});
