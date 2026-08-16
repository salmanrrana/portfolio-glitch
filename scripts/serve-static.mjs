import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PORT = 8000;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
};

function parsePort(argv) {
  const portFlag = argv.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portFlag >= 0 && argv[portFlag + 1]) return Number(argv[portFlag + 1]);

  const positional = argv.find((arg) => /^\d+$/.test(arg));
  return Number(process.env.PORT || positional || DEFAULT_PORT);
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function filePathFor(url) {
  const pathname = decodeURIComponent(new URL(url, "http://local").pathname);
  const relativePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  const candidate = resolve(join(ROOT, relativePath));
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${sep}`)) return null;
  return candidate;
}

const port = parsePort(process.argv.slice(2));
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid port: ${port}`);
}

const server = createServer((req, res) => {
  const candidate = filePathFor(req.url || "/");
  if (!candidate) {
    send(res, 403, "Forbidden");
    return;
  }

  let file = candidate;
  try {
    const stats = statSync(file);
    if (stats.isDirectory()) file = join(file, "index.html");
  } catch {
    send(res, 404, "Not found");
    return;
  }

  try {
    const stats = statSync(file);
    if (!stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "content-length": stats.size,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, "Not found");
  }
});

server.listen(port, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${port}/`);
});
