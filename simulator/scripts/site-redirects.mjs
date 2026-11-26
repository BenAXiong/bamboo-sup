// Writes tiny redirect pages: the home page goes to the public models site, and
// addresses that moved under /sim/ keep working: /desktop/ -> /sim/hut/, /raft/ -> /sim/raft/, /sup/ -> /sim/sup/.
// Usage: node scripts/site-redirects.mjs out/site
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "out/site";
const moves = { "": "models", desktop: "sim/hut", raft: "sim/raft", sup: "sim/sup" };
for (const [from, to] of Object.entries(moves)) {
  const target = from ? `../${to}/` : `./${to}/`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${from ? "Moved" : "Ciawolan"}</title>
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
</head><body><a href="${target}">${target}</a></body></html>
`;
  mkdirSync(join(out, from), { recursive: true });
  writeFileSync(join(out, from, "index.html"), html);
}
console.log("redirects written to", out);
