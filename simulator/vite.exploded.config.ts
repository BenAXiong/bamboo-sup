import { defineConfig } from "vite";

// Exploded studio viewer of the raft, one assembly at a time. It
// reads its spec from ../designs/rafts, so the dev server may serve the repo root.
export default defineConfig({
  root: "exploded",
  base: "./",
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../out/exploded",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
