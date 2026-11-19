import { defineConfig } from "vite";

// The raft beauty scene is a separate page from the engineering viewer. It
// reads its spec from ../designs/rafts, so the dev server may serve the repo root.
export default defineConfig({
  root: "scene",
  base: "./",
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../out/scene",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
