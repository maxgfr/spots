/**
 * Production build: Bun.build on index.html with hashed chunks and relative
 * paths (the site lives under /spots/), a CSP injected into the page, the
 * MapLibre worker copied beside it, and a service worker that
 * precaches every file and keeps the map tiles it has seen.
 *
 * Scripts, styles, fonts and images come from the site only. The network is
 * open to https because the map tiles, the geocoder, GitHub and the AI
 * provider the user picks (any https endpoint, or a local server) are reached
 * from the page. The build fails if index.html has an inline script or a
 * reference to another origin.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "img-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DESCRIPTION =
  "Pin places on a map and keep them in your browser: tags, lists shared by link, Google Maps import, offline map, optional sync through your own private GitHub Gist. No account, no server, no API key.";

/** Hosts whose responses the service worker keeps for the map to work offline. */
export const TILE_HOST = "tiles.openfreemap.org";

/** The fonts, from @fontsource, served as files beside the page with their own stylesheet. */
export const FONTS: { family: string; weight: number; file: string }[] = [
  {
    family: "Barlow Condensed",
    weight: 600,
    file: "barlow-condensed/files/barlow-condensed-latin-600-normal.woff2",
  },
  {
    family: "Barlow Condensed",
    weight: 800,
    file: "barlow-condensed/files/barlow-condensed-latin-800-normal.woff2",
  },
  { family: "Figtree", weight: 400, file: "figtree/files/figtree-latin-400-normal.woff2" },
  { family: "Figtree", weight: 600, file: "figtree/files/figtree-latin-600-normal.woff2" },
  { family: "Figtree", weight: 700, file: "figtree/files/figtree-latin-700-normal.woff2" },
];

function fontName(f: { file: string }): string {
  return f.file.split("/").pop() ?? f.file;
}

export function fontsCss(): string {
  return FONTS.map(
    (f) =>
      `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-display:swap;src:url("./fonts/${fontName(f)}") format("woff2")}`,
  ).join("\n");
}

function headInject(): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    `<meta name="referrer" content="no-referrer" />`,
    `<meta name="color-scheme" content="light dark" />`,
    `<meta name="theme-color" content="#1f3fa8" />`,
    `<meta name="description" content="${DESCRIPTION}" />`,
    `<meta property="og:title" content="spots" />`,
    `<meta property="og:description" content="${DESCRIPTION}" />`,
    `<link rel="icon" href="./icon.svg" type="image/svg+xml" />`,
    `<link rel="manifest" href="./manifest.webmanifest" />`,
    ...["barlow-condensed-latin-800-normal.woff2", "figtree-latin-400-normal.woff2"].map(
      (f) => `<link rel="preload" href="./fonts/${f}" as="font" type="font/woff2" crossorigin />`,
    ),
    `<link rel="stylesheet" href="./fonts.css" />`,
  ].join("\n    ");
}

export interface BuildOptions {
  outdir?: string;
  minify?: boolean;
}

function fail(msg: string): never {
  throw new Error(`build: ${msg}`);
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out.sort();
}

/** Throws if the HTML has an inline script, inline handler, inline style or external URL. */
export function auditHtml(html: string, page = "index.html"): void {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (!/\bsrc\s*=/.test(attrs) || body.length > 0) fail(`inline <script> found in ${page}`);
  }
  if (/\son[a-z]+\s*=/i.test(html)) fail(`inline event handler found in ${page}`);
  if (/<style\b/i.test(html)) fail(`inline <style> found in ${page}`);
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)) {
    const url = m[1] ?? "";
    if (/^(?:[a-z]+:)?\/\//i.test(url)) fail(`external URL in ${page}: ${url}`);
    if (url.startsWith("/")) fail(`absolute path in ${page} (breaks the /spots/ base): ${url}`);
  }
}

/**
 * A service worker that precaches the given files (versioned by their content)
 * and keeps map responses: tiles cache-first in a capped cache, the style
 * documents network-first, and the areas the user asked to keep in a cache of
 * their own that is never trimmed.
 */
export function serviceWorker(files: string[], version: string): string {
  return `// Generated by scripts/build.ts: the app offline, and the map areas already seen.
const CACHE = "spots-${version}";
const TILES = "spots-tiles";
const KEPT = "spots-tiles-kept";
const MAX_TILES = 4000;
const FILES = ${JSON.stringify(["./", ...files.map((f) => `./${f}`)])};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("spots-") && k !== CACHE && k !== TILES && k !== KEPT).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
let trimming = null;
function trim() {
  trimming ??= caches.open(TILES).then(async (c) => {
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await c.delete(k);
  }).finally(() => { trimming = null; });
  return trimming;
}
async function tile(req) {
  const hit = (await caches.match(req, { cacheName: KEPT })) || (await caches.match(req, { cacheName: TILES }));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(TILES).then((c) => c.put(req, copy)).then(trim);
  }
  return res;
}
async function fresh(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(TILES).then((c) => c.put(req, copy));
    }
    return res;
  } catch (err) {
    const hit = (await caches.match(req, { cacheName: KEPT })) || (await caches.match(req, { cacheName: TILES }));
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.host === "${TILE_HOST}") {
    // Tile, glyph and sprite paths carry a version; the TileJSON and styles do not.
    const versioned = /\\/(planet|natural_earth)\\/[^/]+\\/\\d+\\/|\\/fonts\\/|\\/sprites\\//.test(url.pathname);
    e.respondWith(versioned ? tile(e.request) : fresh(e.request));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
// "Keep this area offline": the page sends tile URLs, the worker stores them and reports progress.
self.addEventListener("message", (e) => {
  const msg = e.data;
  const port = e.ports[0];
  if (!msg || msg.type !== "keep" || !port) return;
  e.waitUntil((async () => {
    const c = await caches.open(KEPT);
    let done = 0;
    let failed = 0;
    const queue = msg.urls.slice();
    async function worker() {
      while (queue.length) {
        const u = queue.shift();
        try {
          if (!(await c.match(u))) {
            const res = await fetch(u);
            if (res.ok) await c.put(u, res);
            else failed++;
          }
        } catch { failed++; }
        done++;
        if (done % 10 === 0 || done === msg.urls.length) port.postMessage({ done, failed, total: msg.urls.length });
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    port.postMessage({ done, failed, total: msg.urls.length, finished: true });
  })());
});
`;
}

export async function build(opts: BuildOptions = {}): Promise<{ outdir: string; files: string[] }> {
  const outdir = resolve(ROOT, opts.outdir ?? "dist");
  const minify = opts.minify ?? true;
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  // 1. The app. Heavy parts (AI, imports) are dynamic imports and land in their own chunks.
  const app = await Bun.build({
    entrypoints: [join(ROOT, "index.html")],
    outdir,
    minify,
    splitting: true,
    target: "browser",
    format: "esm",
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    define: { "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development") },
  });
  if (!app.success) {
    for (const log of app.logs) console.error(log);
    fail("app build failed");
  }

  // 2. Static files, the MapLibre worker (loaded as a module worker from the site) and the fonts.
  await mkdir(join(outdir, "fonts"), { recursive: true });
  for (const f of FONTS) {
    await cp(join(ROOT, "node_modules/@fontsource", f.file), join(outdir, "fonts", fontName(f)));
  }
  await writeFile(join(outdir, "fonts.css"), `${fontsCss()}\n`);
  await cp(join(ROOT, "public"), outdir, { recursive: true });
  await cp(
    join(ROOT, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"),
    join(outdir, "maplibre-gl-worker.mjs"),
  );

  // 3. Harden the page.
  const path = join(outdir, "index.html");
  let html = await readFile(path, "utf8");
  if (!/<meta charset="utf-8"\s*\/?>/i.test(html))
    fail("index.html must start with <meta charset>");
  html = html.replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1\n    ${headInject()}`);
  auditHtml(html);
  await writeFile(path, html);

  // 4. The service worker, over everything else (source maps excepted, and the AI model
  // catalog fallback, which only AI users download).
  const files = (await listFiles(outdir)).filter(
    (f) => f !== "index.html" && !f.endsWith(".map") && f !== "models.json",
  );
  const hash = createHash("sha256");
  for (const f of [...files, "index.html"]) hash.update(f).update(await readFile(join(outdir, f)));
  await writeFile(join(outdir, "sw.js"), serviceWorker(files, hash.digest("hex").slice(0, 12)));

  return { outdir, files: await listFiles(outdir) };
}

if (import.meta.main) {
  const started = performance.now();
  const res = await build({ minify: !process.argv.includes("--dev") });
  let bytes = 0;
  for (const f of res.files) bytes += (await stat(join(res.outdir, f))).size;
  console.log(
    `built ${res.files.length} files (${(bytes / 1024).toFixed(1)} KiB) in ${Math.round(performance.now() - started)} ms`,
  );
}
