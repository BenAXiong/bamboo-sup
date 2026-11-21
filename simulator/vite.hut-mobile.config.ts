import { defineConfig } from "vite";

// Phone-first viewer of the Amis house, published to GitHub Pages as the site root.
export default defineConfig({
  root: "hut-mobile",
  base: "./",
  server: { fs: { allow: [".."] }, host: true },
  build: {
    outDir: "../out/site",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
