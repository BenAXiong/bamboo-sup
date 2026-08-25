import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: that one roots itself in `viewer/` to
// build the page, which would otherwise hide the test suite from vitest.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
