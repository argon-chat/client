import { defineConfig } from "vitest/config";

// Standalone on purpose: this package is meant to survive being extracted into its own
// repository, so its tests must run without anything from the monorepo root.
export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
