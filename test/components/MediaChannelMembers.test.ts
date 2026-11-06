import { afterEach, expect, test, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { nextTick } from "vue";

const state = await vi.hoisted(async () => {
  const { ref, reactive } = await import("vue");
  return { visible: ref(false), available: ref(true), activity: reactive({ isActive: false, isPopout: false }) };
});
vi.mock("@/composables/useMemberList", () => ({ useMemberList: () => ({
  visible: state.visible, available: state.available, toggle: () => { state.visible.value = !state.visible.value; },
}) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => ({}) }));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ getChannel: async () => ({ name: "Voice" }) }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => ({ playframeActive: true }) }));
vi.mock("@/store/features/playframeStore", () => ({ usePlayFrameActivity: () => state.activity }));
vi.mock("@/composables/useMediaLayout", async () => {
  const { ref } = await import("vue");
  return { useMediaLayout: () => ({ allUsers: ref([]), qualityConnection: ref("green") }) };
});
vi.mock("@/composables/useVideoTrackAttach", () => ({ useVideoTrackAttach: () => ({ setVideoRef() {} }) }));
vi.mock("@/components/home/views/ParticipantCard.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/calls/CallGrid.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/playframe/PlayFramePanel.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/PingDetailsPopup.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/MediaControls.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/media/RadioBanner.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/media/RadioControl.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/shared/EmptyStateArt.vue", () => ({ default: { render: () => null } }));

import MediaChannelView from "@/components/MediaChannelView.vue";

afterEach(() => {
  state.visible.value = false;
  state.available.value = true;
  state.activity.isActive = false;
});

test("voice members can be toggled in the normal view and during an activity; split view hides the toggle", async () => {
  const wrapper = shallowMount(MediaChannelView, { props: { selectedChannelId: "voice" } });
  try {
    const toggle = wrapper.get('[data-testid="toggle-member-list"]');
    expect(toggle.attributes("aria-pressed")).toBe("false");
    await toggle.trigger("click");
    expect(state.visible.value).toBe(true);
    expect(toggle.attributes("aria-pressed")).toBe("true");

    state.activity.isActive = true;
    await nextTick();
    expect(wrapper.get(".media-info-bar").attributes("style")).toContain("display: none");
    expect(toggle.isVisible()).toBe(true);
    await toggle.trigger("click");
    expect(state.visible.value).toBe(false);

    state.available.value = false;
    await nextTick();
    expect(wrapper.find('[data-testid="toggle-member-list"]').exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
