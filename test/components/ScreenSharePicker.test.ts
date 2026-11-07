import { afterEach, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@argon/glue/native", () => ({ native: { hostProc: { getScreenSources: async () => [
  { id: "screen:7", name: "Display", thumbnailDataUrl: "", appIconDataUrl: null, displayId: "7" },
  { id: "window:42", name: "Music player", thumbnailDataUrl: "", appIconDataUrl: null, displayId: "7" },
] } } }));
vi.mock("@/lib/platform", () => ({ isWeb: false }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ isPremium: false }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => ({ ultimaActive: false }) }));
vi.mock("@argon/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const wrapper = defineComponent({ setup(_, { slots }) { return () => h("div", slots.default?.()); } });
  return { Dialog: wrapper, DialogContent: wrapper, DialogTitle: wrapper, DialogDescription: wrapper, DialogHeader: wrapper };
});
vi.mock("@argon/ui/button", () => ({ Button: { template: "<button><slot /></button>" } }));
vi.mock("@argon/ui/switch", () => ({ Switch: { template: "<span />" } }));
vi.mock("@/components/modals/BuyPremium.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/components/shared/EmptyStateArt.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/components/shared/TabTransition.vue", () => ({ default: { template: "<div><slot /></div>" } }));

import ScreenSharePicker from "@/components/ScreenSharePicker.vue";

let wrapper: VueWrapper | null = null;
afterEach(() => { wrapper?.unmount(); wrapper = null; });

test("the picker describes each audio scope and emits the selected window with audio enabled", async () => {
  wrapper = mount(ScreenSharePicker);
  (wrapper.vm as unknown as { request(): void }).request();
  await flushPromises();
  expect(wrapper.get(".sp-audio-title").text()).toBe("enable_system_sound");
  expect(wrapper.get(".sp-audio").attributes("title")).toBe("screencast_system_audio_description");
  await wrapper.findAll(".sp-tab")[1].trigger("click");
  await nextTick();
  expect(wrapper.get(".sp-audio-title").text()).toBe("enable_sound_from_window");
  expect(wrapper.get(".sp-audio").attributes("title")).toBe("screencast_window_audio_description");
  await wrapper.get(".sp-audio").trigger("click");
  await wrapper.get(".sp-card").trigger("dblclick");
  expect(wrapper.emitted("start")?.[0]?.[0]).toMatchObject({ deviceId: "window:42", systemAudio: "include" });
});
