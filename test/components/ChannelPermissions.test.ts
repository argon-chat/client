/**
 * The Permissions tab saves as you click: a burst of clicks is one save, switching roles or closing
 * the sheet saves what is waiting, all-inherit removes the overwrite, and a refusal is shown.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  archetypes: [] as unknown[],
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    archetypeInteraction: {
      GetChannelEntitlementOverwrites: h.get,
      UpsertArchetypeEntitlementForChannel: h.upsert,
      DeleteEntitlementForChannel: h.remove,
    },
  }),
}));
vi.mock("@/store/db/dexie", () => ({
  db: {
    archetypes: {
      where: () => ({ equals: () => ({ filter: () => ({ toArray: async () => h.archetypes }) }) }),
    },
  },
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
  cn: (...parts: unknown[]) => parts.flat().filter(Boolean).join(" "),
}));

import ChannelPermissions from "@/components/settings/channels/ChannelPermissions.vue";

const channel = { spaceId: "s1", channelId: "c1", name: "general", type: 0 } as any;
const role = (id: string, name: string) => ({ id, spaceId: "s1", name, colour: 0, isHidden: false }) as any;
const overwrite = (archetypeId: string, allow: bigint, deny: bigint, id = `ow-${archetypeId}`) =>
  ({ channelId: "c1", archetypeId, serverMemberId: null, allow, deny, creatorId: "u1", id }) as any;

// The first two rows of the first group: ViewChannel and ReadHistory.
const VIEW = 1n;
const HISTORY = 2n;

async function open() {
  const wrapper = mount(ChannelPermissions, { props: { channel } });
  await flushPromises();
  return wrapper;
}

async function pick(wrapper: VueWrapper, index: number) {
  await wrapper.findAll("[data-testid=overwrite-role]")[index].trigger("click");
}

async function click(wrapper: VueWrapper, row: number, action: "inherit" | "allow" | "deny") {
  await wrapper.findAll("[data-testid=overwrite-flag]")[row].get(`[data-testid=overwrite-${action}]`).trigger("click");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const fn of [h.get, h.upsert, h.remove, h.toast]) fn.mockReset();
  h.archetypes = [role("r1", "Mods"), role("r2", "Guests")];
  h.get.mockResolvedValue([]);
  h.upsert.mockImplementation(async (_s, _c, archetypeId, deny, allow) => overwrite(archetypeId, allow, deny));
  h.remove.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChannelPermissions", () => {
  test("has no save button", async () => {
    const wrapper = await open();
    await pick(wrapper, 0);

    expect(wrapper.text()).not.toContain("save_changes");
  });

  test("a burst of clicks is saved once, after a short pause", async () => {
    const wrapper = await open();
    await pick(wrapper, 0);

    await click(wrapper, 0, "allow");
    await click(wrapper, 1, "deny");
    expect(h.upsert).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledWith("s1", "c1", "r1", HISTORY, VIEW);
  });

  test("switching roles saves what is waiting at once", async () => {
    const wrapper = await open();
    await pick(wrapper, 0);
    await click(wrapper, 0, "deny");

    await pick(wrapper, 1);
    await flushPromises();

    expect(h.upsert).toHaveBeenCalledWith("s1", "c1", "r1", VIEW, 0n);
  });

  test("closing the sheet saves what is waiting at once", async () => {
    const wrapper = await open();
    await pick(wrapper, 0);
    await click(wrapper, 0, "allow");

    wrapper.unmount();
    await flushPromises();

    expect(h.upsert).toHaveBeenCalledWith("s1", "c1", "r1", 0n, VIEW);
  });

  test("an overwrite saved earlier is shown when the role is picked", async () => {
    h.get.mockResolvedValue([overwrite("r1", VIEW, HISTORY)]);
    const wrapper = await open();
    await pick(wrapper, 0);

    const rows = wrapper.findAll("[data-testid=overwrite-flag]");
    expect(rows[0].get("[data-testid=overwrite-allow]").classes()).toContain("active-allow");
    expect(rows[1].get("[data-testid=overwrite-deny]").classes()).toContain("active-deny");
  });

  test("everything back on inherit removes the overwrite", async () => {
    h.get.mockResolvedValue([overwrite("r1", VIEW, 0n)]);
    const wrapper = await open();
    await pick(wrapper, 0);

    await click(wrapper, 0, "inherit");
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.remove).toHaveBeenCalledWith("s1", "c1", "ow-r1");
  });

  test("reset removes the overwrite right away", async () => {
    h.get.mockResolvedValue([overwrite("r1", VIEW, HISTORY)]);
    const wrapper = await open();
    await pick(wrapper, 0);

    await wrapper.get("[data-testid=overwrite-reset]").trigger("click");
    await flushPromises();

    expect(h.remove).toHaveBeenCalledWith("s1", "c1", "ow-r1");
    expect(wrapper.find("[data-testid=overwrite-reset]").exists()).toBe(false);
  });

  test("a refused save says so and shows what the server holds", async () => {
    h.get.mockResolvedValue([overwrite("r1", 0n, VIEW)]);
    h.upsert.mockResolvedValue(null);
    const wrapper = await open();
    await pick(wrapper, 0);

    await click(wrapper, 0, "allow");
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(h.toast).toHaveBeenCalledWith({ title: "fail_save", variant: "destructive" });
    const first = wrapper.findAll("[data-testid=overwrite-flag]")[0];
    expect(first.get("[data-testid=overwrite-deny]").classes()).toContain("active-deny");
  });
});
