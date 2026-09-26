/**
 * The space setting that picks the main announcement channel: none, or one of the space's
 * announcement channels. The server refuses anything else and the picker puts itself back when it
 * does; the overview shows it only to members with ManageServer.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    channels: reactive(new Map<string, any>()),
    setMain: vi.fn(),
    updateServer: vi.fn(async () => 1),
    toast: vi.fn(),
    granted: new Set<string>(),
    space: ref<any>(null),
  };
});

type Row = Record<string, any>;
const collection = (rows: () => Row[]) => ({
  filter: (fn: (r: Row) => boolean) => collection(() => rows().filter(fn)),
  toArray: async () => rows(),
  first: async () => rows()[0],
});

vi.mock("@/store/db/dexie", () => ({
  db: {
    channels: {
      where: (field: string) => ({
        equals: (value: unknown) => {
          const snapshot = [...h.channels.values()].filter((c) => c[field] === value);
          return collection(() => snapshot);
        },
      }),
    },
    servers: {
      update: h.updateServer,
      where: () => ({ equals: () => ({ first: async () => h.space.value }) }),
    },
  },
}));
vi.mock("@/composables/useLiveQuery", async () => {
  const { ref, watchEffect } = await import("vue");
  return {
    useLiveQuery: (fn: () => unknown) => {
      const result = ref<unknown>();
      watchEffect(() => {
        void Promise.resolve(fn()).then((v) => (result.value = v));
      });
      return result;
    },
  };
});
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    spaceAnnouncementInteraction: { SetMainAnnouncementChannel: h.setMain },
    serverInteraction: {
      GetSpaceStats: async () => null,
      GetSpaceDeletionState: async () => null,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} }, cn: (...c: unknown[]) => c.filter(Boolean).join(" ") }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ has: (flag: string) => h.granted.has(flag) }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ selectedServer: "s1", loadServerDetails: async () => {} }) }));
vi.mock("@/store/data/serverStore", () => ({
  useSpaceStore: () => ({ deletionStateOf: () => null, setDeletionState: () => {} }),
}));

// A select that is always open: options are clickable rows, the trigger shows the chosen value.
vi.mock("@argon/ui/select", async () => {
  const { h: hh, defineComponent, provide, inject } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => hh("div", slots.default?.()) });
  const Select = defineComponent({
    name: "Select",
    props: { modelValue: String, disabled: Boolean },
    emits: ["update:modelValue"],
    setup(props, { slots, emit }) {
      provide("choose", (v: string) => { if (!props.disabled) emit("update:modelValue", v); });
      return () => hh("div", { class: "stub-select", "data-value": props.modelValue, "data-disabled": props.disabled || undefined }, slots.default?.());
    },
  });
  const SelectItem = defineComponent({
    name: "SelectItem",
    props: { value: String },
    setup(props, { slots }) {
      const choose = inject<(v: string) => void>("choose")!;
      return () => hh("div", { class: "stub-option", "data-option": props.value, onClick: () => choose(props.value!) }, slots.default?.());
    },
  });
  return {
    Select,
    SelectItem,
    SelectContent: pass("SelectContent"),
    SelectGroup: pass("SelectGroup"),
    SelectTrigger: pass("SelectTrigger"),
    SelectValue: pass("SelectValue"),
  };
});

import { ChannelType, FailedSetMainAnnouncementChannel, SetMainAnnouncementChannelError, SuccessSetMainAnnouncementChannel } from "@argon/glue";
import MainAnnouncementPicker from "@/components/settings/spaces/MainAnnouncementPicker.vue";
import ServerProfile from "@/components/settings/spaces/ServerProfile.vue";

const add = (channelId: string, name: string, type = ChannelType.Announcement, spaceId = "s1") =>
  h.channels.set(channelId, { channelId, name, type, spaceId });

async function render(current: string | null = null) {
  const w = mount(MainAnnouncementPicker, { props: { spaceId: "s1", current } });
  await flushPromises();
  return w;
}

const options = (w: ReturnType<typeof mount>) => w.findAll(".stub-option").map((o) => o.attributes("data-option"));
const selected = (w: ReturnType<typeof mount>) => w.find(".stub-select").attributes("data-value");

beforeEach(() => {
  h.channels.clear();
  h.setMain.mockReset();
  h.updateServer.mockClear();
  h.toast.mockReset();
  h.granted = new Set();
  h.space.value = null;
  add("news", "news");
  add("patch", "patch-notes");
  add("general", "general", ChannelType.Text);
  add("voice", "lounge", ChannelType.Voice);
  add("elsewhere", "their-news", ChannelType.Announcement, "s2");
});

describe("the main announcement channel picker", () => {
  test("offers none and this space's announcement channels only", async () => {
    const w = await render();

    expect(options(w)).toEqual(["none", "news", "patch"]);
    expect(selected(w)).toBe("none");
    expect(w.text()).toContain("main_announcement_channel_desc");
  });

  test("shows the stored choice", async () => {
    expect(selected(await render("patch"))).toBe("patch");
  });

  test("says how to get a choice when the space has no announcement channel", async () => {
    h.channels.clear();
    const w = await render();

    expect(options(w)).toEqual(["none"]);
    expect(w.text()).toContain("main_announcement_channel_empty");
  });

  test("picking a channel sets it, stores it and says so", async () => {
    h.setMain.mockResolvedValue(new SuccessSetMainAnnouncementChannel("news"));
    const w = await render();

    await w.find('[data-option="news"]').trigger("click");
    await flushPromises();

    expect(h.setMain).toHaveBeenCalledWith("s1", "news");
    expect(h.updateServer).toHaveBeenCalledWith("s1", { mainAnnouncementChannelId: "news" });
    expect(selected(w)).toBe("news");
    expect(h.toast).toHaveBeenCalledWith({ title: "main_announcement_channel_saved" });
  });

  test("none clears it", async () => {
    h.setMain.mockResolvedValue(new SuccessSetMainAnnouncementChannel(null));
    const w = await render("news");

    await w.find('[data-option="none"]').trigger("click");
    await flushPromises();

    expect(h.setMain).toHaveBeenCalledWith("s1", null);
    expect(h.updateServer).toHaveBeenCalledWith("s1", { mainAnnouncementChannelId: null });
  });

  test("picking what is already set sends nothing", async () => {
    const w = await render("news");

    await w.find('[data-option="news"]').trigger("click");

    expect(h.setMain).not.toHaveBeenCalled();
  });

  test("a refusal puts the picker back and says why", async () => {
    h.setMain.mockResolvedValue(new FailedSetMainAnnouncementChannel(SetMainAnnouncementChannelError.NOT_ANNOUNCEMENT_CHANNEL));
    const w = await render("news");

    await w.find('[data-option="patch"]').trigger("click");
    await flushPromises();

    expect(selected(w)).toBe("news");
    expect(h.updateServer).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "main_announcement_channel_gone",
      variant: "destructive",
    }));
  });

  test("a failed call puts the picker back", async () => {
    h.setMain.mockRejectedValue(new Error("offline"));
    const w = await render();

    await w.find('[data-option="patch"]').trigger("click");
    await flushPromises();

    expect(selected(w)).toBe("none");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  test("follows a change made elsewhere", async () => {
    const w = await render("news");

    await w.setProps({ current: null });

    expect(selected(w)).toBe("none");
  });
});

describe("the space overview", () => {
  const overview = async () => {
    h.space.value = { spaceId: "s1", name: "Space", boostCount: 0, boostLevel: 0, mainAnnouncementChannelId: "news" };
    const w = shallowMount(ServerProfile);
    await flushPromises();
    return w;
  };

  test("shows the picker to a member with ManageServer, with the stored choice", async () => {
    h.granted = new Set(["ManageServer"]);
    const picker = (await overview()).findComponent(MainAnnouncementPicker);

    expect(picker.exists()).toBe(true);
    expect(picker.props()).toEqual({ spaceId: "s1", current: "news" });
  });

  test("leaves it out for everyone else", async () => {
    expect((await overview()).findComponent(MainAnnouncementPicker).exists()).toBe(false);
  });
});
