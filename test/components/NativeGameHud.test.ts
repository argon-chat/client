import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import NativeGameHud from "@/components/overlays/NativeGameHud.vue";
import { hudVoice, hudChat, hudConfig, pushHudNotification } from "@/lib/shell/overlays";
import { defaultHudConfig } from "@/lib/overlay/layout";

beforeEach(() => { vi.stubGlobal("__VUE_DEVTOOLS_GLOBAL_HOOK__", { emit() {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); hudVoice.value = { inVoice: false, members: [] }; hudChat.value = []; hudConfig.value = null; });

describe("native game HUD", () => {
  test("renders speaking/muted members, chat and expiring toasts with native Vue elements", async () => {
    vi.useFakeTimers();
    const config = defaultHudConfig();
    config.notifications.durationMs = 500;
    config.notifications.maxStack = 1;
    config.chat.fadeAfterMs = 300;
    config.widgets.chat.visible = true;
    hudConfig.value = config;
    hudVoice.value = { inVoice: true, members: [{
      userId: "one", displayName: "Ada", avatarUrl: null, avatarColor: "#334455",
      isSpeaking: true, isMuted: true, isDeafened: false,
    }] };
    hudChat.value = [{ id: "m1", author: "Lin", authorColor: "#abcdef", text: "Ready" }];
    const wrapper = mount(NativeGameHud);
    expect(wrapper.text()).toContain("Ada");
    expect(wrapper.find(".hud-speaking").exists()).toBe(true);
    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.text()).toContain("Ready");
    expect(wrapper.find("canvas").exists()).toBe(false);
    pushHudNotification({ id: "n1", kind: "join", title: "Joined" });
    pushHudNotification({ id: "n2", kind: "dm", title: "New message" });
    await nextTick();
    expect(wrapper.text()).not.toContain("Joined");
    expect(wrapper.text()).toContain("New message");
    expect(vi.getTimerCount()).toBe(2); // One visible toast and one chat expiry.
    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.text()).not.toContain("Ready");
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.text()).not.toContain("New message");
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("unmount removes toast subscription and all active timers", async () => {
    vi.useFakeTimers();
    const wrapper = mount(NativeGameHud);
    pushHudNotification({ id: "n1", kind: "join", title: "Joined" });
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    pushHudNotification({ id: "n2", kind: "join", title: "Late" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
