/**
 * The Announcement tab of the channel settings.
 *
 * The three switches go to the server as one SetAnnouncementSettings call carrying all three values
 * (it is not a patch), show author only means something with post as space, and a refusal puts the
 * switch back. Publishers are roles whose channel overwrite allows SendMessages: letting a role post
 * or stopping it touches only that bit, and an overwrite left saying nothing is deleted.
 *
 * The form controls from @argon/ui are replaced by plain stubs that emit what the real ones emit.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    setSettings: vi.fn(),
    getOverwrites: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    trackChannel: vi.fn(async () => {}),
    toast: vi.fn(),
    roles: [] as any[],
    spacePerms: new Set<string>(),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: { SetAnnouncementSettings: h.setSettings },
    archetypeInteraction: {
      GetChannelEntitlementOverwrites: h.getOverwrites,
      UpsertArchetypeEntitlementForChannel: h.upsert,
      DeleteEntitlementForChannel: h.remove,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
  cn: (...parts: unknown[]) => parts.flat().filter(Boolean).join(" "),
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ hasIn: () => true, hasInSpace: (_: string, flag: string) => h.spacePerms.has(flag) }),
}));
vi.mock("@/store/data/channelStore", () => ({ useChannelStore: () => ({ trackChannel: h.trackChannel }) }));
vi.mock("@/store/db/dexie", () => ({
  db: {
    archetypes: {
      where: () => ({
        equals: () => ({
          filter: (fn: (a: any) => boolean) => ({ toArray: async () => h.roles.filter(fn) }),
        }),
      }),
    },
  },
}));
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

import { ArgonEntitlement, ChannelType, UpdateChannelError } from "@argon/glue";
import ChannelAnnouncement from "@/components/settings/channels/ChannelAnnouncement.vue";

const SEND = BigInt(ArgonEntitlement.SendMessages);
const ATTACH = BigInt(ArgonEntitlement.AttachFiles);

const settings = (reactions = true, postAsSpace = false, showAuthor = true) => ({ reactions, postAsSpace, showAuthor });
const news = (announcement = settings()) =>
  ({ channelId: "c1", spaceId: "s1", name: "news", type: ChannelType.Announcement, announcement }) as any;

const ok = (row: any) => ({ isSuccessUpdateChannel: () => true, isFailedUpdateChannel: () => false, channel: row });
const refused = (error: UpdateChannelError) => ({ isSuccessUpdateChannel: () => false, isFailedUpdateChannel: () => true, error });

const role = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, spaceId: "s1", name: id, colour: 0xff0000, isHidden: false, isDefault: false, ...extra });
const overwrite = (archetypeId: string, allow: bigint, deny = 0n) =>
  ({ channelId: "c1", archetypeId, serverMemberId: null, allow, deny, creatorId: "u", id: `ow-${archetypeId}` });

async function render(row = news()) {
  const w = mount(ChannelAnnouncement, { props: { channel: row } });
  await flushPromises();
  return w;
}

const switchOf = (w: any, id: string) => w.get(`[data-testid=${id}]`);

beforeEach(() => {
  h.setSettings.mockReset();
  h.getOverwrites.mockReset().mockResolvedValue([]);
  h.upsert.mockReset();
  h.remove.mockReset();
  h.trackChannel.mockClear();
  h.toast.mockClear();
  h.roles = [role("everyone", { isDefault: true }), role("herald"), role("mods"), role("ghost", { isHidden: true })];
  h.spacePerms = new Set(["ManageChannels", "ManageArchetype"]);
});

describe("ChannelAnnouncement settings", () => {
  test("turning reactions off sends all three values and stores the answer", async () => {
    h.setSettings.mockResolvedValue(ok(news(settings(false))));
    const w = await render();

    await switchOf(w, "announcement-reactions").trigger("click");
    await flushPromises();

    expect(h.setSettings).toHaveBeenCalledWith("s1", "c1", false, false, true);
    expect(h.trackChannel).toHaveBeenCalledWith(expect.objectContaining({ announcement: settings(false) }));
    expect(switchOf(w, "announcement-reactions").attributes("aria-checked")).toBe("false");
  });

  test("show author waits for post as space", async () => {
    h.setSettings.mockResolvedValue(ok(news(settings(true, true, true))));
    const w = await render();

    expect(switchOf(w, "announcement-show-author").attributes("disabled")).toBeDefined();

    await switchOf(w, "announcement-post-as-space").trigger("click");
    await flushPromises();

    expect(h.setSettings).toHaveBeenCalledWith("s1", "c1", true, true, true);
    expect(switchOf(w, "announcement-show-author").attributes("disabled")).toBeUndefined();
  });

  test("a refusal puts the switch back and says why", async () => {
    h.setSettings.mockResolvedValue(refused(UpdateChannelError.INSUFFICIENT_PERMISSIONS));
    const w = await render();

    await switchOf(w, "announcement-reactions").trigger("click");
    await flushPromises();

    expect(switchOf(w, "announcement-reactions").attributes("aria-checked")).toBe("true");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "announcement_settings_failed", variant: "destructive" }));
    expect(h.trackChannel).not.toHaveBeenCalled();
  });

  test("a change made elsewhere shows up", async () => {
    const w = await render();
    await w.setProps({ channel: news(settings(false, true, false)) });

    expect(switchOf(w, "announcement-reactions").attributes("aria-checked")).toBe("false");
    expect(switchOf(w, "announcement-post-as-space").attributes("aria-checked")).toBe("true");
    expect(switchOf(w, "announcement-show-author").attributes("aria-checked")).toBe("false");
  });
});

describe("ChannelAnnouncement publishers", () => {
  test("lists the roles allowed to post and offers the others, never everyone or hidden roles", async () => {
    h.getOverwrites.mockResolvedValue([overwrite("herald", SEND), overwrite("everyone", 0n, SEND)]);
    const w = await render();

    expect(w.findAll("[data-publisher]").map((c) => c.attributes("data-publisher"))).toEqual(["herald"]);
    expect(w.findAll("[data-add-publisher]").map((c) => c.attributes("data-add-publisher"))).toEqual(["mods"]);
  });

  test("letting a role post allows SendMessages and keeps the rest of its overwrite", async () => {
    h.getOverwrites.mockResolvedValue([overwrite("mods", ATTACH, SEND)]);
    h.upsert.mockResolvedValue(overwrite("mods", ATTACH | SEND));
    const w = await render();

    await w.get("[data-add-publisher=mods]").trigger("click");
    await flushPromises();

    expect(h.upsert).toHaveBeenCalledWith("s1", "c1", "mods", 0n, ATTACH | SEND);
    expect(w.findAll("[data-publisher]").map((c) => c.attributes("data-publisher"))).toEqual(["mods"]);
  });

  test("stopping a role deletes an overwrite that only let it post", async () => {
    h.getOverwrites.mockResolvedValue([overwrite("herald", SEND)]);
    h.remove.mockResolvedValue(true);
    const w = await render();

    await w.get("[data-remove-publisher=herald]").trigger("click");
    await flushPromises();

    expect(h.remove).toHaveBeenCalledWith("s1", "c1", "ow-herald");
    expect(h.upsert).not.toHaveBeenCalled();
    expect(w.findAll("[data-publisher]")).toHaveLength(0);
    expect(w.find("[data-testid=announcement-no-publishers]").exists()).toBe(true);
  });

  test("stopping a role keeps an overwrite that still says something else", async () => {
    h.getOverwrites.mockResolvedValue([overwrite("herald", SEND | ATTACH)]);
    h.upsert.mockResolvedValue(overwrite("herald", ATTACH));
    const w = await render();

    await w.get("[data-remove-publisher=herald]").trigger("click");
    await flushPromises();

    expect(h.upsert).toHaveBeenCalledWith("s1", "c1", "herald", 0n, ATTACH);
    expect(h.remove).not.toHaveBeenCalled();
  });

  test("a refused change is reported and the list stays", async () => {
    h.getOverwrites.mockResolvedValue([]);
    h.upsert.mockResolvedValue(null);
    const w = await render();

    await w.get("[data-add-publisher=herald]").trigger("click");
    await flushPromises();

    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "announcement_publisher_failed" }));
    expect(w.findAll("[data-publisher]")).toHaveLength(0);
  });

  test("without ManageArchetype the list is read-only", async () => {
    h.spacePerms = new Set(["ManageChannels"]);
    h.getOverwrites.mockResolvedValue([overwrite("herald", SEND)]);
    const w = await render();

    expect(w.findAll("[data-publisher]")).toHaveLength(1);
    expect(w.find("[data-remove-publisher]").exists()).toBe(false);
    expect(w.find("[data-add-publisher]").exists()).toBe(false);
  });
});
