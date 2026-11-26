import { defineConfig } from "vite";

// Phone-first viewer of the Amis house, published to GitHub Pages under /sim/hut-phone/.
export default defineConfig({
  root: "hut-mobile",
  base: "./",
  server: { fs: { allow: [".."] }, host: true },
  build: {
    outDir: "../out/site/sim/hut-phone",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
