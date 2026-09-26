/**
 * The "read by N" line under an announcement: shown to the post's author and to moderators only,
 * asked for when it scrolls into view or is hovered, and filled from the short-lived cache when
 * another row already asked.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  canManage: false,
  onVisible: [] as ((entries: { isIntersecting: boolean }[]) => void)[],
}));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInsightsInteraction: { GetReadCount: h.get } }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => h.canManage }) }));
vi.mock("@vueuse/core", () => ({
  useIntersectionObserver: (_el: unknown, cb: (entries: { isIntersecting: boolean }[]) => void) => {
    h.onVisible.push(cb);
    return { stop() {} };
  },
}));

import { SuccessReadCount } from "@argon/glue";
import MessageReadCount from "@/components/chats/MessageReadCount.vue";
import { clearReadCountCache } from "@/composables/useReadCount";

const context = { spaceId: "s1", channelId: "c1" };
const post = (sender: string, messageId = 1n) => ({ messageId, sender, channelId: "c1", spaceId: "s1" }) as any;

beforeEach(() => {
  clearReadCountCache();
  h.get.mockReset();
  h.get.mockResolvedValue(new SuccessReadCount(3, 12));
  h.canManage = false;
  h.onVisible = [];
});

describe("MessageReadCount", () => {
  test("the author sees it once it is on screen", async () => {
    const wrapper = mount(MessageReadCount, { props: { message: post("me"), context } });
    expect(wrapper.get("[data-testid=read-count]").text()).toContain("read_by_loading");
    expect(h.get).not.toHaveBeenCalled();

    h.onVisible.at(-1)!([{ isIntersecting: true }]);
    await flushPromises();

    expect(h.get).toHaveBeenCalledWith("s1", "c1", 1n);
    expect(wrapper.text()).toContain('read_by:{"count":3}');
    expect(wrapper.get("[data-testid=read-count]").attributes("title")).toBe('read_by_of:{"count":3,"members":12}');
  });

  test("someone else's post shows nothing to a plain member, and asks nothing", async () => {
    const wrapper = mount(MessageReadCount, { props: { message: post("them"), context } });
    h.onVisible.at(-1)?.([{ isIntersecting: true }]);
    await flushPromises();

    expect(wrapper.find("[data-testid=read-count]").exists()).toBe(false);
    expect(h.get).not.toHaveBeenCalled();
  });

  test("a moderator sees it on anyone's post, and a hover asks too", async () => {
    h.canManage = true;
    const wrapper = mount(MessageReadCount, { props: { message: post("them", 2n), context } });

    await wrapper.get("[data-testid=read-count]").trigger("mouseenter");
    await flushPromises();

    expect(h.get).toHaveBeenCalledWith("s1", "c1", 2n);
    expect(wrapper.text()).toContain('read_by:{"count":3}');
  });

  test("a second row for the same post is filled from the cache", async () => {
    const first = mount(MessageReadCount, { props: { message: post("me", 5n), context } });
    await first.get("[data-testid=read-count]").trigger("mouseenter");
    await flushPromises();

    const second = mount(MessageReadCount, { props: { message: post("me", 5n), context } });
    expect(second.text()).toContain('read_by:{"count":3}');

    await second.get("[data-testid=read-count]").trigger("mouseenter");
    await flushPromises();
    expect(h.get).toHaveBeenCalledTimes(1);
  });
});
