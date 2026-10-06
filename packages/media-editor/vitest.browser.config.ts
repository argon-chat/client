import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// What only a real browser answers: WebCodecs encoding and mediabunny muxing. Standalone like
// vitest.config.ts, so the package's tests still run outside the monorepo.
export default defineConfig({
  test: {
    name: "media-editor-browser",
    include: ["test/browser/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
