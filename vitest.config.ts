import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

/**
 * Standalone on purpose — vite.config.ts carries app-only concerns (dev https certs,
 * Sentry upload, devtools) that have no business running in tests. All tests need is
 * SFC compilation, the `@/` alias and a DOM.
 *
 * Scope is `test/` only: the workspace packages under packages/*\/test use bun:test
 * and are run by `bun test packages`.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
