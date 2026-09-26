/**
 * The Broadcast tab's form against the server's sparse patch.
 *
 * PatchBroadcastSettings leaves alone what it does not see and reads `maxTransmitSeconds: null`
 * as "no limit", so the tab must send exactly the fields the user touched: a change that arrives
 * from another admin lands in the untouched fields and is never sent back, an edit in progress is
 * not overwritten by it, and after a save the form is clean. The mode switch is its own call.
 *
 * The form controls from @argon/ui are replaced by plain stubs that emit what the real ones emit;
 * what is under test is the wiring behind them, not reka-ui.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { ref, reactive } = await import("vue");
  const { vi } = await import("vitest");
  return {
    patch: vi.fn(),
    setMode: vi.fn(),
    trackChannel: vi.fn(async () => {}),
    toast: vi.fn(),
    channels: ref<any[]>([]),
    groups: ref<any[]>([]),
    windows: reactive({ channelSettingsTab: "broadcast" as string }),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { PatchBroadcastSettings: h.patch, SetBroadcastMode: h.setMode } }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
// `cn` is what the real @argon/ui Label, Input and Button want from here.
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
  cn: (...parts: unknown[]) => parts.flat().filter(Boolean).join(" "),
}));
vi.mock("@/lib/audio/AudioManager", () => ({ audio: {} }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => true, hasInSpace: () => true }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ useActiveServerChannels: () => h.channels }) }));
vi.mock("@/store/data/channelStore", () => ({ useChannelStore: () => ({ trackChannel: h.trackChannel }) }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => h.windows }));
vi.mock("@/composables/useChannelGroups", () => ({
  useChannelGroups: () => ({ sortedGroups: h.groups, sortByFractionalIndex: (x: unknown[]) => x }),
}));
vi.mock("@/composables/useBroadcastOpenWarning", async () => {
  const { ref } = await import("vue");
  return { useBroadcastOpenWarning: () => ({ open: ref(false), refresh: async () => {} }) };
});
vi.mock("@/components/shared/WarningBanner.vue", () => ({ default: { name: "WarningBanner", setup: () => () => null } }));

// Plain stand-ins that emit what the real controls emit.
vi.mock("@argon/ui/switch", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    Switch: defineComponent({
      props: { checked: Boolean, disabled: Boolean },
      emits: ["update:checked"],
      setup: (p, { emit }) => () =>
        hh("button", {
          type: "button",
          role: "switch",
          "aria-checked": String(p.checked),
          disabled: p.disabled,
          onClick: () => emit("update:checked", !p.checked),
        }),
    }),
  };
});
vi.mock("@argon/ui/checkbox", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    Checkbox: defineComponent({
      props: { modelValue: Boolean, disabled: Boolean },
      emits: ["update:modelValue"],
      setup: (p, { emit }) => () =>
        hh("button", {
          type: "button",
          role: "checkbox",
          "aria-checked": String(p.modelValue),
          disabled: p.disabled,
          onClick: () => emit("update:modelValue", !p.modelValue),
        }),
    }),
  };
});
vi.mock("@argon/ui/slider", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    Slider: defineComponent({
      props: { modelValue: Array },
      emits: ["update:modelValue"],
      setup: (p, { emit }) => () =>
        hh("input", {
          type: "range",
          "data-slider": "",
          value: (p.modelValue as number[])?.[0],
          onInput: (e: Event) => emit("update:modelValue", [Number((e.target as HTMLInputElement).value)]),
        }),
    }),
  };
});
vi.mock("@argon/ui/select", async () => {
  const { defineComponent, h: hh, provide, inject } = await import("vue");
  const pass = (name: string) =>
    defineComponent({ name, setup: (_, { slots }) => () => hh("div", { class: `stub-${name}` }, slots.default?.()) });
  const Select = defineComponent({
    props: { modelValue: String },
    emits: ["update:modelValue"],
    setup(p, { slots, emit }) {
      provide("pick", (v: string) => emit("update:modelValue", v));
      return () => hh("div", { "data-select": p.modelValue }, slots.default?.());
    },
  });
  const SelectItem = defineComponent({
    props: { value: String },
    setup(p, { slots }) {
      const pick = inject<(v: string) => void>("pick")!;
      return () => hh("button", { type: "button", "data-option": p.value, onClick: () => pick(p.value!) }, slots.default?.());
    },
  });
  return { Select, SelectTrigger: pass("SelectTrigger"), SelectValue: pass("SelectValue"), SelectContent: pass("SelectContent"), SelectItem };
});

import { BroadcastOverlap, ChannelType, SetBroadcastSettingsError } from "@argon/glue";
import ChannelBroadcast from "@/components/settings/channels/ChannelBroadcast.vue";

const settings = () => ({ targets: ["p1"], overlap: BroadcastOverlap.MIX, duckingDb: -8, maxTransmitSeconds: 120, chirp: false });

const channel = (channelId: string, extra: Record<string, unknown> = {}) =>
  ({ channelId, spaceId: "s1", name: channelId, type: ChannelType.Voice, groupId: null, broadcast: null, ...extra }) as any;

const hq = () => channel("hq", { broadcast: settings() });

const ok = (row: any) => ({ isSuccessSetBroadcastSettings: () => true, isFailedSetBroadcastSettings: () => false, channel: row });
const refused = (error: SetBroadcastSettingsError) => ({
  isSuccessSetBroadcastSettings: () => false,
  isFailedSetBroadcastSettings: () => true,
  error,
});

async function render(row = hq()) {
  const w = mount(ChannelBroadcast, { props: { channel: row } });
  await nextTick();
  return w;
}

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

const byId = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`);
const saveButton = (w: ReturnType<typeof mount>) => byId(w, "broadcast-save");
const isChecked = (w: ReturnType<typeof mount>, id: string) => byId(w, id).attributes("aria-checked") === "true";

/** What the last save sent: (spaceId, channelId, patch). */
const sent = () => h.patch.mock.calls.at(-1);

beforeEach(() => {
  h.patch.mockReset();
  // The server answers with the row as patched, which is what a real save gets back.
  h.patch.mockImplementation(async (_space: string, _channel: string, patch: Record<string, unknown>) =>
    ok(channel("hq", { broadcast: { ...settings(), ...patch } })),
  );
  h.setMode.mockReset();
  h.trackChannel.mockClear();
  h.toast.mockClear();
  h.channels.value = [hq(), channel("p1"), channel("p2"), channel("other-hq", { broadcast: settings() }), channel("t1", { type: ChannelType.Text })];
  h.groups.value = [];
  h.windows.channelSettingsTab = "broadcast";
});

describe("the form and a change from elsewhere", () => {
  test("untouched, there is nothing to save", async () => {
    const w = await render();
    expect(saveButton(w).attributes("disabled")).toBeDefined();
  });

  test("a remote change lands in an untouched field while an edit is kept, and only the edit is sent", async () => {
    const w = await render();
    await byId(w, "broadcast-chirp").trigger("click");
    expect(isChecked(w, "broadcast-chirp")).toBe(true);
    expect(saveButton(w).attributes("disabled")).toBeUndefined();

    // Another admin changed the ducking meanwhile.
    await w.setProps({ channel: channel("hq", { broadcast: { ...settings(), duckingDb: -20 } }) });
    expect(w.text()).toContain("-20 dB");
    expect(isChecked(w, "broadcast-chirp")).toBe(true);

    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { chirp: true }]);
  });

  test("a remote change to the field being edited does not overwrite the edit", async () => {
    const w = await render();
    await w.find("[data-slider]").setValue("-30");
    expect(w.text()).toContain("-30 dB");

    await w.setProps({ channel: channel("hq", { broadcast: { ...settings(), duckingDb: -20 } }) });
    expect(w.text()).toContain("-30 dB");

    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { duckingDb: -30 }]);
  });

  test("a remote change that matches the edit leaves nothing to save", async () => {
    const w = await render();
    await byId(w, "broadcast-chirp").trigger("click");
    await w.setProps({ channel: channel("hq", { broadcast: { ...settings(), chirp: true } }) });
    expect(saveButton(w).attributes("disabled")).toBeDefined();
  });

  test("after a save the form is clean and takes what the server kept", async () => {
    const w = await render();
    await byId(w, "broadcast-chirp").trigger("click");
    await saveButton(w).trigger("click");
    await flush();

    expect(h.trackChannel).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith({ title: "broadcast_saved" });
    expect(saveButton(w).attributes("disabled")).toBeDefined();

    // Nothing touched any more: a later remote change lands everywhere.
    await w.setProps({ channel: channel("hq", { broadcast: { ...settings(), chirp: false } }) });
    expect(isChecked(w, "broadcast-chirp")).toBe(false);
  });

  test("reset drops the edits", async () => {
    const w = await render();
    await byId(w, "broadcast-chirp").trigger("click");
    const reset = w.findAll("button").find((b) => b.text() === "reset")!;
    await reset.trigger("click");
    expect(isChecked(w, "broadcast-chirp")).toBe(false);
    expect(saveButton(w).attributes("disabled")).toBeDefined();
  });
});

describe("what a save sends", () => {
  test("turning the limit off sends null for it and nothing else", async () => {
    const w = await render();
    await byId(w, "broadcast-limit").trigger("click");
    expect(byId(w, "broadcast-limit-seconds").exists()).toBe(false);

    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { maxTransmitSeconds: null }]);
  });

  test("turning the limit on sends the remembered number", async () => {
    const w = await render(channel("hq", { broadcast: { ...settings(), maxTransmitSeconds: null } }));
    expect(byId(w, "broadcast-limit-seconds").exists()).toBe(false);
    await byId(w, "broadcast-limit").trigger("click");

    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { maxTransmitSeconds: 120 }]);
  });

  test("the number is clamped on blur and sent as a number", async () => {
    const w = await render();
    const seconds = byId(w, "broadcast-limit-seconds");
    await seconds.setValue("5");
    await seconds.trigger("blur");
    expect((seconds.element as HTMLInputElement).value).toBe("10");

    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { maxTransmitSeconds: 10 }]);
  });

  test("overlap goes out as the enum", async () => {
    const w = await render();
    await w.find(`[data-option="${BroadcastOverlap.LOCK}"]`).trigger("click");
    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { overlap: BroadcastOverlap.LOCK }]);
  });

  test("a refused save says why and keeps the edit", async () => {
    h.patch.mockResolvedValue(refused(SetBroadcastSettingsError.INVALID_TARGET));
    const w = await render();
    await byId(w, "broadcast-chirp").trigger("click");
    await saveButton(w).trigger("click");
    await flush();

    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "broadcast_error_invalid_target" }),
    );
    expect(isChecked(w, "broadcast-chirp")).toBe(true);
    expect(h.trackChannel).not.toHaveBeenCalled();
  });
});

describe("targets", () => {
  test("lists the space's other voice channels; a broadcast channel is disabled with the hint", async () => {
    const w = await render();
    expect(w.find('[data-target="hq"]').exists()).toBe(false);
    expect(w.find('[data-target="t1"]').exists()).toBe(false);
    expect(w.find('[data-target="p1"] [role="checkbox"]').attributes("aria-checked")).toBe("true");
    expect(w.find('[data-target="p2"] [role="checkbox"]').attributes("aria-checked")).toBe("false");

    const other = w.find('[data-target="other-hq"]');
    expect(other.classes()).toContain("target-row--disabled");
    expect(other.text()).toContain("broadcast_is_broadcast_channel");
    expect(other.find('[role="checkbox"]').attributes("disabled")).toBeDefined();
  });

  test("ticking one sends the whole list", async () => {
    const w = await render();
    await w.find('[data-target="p2"] [role="checkbox"]').trigger("click");
    await saveButton(w).trigger("click");
    await flush();
    expect(sent()).toEqual(["s1", "hq", { targets: ["p1", "p2"] }]);
  });
});

describe("the mode switch", () => {
  test("talks to the server at once and takes the returned row", async () => {
    const w = await render();
    h.setMode.mockResolvedValue(ok(channel("hq", { broadcast: null })));
    await byId(w, "broadcast-mode").trigger("click");
    await flush();

    expect(h.setMode).toHaveBeenCalledWith("s1", "hq", false);
    expect(h.trackChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: "hq", broadcast: null }));
    expect(h.toast).toHaveBeenCalledWith({ title: "broadcast_mode_disabled" });
  });

  test("off, the form is not shown; on, it comes back with the server's values", async () => {
    const w = await render(channel("hq"));
    expect(byId(w, "broadcast-save").exists()).toBe(false);

    await w.setProps({ channel: channel("hq", { broadcast: { ...settings(), chirp: true } }) });
    expect(byId(w, "broadcast-save").exists()).toBe(true);
    expect(isChecked(w, "broadcast-chirp")).toBe(true);
    expect(saveButton(w).attributes("disabled")).toBeDefined();
  });

  test("a refusal is explained", async () => {
    const w = await render();
    h.setMode.mockResolvedValue(refused(SetBroadcastSettingsError.INSUFFICIENT_PERMISSIONS));
    await byId(w, "broadcast-mode").trigger("click");
    await flush();
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "broadcast_error_insufficient_permissions" }),
    );
    expect(h.trackChannel).not.toHaveBeenCalled();
  });
});
