import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Public, phone-first models site (boats and houses), published at /models/.
// Installable (manifest + service worker) and stamped with its build time.

/** Build time in Taiwan, "YYMMDD HHMM": the version shown on the home title. */
function buildStamp(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day} ${p.hour}${p.minute}`;
}
const VERSION = buildStamp();

/**
 * Writes sw.js with this build's version and every emitted file, so the whole
 * site is stored on the first visit and works offline afterwards. The page
 * itself is always asked from the network first, so a new deploy is picked up
 * as soon as there is a connection.
 */
function serviceWorker(): Plugin {
  return {
    name: "models-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      // Bundle output plus the files copied from models/public (icons, thumbnails, manifest).
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
      const pub = walk("models/public").map((f) => relative("models/public", f).split("\\").join("/"));
      const files = [...Object.keys(bundle), ...pub].filter((f) => !f.endsWith(".map"));
      const pre = ["./", ...files.filter((f) => f !== "index.html").map((f) => `./${f}`)];
      const src = `// Generated at build time (vite.models.config.ts). Version ${VERSION}.
const CACHE = "models-${VERSION.replace(" ", "-")}";
const PRECACHE = ${JSON.stringify(pre)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("models-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    // Page: network first (fresh deploys), stored copy when offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./", copy));
        return res;
      }).catch(() => caches.match("./")),
    );
    return;
  }
  // Files (hashed names never change): stored copy first, network otherwise.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source: src });
    },
  };
}

export default defineConfig({
  root: "models",
  base: "./",
  define: { __BUILD_VERSION__: JSON.stringify(VERSION) },
  plugins: [serviceWorker()],
  server: { fs: { allow: [".."] }, host: true },
  build: {
    outDir: "../out/models",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
