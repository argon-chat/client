/**
 * The "Follows" tab of the channel settings. An announcement channel lists who follows it and what
 * it follows; a text channel only what it follows. A follow can be ended from either end, from the
 * channel whose settings are open: the row goes once the server agrees, a refusal says why, and a
 * list that failed to load can be asked for again.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  return {
    getFollowers: vi.fn(),
    getFollowedSources: vi.fn(),
    removeFollow: vi.fn(),
    toast: vi.fn(),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelFollowInteraction: {
      GetFollowers: h.getFollowers,
      GetFollowedSources: h.getFollowedSources,
      RemoveFollow: h.removeFollow,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: { warn() {}, info() {}, error() {}, debug() {}, log() {} },
}));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => true, hasInSpace: () => true }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({}) }));
vi.mock("@/composables/useChannelGroups", () => ({ useChannelGroups: () => ({}) }));
vi.mock("@/components/ArgonAvatar.vue", () => ({ default: { name: "ArgonAvatar", setup: () => () => null } }));

import { ChannelType, FailedRemoveFollow, RemoveFollowError, SuccessRemoveFollow } from "@argon/glue";
import ChannelFollows from "@/components/settings/channels/ChannelFollows.vue";

const link = (followId: string, extra: Record<string, unknown> = {}) =>
  ({
    followId,
    sourceSpaceId: "src",
    sourceChannelId: `src-${followId}`,
    sourceSpaceName: `Source ${followId}`,
    sourceChannelName: `news-${followId}`,
    targetSpaceId: "dst",
    targetChannelId: `dst-${followId}`,
    targetSpaceName: `Target ${followId}`,
    targetChannelName: `updates-${followId}`,
    sourceSpaceAvatarFileId: null,
    targetSpaceAvatarFileId: null,
    ...extra,
  }) as any;

const channel = (type: ChannelType) => ({ channelId: "c1", spaceId: "s1", name: "c1", type }) as any;

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function render(type = ChannelType.Announcement) {
  const w = mount(ChannelFollows, { props: { channel: channel(type) } });
  await flush();
  return w;
}

const section = (w: ReturnType<typeof mount>, kind: "followers" | "following") => w.find(`[data-testid="follows-${kind}"]`);
const rowIds = (w: ReturnType<typeof mount>, kind: "followers" | "following") =>
  section(w, kind).findAll("[data-follow]").map((r) => r.attributes("data-follow"));

beforeEach(() => {
  h.getFollowers.mockReset();
  h.getFollowedSources.mockReset();
  h.removeFollow.mockReset();
  h.toast.mockReset();
  h.getFollowers.mockResolvedValue([link("f1"), link("f2")]);
  h.getFollowedSources.mockResolvedValue([link("f3")]);
});

describe("what is listed", () => {
  test("an announcement channel: its followers by target, and what it follows by source", async () => {
    const w = await render();

    expect(h.getFollowers).toHaveBeenCalledWith("s1", "c1");
    expect(h.getFollowedSources).toHaveBeenCalledWith("s1", "c1");
    expect(rowIds(w, "followers")).toEqual(["f1", "f2"]);
    expect(section(w, "followers").text()).toContain("Target f1");
    expect(section(w, "followers").text()).toContain("#updates-f1");
    expect(rowIds(w, "following")).toEqual(["f3"]);
    expect(section(w, "following").text()).toContain("Source f3");
    expect(section(w, "following").text()).toContain("#news-f3");
  });

  test("a text channel has no followers list and does not ask for one", async () => {
    const w = await render(ChannelType.Text);
    expect(section(w, "followers").exists()).toBe(false);
    expect(h.getFollowers).not.toHaveBeenCalled();
    expect(rowIds(w, "following")).toEqual(["f3"]);
  });

  test("an empty list says so", async () => {
    h.getFollowers.mockResolvedValue([]);
    const w = await render();
    expect(section(w, "followers").find('[data-testid="follows-empty"]').text()).toBe("channel_followers_empty");
  });

  test("a list that failed to load can be asked for again", async () => {
    h.getFollowedSources.mockRejectedValueOnce(new Error("offline"));
    const w = await render();
    const error = section(w, "following").find('[data-testid="follows-error"]');
    expect(error.exists()).toBe(true);

    await error.find("button").trigger("click");
    await flush();
    expect(h.getFollowedSources).toHaveBeenCalledTimes(2);
    expect(rowIds(w, "following")).toEqual(["f3"]);
  });
});

describe("ending a follow", () => {
  test("goes through the open channel and drops the row once the server agrees", async () => {
    h.removeFollow.mockResolvedValue(new SuccessRemoveFollow());
    const w = await render();

    await section(w, "followers").find('[data-follow="f2"] [data-testid="follow-remove"]').trigger("click");
    await flush();

    expect(h.removeFollow).toHaveBeenCalledWith("s1", "c1", "f2");
    expect(rowIds(w, "followers")).toEqual(["f1"]);
    expect(h.toast).not.toHaveBeenCalled();
  });

  test("unfollowing a source works the same way", async () => {
    h.removeFollow.mockResolvedValue(new FailedRemoveFollow(RemoveFollowError.FOLLOW_NOT_FOUND));
    const w = await render();

    await section(w, "following").find('[data-testid="follow-remove"]').trigger("click");
    await flush();

    expect(h.removeFollow).toHaveBeenCalledWith("s1", "c1", "f3");
    expect(rowIds(w, "following")).toEqual([]);
  });

  test("a refusal keeps the row and says why", async () => {
    h.removeFollow.mockResolvedValue(new FailedRemoveFollow(RemoveFollowError.INSUFFICIENT_PERMISSIONS));
    const w = await render();

    await section(w, "followers").find('[data-follow="f1"] [data-testid="follow-remove"]').trigger("click");
    await flush();

    expect(rowIds(w, "followers")).toEqual(["f1", "f2"]);
    expect(h.toast).toHaveBeenCalledWith({
      title: "follow_remove_failed",
      description: "follow_remove_error_no_permission",
      variant: "destructive",
    });
  });
});
