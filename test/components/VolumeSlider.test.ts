/**
 * The per-member volume row in the voice member menu: a slider from 0 to 200 with the level read
 * out beside it. Above 100 the gain shows in colour. A double-click on the row, or a click on the
 * reading, puts the member back at 100; with headphones muted the row is inert.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";

const h = vi.hoisted(() => ({ setVolume: vi.fn(), headphoneMuted: false }));

vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => ({ setVolume: h.setVolume }) }));
vi.mock("@/store/system/systemStore", () => ({
  useSystemStore: () => ({ get headphoneMuted() { return h.headphoneMuted; } }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));

import { SliderRoot } from "reka-ui";
import VolumeSlider from "@/components/audio/VolumeSlider.vue";

const member = (volume: number) => reactive({ userId: "u1", volume: [volume] }) as any;
const reading = (w: ReturnType<typeof mount>) => w.get('[data-testid="member-volume-reading"]');

beforeEach(() => {
  h.setVolume.mockReset();
  h.headphoneMuted = false;
});

describe("VolumeSlider", () => {
  test("reads the level out beside the slider", () => {
    const w = mount(VolumeSlider, { props: { user: member(112) } });
    expect(reading(w).text()).toBe("112%");
    expect(w.findComponent(SliderRoot).props("modelValue")).toEqual([112]);
  });

  test.each([
    [0, "plain"],
    [100, "plain"],
    [101, "boost"],
    [170, "boost"],
    [171, "hot"],
    [200, "hot"],
  ])("at %i the row is in the %s zone", (level, zone) => {
    const w = mount(VolumeSlider, { props: { user: member(level) } });
    expect(w.classes()).toContain(`member-volume--${zone}`);
  });

  test("moving the slider sets the member's volume and keeps the row's own copy in step", () => {
    const user = member(100);
    const w = mount(VolumeSlider, { props: { user } });
    w.findComponent(SliderRoot).vm.$emit("update:modelValue", [140]);
    expect(h.setVolume).toHaveBeenCalledWith("u1", 140);
    expect(user.volume).toEqual([140]);
  });

  test("a double-click on the row puts the member back at 100", async () => {
    const user = member(150);
    const w = mount(VolumeSlider, { props: { user } });
    await w.trigger("dblclick");
    expect(h.setVolume).toHaveBeenCalledWith("u1", 100);
    expect(user.volume).toEqual([100]);
    expect(w.classes()).toContain("is-resetting");
  });

  test("so does a click on the reading", async () => {
    const w = mount(VolumeSlider, { props: { user: member(40) } });
    await reading(w).trigger("click");
    expect(h.setVolume).toHaveBeenCalledWith("u1", 100);
    expect(reading(w).attributes("title")).toBe("member_volume_reset");
  });

  test("with headphones muted the row is inert", async () => {
    h.headphoneMuted = true;
    const w = mount(VolumeSlider, { props: { user: member(150) } });
    expect(w.classes()).toContain("is-disabled");
    expect((reading(w).element as HTMLButtonElement).disabled).toBe(true);
    expect(w.findComponent(SliderRoot).props("disabled")).toBe(true);
    await w.trigger("dblclick");
    expect(h.setVolume).not.toHaveBeenCalled();
  });
});
