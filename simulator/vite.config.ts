import { defineConfig } from "vite";

// The viewer is a thin shell around the headless model, so the project root is
// the viewer directory while sources stay where the tests expect them.
export default defineConfig({
  root: "viewer",
  base: "./",
  build: {
    outDir: "../out/viewer",
    emptyOutDir: true,
  },
});
