import { defineConfig } from "vite";

// Public, phone-first models site (boats and houses), published at /models/.
export default defineConfig({
  root: "models",
  base: "./",
  server: { fs: { allow: [".."] }, host: true },
  build: {
    outDir: "../out/models",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
