/**
 * A render error shows the boundary's card: what happened, folded details that can be copied, and
 * Continue / Reload. A native panic from vue-native leaves the JS runtime dead, so the card says the
 * app stopped and offers no buttons (the host's own dialog restarts it).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => `T:${k}` }) }));
vi.mock("@argon/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
}));

import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";

function throwing(message: string) {
  return defineComponent({
    setup() {
      return () => {
        throw new Error(message);
      };
    },
  });
}

function mountWith(message: string) {
  return mount(ErrorBoundary, {
    slots: { default: () => h(throwing(message)) },
    // Rendered in place, so the card can be found on the wrapper.
    global: { stubs: { teleport: true } },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  test("a render error: title, folded details, Continue and Reload", async () => {
    const w = mountWith("boom in the channel list");
    await nextTick();
    expect(w.find(".eb-title").text()).toBe("T:error_boundary_title");
    expect(w.find(".eb-details").exists()).toBe(false);
    const buttons = w.findAll(".eb-actions button").map((b) => b.text());
    expect(buttons).toEqual(["T:error_boundary_continue", "T:error_boundary_reload"]);

    await w.find(".eb-details-toggle").trigger("click");
    expect(w.find(".eb-details-text").text()).toContain("boom in the channel list");
  });

  test("Copy puts the message and stack on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const w = mountWith("boom");
    await nextTick();
    await w.find(".eb-details-toggle").trigger("click");
    await w.find(".eb-copy").trigger("click");
    await nextTick();
    expect(writeText).toHaveBeenCalledOnce();
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("boom");
    await nextTick();
    expect(w.find(".eb-copy").text()).toBe("T:error_boundary_copied");
  });

  test("a native panic: the app stopped, and no button that could not run", async () => {
    const w = mountWith("native panic at crates\\gpui\\src\\app\\entity_map.rs:184:32: cannot read X");
    await nextTick();
    expect(w.find(".eb-title").text()).toBe("T:error_boundary_native_title");
    expect(w.find(".eb-actions").exists()).toBe(false);
    expect(w.find(".eb-details-toggle").exists()).toBe(false);
  });
});
