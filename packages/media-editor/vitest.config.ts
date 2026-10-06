import { defineConfig } from "vitest/config";

// Standalone on purpose: this package is meant to survive being extracted into its own
// repository, so its tests must run without anything from the monorepo root.
export default defineConfig({
  test: {
    name: "media-editor",
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    // Real-browser tests (WebCodecs, mediabunny) run in vitest.browser.config.ts.
    exclude: ["test/browser/**"],
    globals: false,
    restoreMocks: true,
  },
});
