import { defineConfig } from "vite";

// Bamboo SUP designer: the board built with the raft generator, live controls
// and hydrostatics. Reads its spec from ../designs/sup, so the dev server may serve the repo root.
export default defineConfig({
  root: "sup",
  base: "./",
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../out/sup",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
