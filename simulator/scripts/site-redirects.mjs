// Writes tiny redirect pages for the addresses that moved under /sim/, so old
// links and QR codes keep working: /desktop/ -> /sim/hut/, /raft/ -> /sim/raft/, /sup/ -> /sim/sup/.
// Usage: node scripts/site-redirects.mjs out/site
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "out/site";
const moves = { desktop: "sim/hut", raft: "sim/raft", sup: "sim/sup" };
for (const [from, to] of Object.entries(moves)) {
  const target = `../${to}/`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Moved</title>
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
</head><body><a href="${target}">${target}</a></body></html>
`;
  mkdirSync(join(out, from), { recursive: true });
  writeFileSync(join(out, from, "index.html"), html);
}
console.log("redirects written to", out);
