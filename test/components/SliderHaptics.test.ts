import { mount } from "@vue/test-utils";
import { afterAll, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  trigger: vi.fn(),
  perform: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("vue", async importOriginal => ({ ...await importOriginal<typeof import("vue")>(), appHaptics: api }));
vi.stubEnv("SK", "true");
afterAll(() => vi.unstubAllEnvs());

test("a keyboard step and its endpoint each request one cue on the Reka slider", async () => {
  const { Slider } = await import("@argon/ui/slider");
  const wrapper = mount(Slider, { props: { modelValue: [1], min: 0, max: 3 } });
  try {
    const thumb = wrapper.get('[role="slider"]');
    const control = wrapper.get(".argon-slider").element;
    await thumb.trigger("keydown", { key: "ArrowRight" });
    await wrapper.setProps({ modelValue: [2] });
    await thumb.trigger("keydown", { key: "End" });
    expect(api.trigger.mock.calls).toEqual([
      [control, "step", undefined],
      [control, "boundary", undefined],
    ]);
  } finally {
    wrapper.unmount();
  }
});

test("an accepted pen texture stops on its originating pointer", async () => {
  const { startPenFeedback } = await import("@argon/ui/haptics");
  api.perform.mockReturnValue(true);
  expect(startPenFeedback(new PointerEvent("pointerdown", { pointerType: "mouse" }), "ink-continuous")).toBeUndefined();
  const stop = startPenFeedback(new PointerEvent("pointerdown", { pointerType: "pen", pointerId: 2 }), "eraser-continuous");
  expect(api.perform.mock.calls).toEqual([["eraser-continuous", { pointerId: 2, fallback: false }]]);
  stop?.();
  expect(api.stop.mock.calls).toEqual([[2]]);
  api.perform.mockReturnValue(false);
  expect(startPenFeedback(new PointerEvent("pointerdown", { pointerType: "pen", pointerId: 2 }), "brush-continuous")).toBeUndefined();
  expect(api.perform).toHaveBeenLastCalledWith("brush-continuous", { pointerId: 2, fallback: "ink-continuous" });
});
