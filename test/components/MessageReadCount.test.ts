/**
 * The "read by N" line under an announcement: shown to the post's author and to moderators only,
 * asked for when it scrolls into view or is hovered — the posts on screen together, in one call —
 * filled from the short-lived cache when another row already asked, and gone when the server has
 * no count for the post.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  getMany: vi.fn(),
  canManage: false,
  onVisible: [] as ((entries: { isIntersecting: boolean }[]) => void)[],
}));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInsightsInteraction: { GetReadCounts: h.getMany } }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => h.canManage }) }));
vi.mock("@vueuse/core", () => ({
  useIntersectionObserver: (_el: unknown, cb: (entries: { isIntersecting: boolean }[]) => void) => {
    h.onVisible.push(cb);
    return { stop() {} };
  },
}));

import MessageReadCount from "@/components/chats/MessageReadCount.vue";
import { READ_COUNT_BATCH_MS, clearReadCountCache } from "@/composables/useReadCount";

const context = { spaceId: "s1", channelId: "c1" };
const post = (sender: string, messageId = 1n) => ({ messageId, sender, channelId: "c1", spaceId: "s1" }) as any;

/** Every post asked about has 3 readers of 12, except those listed as having no count. */
function server(noCount: bigint[] = []) {
  h.getMany.mockImplementation(async (_s: string, _c: string, ids: bigint[]) =>
    ids.filter((id) => !noCount.includes(id)).map((messageId) => ({ messageId, readers: 3, members: 12 })),
  );
}

async function batch() {
  await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  clearReadCountCache();
  h.getMany.mockReset();
  server();
  h.canManage = false;
  h.onVisible = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageReadCount", () => {
  test("the author sees it once it is on screen", async () => {
    const wrapper = mount(MessageReadCount, { props: { message: post("me"), context } });
    expect(wrapper.get("[data-testid=read-count]").text()).toContain("read_by_loading");
    expect(h.getMany).not.toHaveBeenCalled();

    h.onVisible.at(-1)!([{ isIntersecting: true }]);
    await batch();

    expect(h.getMany).toHaveBeenCalledWith("s1", "c1", [1n]);
    expect(wrapper.text()).toContain('read_by:{"count":3}');
    expect(wrapper.get("[data-testid=read-count]").attributes("title")).toBe('read_by_of:{"count":3,"members":12}');
  });

  test("the posts that come on screen together are asked about in one call", async () => {
    const rows = [1n, 2n, 3n].map((id) => mount(MessageReadCount, { props: { message: post("me", id), context } }));
    for (const cb of h.onVisible) cb([{ isIntersecting: true }]);
    await batch();

    expect(h.getMany).toHaveBeenCalledTimes(1);
    expect(h.getMany).toHaveBeenCalledWith("s1", "c1", [1n, 2n, 3n]);
    for (const row of rows) expect(row.text()).toContain('read_by:{"count":3}');
  });

  test("a post the server has no count for (too few members, …) shows no line", async () => {
    server([4n]);
    const wrapper = mount(MessageReadCount, { props: { message: post("me", 4n), context } });

    h.onVisible.at(-1)!([{ isIntersecting: true }]);
    await batch();

    expect(wrapper.find("[data-testid=read-count]").exists()).toBe(false);
    // Another row for it, from the cache: no line, and no call.
    const again = mount(MessageReadCount, { props: { message: post("me", 4n), context } });
    expect(again.find("[data-testid=read-count]").exists()).toBe(false);
    expect(h.getMany).toHaveBeenCalledTimes(1);
  });

  test("someone else's post shows nothing to a plain member, and asks nothing", async () => {
    const wrapper = mount(MessageReadCount, { props: { message: post("them"), context } });
    h.onVisible.at(-1)?.([{ isIntersecting: true }]);
    await batch();

    expect(wrapper.find("[data-testid=read-count]").exists()).toBe(false);
    expect(h.getMany).not.toHaveBeenCalled();
  });

  test("a moderator sees it on anyone's post, and a hover asks too", async () => {
    h.canManage = true;
    const wrapper = mount(MessageReadCount, { props: { message: post("them", 2n), context } });

    await wrapper.get("[data-testid=read-count]").trigger("mouseenter");
    await batch();

    expect(h.getMany).toHaveBeenCalledWith("s1", "c1", [2n]);
    expect(wrapper.text()).toContain('read_by:{"count":3}');
  });

  test("a second row for the same post is filled from the cache", async () => {
    const first = mount(MessageReadCount, { props: { message: post("me", 5n), context } });
    await first.get("[data-testid=read-count]").trigger("mouseenter");
    await batch();

    const second = mount(MessageReadCount, { props: { message: post("me", 5n), context } });
    expect(second.text()).toContain('read_by:{"count":3}');

    await second.get("[data-testid=read-count]").trigger("mouseenter");
    await batch();
    expect(h.getMany).toHaveBeenCalledTimes(1);
  });
});
