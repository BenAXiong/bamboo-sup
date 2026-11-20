import { defineConfig } from "vite";

// Exploded studio viewer of the small Amis thatched house. It reads its spec
// from ../designs/huts, so the dev server may serve the repo root.
export default defineConfig({
  root: "hut",
  base: "./",
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../out/hut",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
