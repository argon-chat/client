/**
 * Creating a broadcast channel is two calls: the voice channel, then the mode. The channel exists
 * as soon as the first returns, so a refused second call must not look like a failed creation:
 * the dialog closes, the refusal is a toast, and the settings open on the Broadcast tab where the
 * switch can be tried again. An ordinary channel takes the old single call and opens nothing.
 * An announcement channel can name the roles that post in it, which become Allow overwrites.
 * A creation the server refuses is a toast, and the dialog stays open.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    addBroadcast: vi.fn(),
    addChannel: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true, channelId: "new" })),
    openSettings: vi.fn(),
    toast: vi.fn(),
    close: vi.fn(),
    upsert: vi.fn(async () => ({ id: "ow" }) as unknown),
    granted: new Set<string>(["ManageArchetype"]),
    roles: [] as { id: string; name: string; isHidden: boolean; isDefault: boolean }[],
  };
});

vi.mock("@/store/data/serverStore", () => ({
  useSpaceStore: () => ({ addBroadcastChannel: h.addBroadcast, addChannelToServer: h.addChannel }),
}));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openChannelSettings: h.openSettings }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ archetypeInteraction: { UpsertArchetypeEntitlementForChannel: h.upsert } }),
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ hasInSpace: (_spaceId: string, flag: string) => h.granted.has(flag) }),
}));
vi.mock("@/store/db/dexie", () => ({
  db: {
    archetypes: {
      where: () => ({
        equals: () => ({
          filter: (keep: (a: unknown) => boolean) => ({ toArray: async () => h.roles.filter(keep) }),
        }),
      }),
    },
  },
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
// `cn` is what the real @argon/ui Label and Button want from here.
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
  cn: (...parts: unknown[]) => parts.flat().filter(Boolean).join(" "),
}));
// The dialog chrome is not under test: its default slot gets a `close` the form calls when done.
vi.mock("@argon/ui/dialog", async () => {
  const { defineComponent, h: hh } = await import("vue");
  const pass = (name: string) =>
    defineComponent({ name, setup: (_, { slots }) => () => hh("div", { class: `stub-${name}` }, slots.default?.()) });
  return {
    Dialog: defineComponent({
      props: { open: Boolean },
      setup: (_, { slots }) => () => hh("div", { class: "stub-Dialog" }, slots.default?.({ close: h.close })),
    }),
    DialogContent: pass("DialogContent"),
    DialogTitle: pass("DialogTitle"),
  };
});
vi.mock("@/components/shared/InputWithError.vue", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    default: defineComponent({
      props: { modelValue: String, error: String },
      emits: ["update:modelValue", "clear-error"],
      setup: (p, { emit }) => () =>
        hh("div", [
          hh("input", {
            "data-name": "",
            value: p.modelValue,
            onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
          }),
          hh("span", { "data-error": "" }, p.error),
        ]),
    }),
  };
});

import { ArgonEntitlement, ChannelLayoutError, ChannelType, SetBroadcastSettingsError } from "@argon/glue";
import AddChannel from "@/components/modals/AddChannel.vue";

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

function render() {
  return mount(AddChannel, { props: { open: true, selectedSpace: "s1", groupId: null } });
}

const typeButton = (w: ReturnType<typeof render>, key: string) =>
  w.findAll("button").find((b) => b.text().includes(key))!;
const submit = (w: ReturnType<typeof render>) => w.findAll("button").find((b) => b.text() === "add_channel")!;

async function fillAndPick(w: ReturnType<typeof render>, name: string, type: string) {
  await w.find("[data-name]").setValue(name);
  await typeButton(w, type).trigger("click");
}

beforeEach(() => {
  h.addBroadcast.mockReset();
  h.addChannel.mockClear();
  h.openSettings.mockClear();
  h.toast.mockClear();
  h.close.mockClear();
  h.upsert.mockReset();
  h.upsert.mockImplementation(async () => ({ id: "ow" }));
  h.granted = new Set(["ManageArchetype"]);
  h.roles = [
    { id: "heralds", name: "Heralds", isHidden: false, isDefault: false },
    { id: "everyone", name: "everyone", isHidden: false, isDefault: true },
    { id: "owner", name: "owner", isHidden: true, isDefault: false },
  ];
});

describe("a broadcast channel", () => {
  test("is offered as a type of its own", () => {
    const w = render();
    expect(typeButton(w, "channel_type_broadcast")).toBeDefined();
    expect(w.text()).toContain("channel_type_broadcast_desc");
  });

  test("when the mode is refused, the channel is kept, the refusal is a toast, and the settings open", async () => {
    h.addBroadcast.mockResolvedValue({ ok: true, channelId: "new", error: SetBroadcastSettingsError.INVALID_TARGET });
    const w = render();
    await fillAndPick(w, "Raid HQ", "channel_type_broadcast");
    await submit(w).trigger("click");
    await flush();

    expect(h.addBroadcast).toHaveBeenCalledWith("s1", "Raid HQ", null);
    expect(h.addChannel).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "broadcast_enable_failed", description: "broadcast_error_invalid_target", variant: "destructive" }),
    );
    expect(h.openSettings).toHaveBeenCalledWith("s1", "new", "broadcast");
    // Not shown as a creation error: the channel exists.
    expect(w.find("[data-error]").text()).toBe("");
  });

  test("when the mode goes on, the settings open on the Broadcast tab without a toast", async () => {
    h.addBroadcast.mockResolvedValue({ ok: true, channelId: "new", error: null });
    const w = render();
    await fillAndPick(w, "Raid HQ", "channel_type_broadcast");
    await submit(w).trigger("click");
    await flush();

    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.openSettings).toHaveBeenCalledWith("s1", "new", "broadcast");
  });

  test("a refused creation is a toast; the dialog stays and nothing opens", async () => {
    h.addBroadcast.mockResolvedValue({ ok: false, refused: ChannelLayoutError.NO_PERMISSION });
    const w = render();
    await fillAndPick(w, "Raid HQ", "channel_type_broadcast");
    await submit(w).trigger("click");
    await flush();

    expect(h.close).not.toHaveBeenCalled();
    expect(h.openSettings).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "channel_create_failed", description: "channel_error_no_permission", variant: "destructive" }),
    );
  });

  test("a failed creation stays in the dialog as an error", async () => {
    h.addBroadcast.mockRejectedValue(new Error("offline"));
    const w = render();
    await fillAndPick(w, "Raid HQ", "channel_type_broadcast");
    await submit(w).trigger("click");
    await flush();

    expect(h.close).not.toHaveBeenCalled();
    expect(h.openSettings).not.toHaveBeenCalled();
    expect(w.find("[data-error]").text()).toContain("offline");
  });
});

describe("an ordinary channel", () => {
  test("takes the single call and opens nothing", async () => {
    const w = render();
    await fillAndPick(w, "Party", "channel_type_voice");
    await submit(w).trigger("click");
    await flush();

    expect(h.addChannel).toHaveBeenCalledWith("s1", "Party", ChannelType.Voice, null);
    expect(h.addBroadcast).not.toHaveBeenCalled();
    expect(h.openSettings).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  test("a refused creation is a toast and the dialog stays", async () => {
    h.addChannel.mockResolvedValueOnce({ ok: false, refused: ChannelLayoutError.INVALID_DATA });
    const w = render();
    await fillAndPick(w, "Party", "channel_type_voice");
    await submit(w).trigger("click");
    await flush();

    expect(h.close).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "channel_create_failed", description: "channel_layout_error_invalid", variant: "destructive" }),
    );
    expect(w.find("[data-error]").text()).toBe("");
  });

  test("an empty name is refused before any call", async () => {
    const w = render();
    await typeButton(w, "channel_type_broadcast").trigger("click");
    await submit(w).trigger("click");
    await flush();

    expect(h.addBroadcast).not.toHaveBeenCalled();
    expect(w.find("[data-error]").text()).toBe("channel_name_required");
  });
});

describe("an announcement channel", () => {
  const roleChip = (w: ReturnType<typeof render>, name: string) =>
    w.find('[data-testid="publisher-roles"]').findAll("button").find((b) => b.text() === name);

  test("offers the space's own roles as publishers, not everyone and not hidden ones", async () => {
    const w = render();
    await fillAndPick(w, "News", "channel_type_announcement");
    await flush();

    const chips = w.find('[data-testid="publisher-roles"]').findAll("button").map((b) => b.text());
    expect(chips).toEqual(["Heralds"]);
  });

  test("each picked role is allowed to post once the channel exists", async () => {
    const w = render();
    await fillAndPick(w, "News", "channel_type_announcement");
    await flush();
    await roleChip(w, "Heralds")!.trigger("click");
    await submit(w).trigger("click");
    await flush();

    expect(h.addChannel).toHaveBeenCalledWith("s1", "News", ChannelType.Announcement, null);
    expect(h.upsert).toHaveBeenCalledWith("s1", "new", "heralds", ArgonEntitlement.None, ArgonEntitlement.SendMessages);
    expect(h.toast).not.toHaveBeenCalled();
  });

  test("a role the server would not allow is a toast; the channel stays", async () => {
    h.upsert.mockResolvedValue(null);
    const w = render();
    await fillAndPick(w, "News", "channel_type_announcement");
    await flush();
    await roleChip(w, "Heralds")!.trigger("click");
    await submit(w).trigger("click");
    await flush();

    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "announcement_publishers_failed", variant: "destructive" }));
  });

  test("without ManageArchetype there is no picker and no overwrite", async () => {
    h.granted = new Set();
    const w = render();
    await fillAndPick(w, "News", "channel_type_announcement");
    await flush();

    expect(w.find('[data-testid="publisher-roles"]').exists()).toBe(false);
    await submit(w).trigger("click");
    await flush();
    expect(h.addChannel).toHaveBeenCalledTimes(1);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
