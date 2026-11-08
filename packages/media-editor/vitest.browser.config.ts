import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";

// What only a real browser answers: WebCodecs encoding and mediabunny muxing. Standalone like
// vitest.config.ts, so the package's tests still run outside the monorepo.
export default defineConfig({
  plugins: [vue()],
  test: {
    name: "media-editor-browser",
    include: ["test/browser/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    browser: {
      enabled: true,
      provider: playwright(),
      commands: {
        // Drive real OS pointer events: synthetic dispatch cannot exercise
        // browser pointer capture outside a slider's hitbox.
        async rangePointer({ page, frame }, phase: string, fraction = 0.5, dy = 0) {
          if (phase === "release") { await page.mouse.up(); return; }
          const track = (await frame()).locator(".range-input__track");
          const box = await track.boundingBox();
          if (!box) throw new Error("The range track is not laid out");
          await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2 + dy);
          if (phase === "down") await page.mouse.down();
          if (phase === "up") await page.mouse.up();
        },
      },
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
