import { defineConfig } from "vitest/config";

// Standalone on purpose: this package is meant to survive being extracted into its own
// repository, so its tests must run without anything from the monorepo root.
export default defineConfig({
  test: {
    name: "audio",
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/webaudio-globals.ts"],
    globals: false,
    restoreMocks: true,
  },
});
