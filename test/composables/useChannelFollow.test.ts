/**
 * Following announcement channels and publishing to the followers.
 *
 * The follow dialog offers only what the server would accept: the user's spaces where they manage
 * channels and, in the picked one, the text and announcement channels they manage there, never the
 * channel being followed. Every refusal the server can give reads as its own message. "Publish to
 * followers" is offered once per announcement, to its author or a ManageMessages holder, and never
 * on a crosspost or a system message. A crosspost renders without its author, who is usually not a
 * member of the receiving space.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { effectScope, nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    follow: vi.fn(),
    publish: vi.fn(),
    getFollowers: vi.fn(),
    getFollowedSources: vi.fn(),
    removeFollow: vi.fn(),
    toast: vi.fn(),
    spaces: ref<any[]>([]),
    channelsBySpace: {} as Record<string, any[]>,
    groups: ref<any[]>([]),
    manageSpaces: new Set<string>(),
    manageChannels: new Set<string>(),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelFollowInteraction: {
      FollowChannel: h.follow,
      PublishMessage: h.publish,
      GetFollowers: h.getFollowers,
      GetFollowedSources: h.getFollowedSources,
      RemoveFollow: h.removeFollow,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {}, debug() {} } }));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    hasInSpace: (spaceId: string, flag: string) => flag === "ManageChannels" && h.manageSpaces.has(spaceId),
    hasIn: (channelId: string, flag: string) => flag === "ManageChannels" && h.manageChannels.has(channelId),
  }),
}));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      useAllServers: () => h.spaces,
      useActiveServerChannels: (spaceId: { value: string | null }) =>
        computed(() => (spaceId.value ? h.channelsBySpace[spaceId.value] ?? [] : [])),
      getUserReactive: () => ({ value: null }),
    }),
  };
});
vi.mock("@/composables/useChannelGroups", () => ({
  useChannelGroups: () => ({ channelGroups: h.groups }),
}));

import { IonDateTime } from "@argon-chat/ion.webcore";
import {
  ChannelType,
  EntityType,
  FailedFollowChannel,
  FailedPublishMessage,
  FailedRemoveFollow,
  FollowChannelError,
  PublishMessageError,
  RemoveFollowError,
  SuccessFollowChannel,
  SuccessPublishMessage,
  SuccessRemoveFollow,
} from "@argon/glue";
import {
  canPublishMessage,
  crosspostHeaderOf,
  followErrorKey,
  followTargetSections,
  followableSpaces,
  isSystemMessage,
  publishErrorKey,
  publishSuccessDescription,
  removeFollowErrorKey,
  replyAuthorName,
  shouldRenderMessage,
  toFollowOutcome,
  toPublishOutcome,
  toRemoveFollowOutcome,
  useChannelFollow,
  useFollowTargets,
  usePublishToFollowers,
} from "@/composables/useChannelFollow";
import { SYSTEM_USER_ID } from "@/composables/useMessageContent";

const link = (extra: Record<string, unknown> = {}) =>
  ({
    followId: "f1",
    sourceSpaceId: "src-space",
    sourceChannelId: "news",
    sourceSpaceName: "Argon",
    sourceChannelName: "news",
    targetSpaceId: "my-space",
    targetChannelId: "updates",
    targetSpaceName: "Mine",
    targetChannelName: "updates",
    createdAt: IonDateTime.now(),
    creatorId: "me",
    sourceSpaceAvatarFileId: null,
    targetSpaceAvatarFileId: null,
    ...extra,
  }) as any;

const msg = (extra: Record<string, unknown> = {}) =>
  ({
    messageId: 1n,
    channelId: "news",
    spaceId: "src-space",
    text: "hello",
    entities: [],
    sender: "me",
    reactions: [],
    controls: null,
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    ...extra,
  }) as any;

const crosspost = {
  sourceSpaceId: "src-space",
  sourceChannelId: "news",
  sourceMessageId: 7n,
  sourceSpaceName: "Argon",
  sourceChannelName: "news",
  sourceSpaceAvatarFileId: "file-1",
};

const channel = (channelId: string, extra: Record<string, unknown> = {}) =>
  ({
    channelId,
    spaceId: "my-space",
    name: channelId,
    type: ChannelType.Text,
    groupId: null,
    fractionalIndex: null,
    broadcast: null,
    ...extra,
  }) as any;

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

beforeEach(() => {
  for (const fn of [h.follow, h.publish, h.getFollowers, h.getFollowedSources, h.removeFollow, h.toast]) fn.mockReset();
  h.spaces.value = [];
  h.channelsBySpace = {};
  h.groups.value = [];
  h.manageSpaces = new Set();
  h.manageChannels = new Set();
});

describe("refusals", () => {
  test("every follow error has its own message, and an unknown one reads as a generic failure", () => {
    const errors = Object.values(FollowChannelError).filter((v): v is FollowChannelError => typeof v === "number");
    const keys = errors.map(followErrorKey);
    expect(new Set(keys).size).toBe(errors.length);
    expect(followErrorKey(FollowChannelError.TOO_MANY_FOLLOWS)).toBe("follow_error_too_many");
    expect(followErrorKey(FollowChannelError.SOURCE_PRIVATE)).toBe("follow_error_source_private");
    expect(followErrorKey(FollowChannelError.SOURCE_FOLLOWER_LIMIT)).toBe("follow_error_source_full");
    expect(followErrorKey(FollowChannelError.ALREADY_FOLLOWING)).toBe("follow_error_already_following");
    expect(followErrorKey(99 as FollowChannelError)).toBe("follow_error_unknown");
  });

  test("every publish error has its own message", () => {
    const errors = Object.values(PublishMessageError).filter((v): v is PublishMessageError => typeof v === "number");
    expect(new Set(errors.map(publishErrorKey)).size).toBe(errors.length);
    expect(publishErrorKey(PublishMessageError.PUBLISH_RATE_LIMITED)).toBe("publish_error_rate_limited");
    expect(publishErrorKey(42 as PublishMessageError)).toBe("publish_error_unknown");
  });

  test("remove-follow errors map too", () => {
    expect(removeFollowErrorKey(RemoveFollowError.INSUFFICIENT_PERMISSIONS)).toBe("follow_remove_error_no_permission");
    expect(removeFollowErrorKey(7 as RemoveFollowError)).toBe("follow_error_unknown");
  });
});

describe("results", () => {
  test("a follow comes back as the link, or as the refusal's message", () => {
    const l = link();
    expect(toFollowOutcome(new SuccessFollowChannel(l))).toEqual({ ok: true, link: l });
    expect(toFollowOutcome(new FailedFollowChannel(FollowChannelError.SAME_CHANNEL))).toEqual({
      ok: false,
      errorKey: "follow_error_same_channel",
    });
  });

  test("a publish comes back with its counts and time, or the refusal", () => {
    const at = IonDateTime.now();
    expect(toPublishOutcome(new SuccessPublishMessage(at, 2, 3))).toEqual({
      ok: true,
      deliveredCount: 2,
      targetCount: 3,
      publishedAt: at,
    });
    expect(toPublishOutcome(new FailedPublishMessage(PublishMessageError.ALREADY_PUBLISHED))).toEqual({
      ok: false,
      errorKey: "publish_error_already_published",
      error: PublishMessageError.ALREADY_PUBLISHED,
    });
  });

  test("removing a follow that is already gone counts as removed", () => {
    expect(toRemoveFollowOutcome(new SuccessRemoveFollow())).toEqual({ ok: true });
    expect(toRemoveFollowOutcome(new FailedRemoveFollow(RemoveFollowError.FOLLOW_NOT_FOUND))).toEqual({ ok: true });
    expect(toRemoveFollowOutcome(new FailedRemoveFollow(RemoveFollowError.INSUFFICIENT_PERMISSIONS))).toEqual({
      ok: false,
      errorKey: "follow_remove_error_no_permission",
    });
  });

  test("the publish toast says how many channels it reached, without plural forms", () => {
    expect(publishSuccessDescription({ deliveredCount: 0, targetCount: 0 })).toEqual({
      key: "publish_success_no_followers",
      params: {},
    });
    expect(publishSuccessDescription({ deliveredCount: 3, targetCount: 3 })).toEqual({
      key: "publish_success_reached",
      params: { n: 3 },
    });
    expect(publishSuccessDescription({ deliveredCount: 2, targetCount: 5 })).toEqual({
      key: "publish_success_partial",
      params: { delivered: 2, total: 5 },
    });
  });
});

describe("canPublishMessage", () => {
  const base = { channelType: "announcement" as const, myUserId: "me", canManageMessages: false };

  test("the author may publish their own announcement", () => {
    expect(canPublishMessage({ ...base, message: msg() })).toBe(true);
    expect(canPublishMessage({ ...base, channelType: ChannelType.Announcement as any, message: msg() })).toBe(true);
  });

  test("somebody else's only with ManageMessages", () => {
    expect(canPublishMessage({ ...base, message: msg({ sender: "other" }) })).toBe(false);
    expect(canPublishMessage({ ...base, canManageMessages: true, message: msg({ sender: "other" }) })).toBe(true);
  });

  test("only in announcement channels", () => {
    expect(canPublishMessage({ ...base, channelType: "text", canManageMessages: true, message: msg() })).toBe(false);
    expect(canPublishMessage({ ...base, channelType: undefined, canManageMessages: true, message: msg() })).toBe(false);
  });

  test("not before the server has it, and not twice", () => {
    expect(canPublishMessage({ ...base, message: msg({ _optimistic: true }) })).toBe(false);
    expect(canPublishMessage({ ...base, message: msg({ _failed: true }) })).toBe(false);
    expect(canPublishMessage({ ...base, message: msg({ publishedAt: IonDateTime.now() }) })).toBe(false);
  });

  test("never a crosspost or a system message", () => {
    expect(canPublishMessage({ ...base, canManageMessages: true, message: msg({ crosspost }) })).toBe(false);
    expect(canPublishMessage({ ...base, canManageMessages: true, message: msg({ sender: SYSTEM_USER_ID }) })).toBe(false);
    const joined = msg({ entities: [{ type: EntityType.SystemUserJoined, offset: 0, length: 0, version: 1 }] });
    expect(canPublishMessage({ ...base, canManageMessages: true, message: joined })).toBe(false);
  });

  test("isSystemMessage reads the system sender and the System* entities", () => {
    expect(isSystemMessage(msg())).toBe(false);
    expect(isSystemMessage(msg({ sender: SYSTEM_USER_ID }))).toBe(true);
    expect(isSystemMessage(msg({ entities: [{ type: EntityType.SystemCallEnded }] }))).toBe(true);
    expect(isSystemMessage(msg({ entities: [{ type: EntityType.Mention }] }))).toBe(false);
  });
});

describe("crossposts", () => {
  test("a normal message has no crosspost header", () => {
    expect(crosspostHeaderOf(msg())).toBeNull();
  });

  test("a crosspost is headed by where it was published", () => {
    expect(crosspostHeaderOf(msg({ crosspost }))).toEqual({
      spaceId: "src-space",
      spaceName: "Argon",
      channelName: "news",
      avatarFileId: "file-1",
      label: "Argon • #news",
    });
  });

  test("a reply never names the author of a crosspost that hides them", () => {
    const author = { displayName: "Alice" };
    expect(replyAuthorName(msg({ crosspost: { ...crosspost, hideAuthor: true } }), author)).toBe("Argon");
    expect(replyAuthorName(msg({ crosspost: { ...crosspost, hideAuthor: false } }), author)).toBe("Alice");
    expect(replyAuthorName(msg({ crosspost }), null)).toBe("Argon");
    expect(replyAuthorName(msg(), author)).toBe("Alice");
    expect(replyAuthorName(msg(), null)).toBeNull();
  });

  test("renders without a locally known author; a normal message still needs one", () => {
    expect(shouldRenderMessage(null, msg({ crosspost }))).toBe(true);
    expect(shouldRenderMessage(null, msg())).toBe(false);
    expect(shouldRenderMessage({ userId: "u" }, msg())).toBe(true);
  });
});

describe("where a follow can go", () => {
  test("spaces where the user manages channels, by name", () => {
    const spaces = [
      { spaceId: "b", name: "beta" },
      { spaceId: "x", name: "Excluded" },
      { spaceId: "a", name: "Alpha" },
    ] as any[];
    const result = followableSpaces(spaces, (id) => id !== "x");
    expect(result.map((s) => s.spaceId)).toEqual(["a", "b"]);
  });

  test("text and announcement channels the user manages, never the source, in sidebar order", () => {
    const groups = [
      { groupId: "g2", name: "Second", fractionalIndex: "b" },
      { groupId: "g1", name: "First", fractionalIndex: "a" },
    ] as any[];
    const channels = [
      channel("voice", { type: ChannelType.Voice }),
      channel("news", { type: ChannelType.Announcement }),
      channel("t-g2", { groupId: "g2", fractionalIndex: "a" }),
      channel("t-g1-b", { groupId: "g1", fractionalIndex: "b" }),
      channel("t-g1-a", { groupId: "g1", fractionalIndex: "a", type: ChannelType.Announcement }),
      channel("loose", { fractionalIndex: "a" }),
      channel("orphan", { groupId: "gone", fractionalIndex: "b" }),
      channel("locked", { groupId: "g1" }),
    ];
    const manageable = new Set(["voice", "news", "t-g2", "t-g1-b", "t-g1-a", "loose", "orphan"]);

    const sections = followTargetSections(channels, groups, {
      sourceChannelId: "news",
      canManageIn: (id) => manageable.has(id),
    });

    expect(sections.map((s) => [s.name, s.channels.map((c) => c.channelId)])).toEqual([
      [null, ["loose", "orphan"]],
      ["First", ["t-g1-a", "t-g1-b"]],
      ["Second", ["t-g2"]],
    ]);
  });

  test("the dialog's pickers follow the chosen space", async () => {
    h.spaces.value = [
      { spaceId: "s2", name: "Zeta" },
      { spaceId: "s1", name: "Alpha" },
      { spaceId: "s3", name: "No rights" },
    ];
    h.manageSpaces = new Set(["s1", "s2"]);
    h.manageChannels = new Set(["a1", "a2", "z1"]);
    h.channelsBySpace = {
      s1: [channel("a1", { spaceId: "s1" }), channel("a2", { spaceId: "s1", type: ChannelType.Voice })],
      s2: [channel("z1", { spaceId: "s2" })],
    };

    const scope = effectScope();
    const picker = scope.run(() => useFollowTargets(() => "news"))!;

    expect(picker.spaces.value.map((s) => s.spaceId)).toEqual(["s1", "s2"]);
    expect(picker.sections.value).toEqual([]);

    picker.pickSpace("s1");
    await flush();
    expect(picker.sections.value.flatMap((s) => s.channels.map((c) => c.channelId))).toEqual(["a1"]);

    picker.selectedChannelId.value = "a1";
    expect(picker.selectedChannel.value?.channelId).toBe("a1");

    // Another space drops the channel picked in the first.
    picker.pickSpace("s2");
    await flush();
    expect(picker.selectedChannelId.value).toBe("");
    expect(picker.selectedChannel.value).toBeNull();
    expect(picker.sections.value.flatMap((s) => s.channels.map((c) => c.channelId))).toEqual(["z1"]);

    picker.reset();
    expect(picker.selectedSpaceId.value).toBe("");
    scope.stop();
  });
});

describe("the calls", () => {
  test("follow is asked of the source channel, with the target as arguments", async () => {
    const l = link();
    h.follow.mockResolvedValue(new SuccessFollowChannel(l));
    const { follow } = useChannelFollow();

    const outcome = await follow({ spaceId: "src-space", channelId: "news" }, { spaceId: "my-space", channelId: "updates" });

    expect(h.follow).toHaveBeenCalledWith("src-space", "news", "my-space", "updates");
    expect(outcome).toEqual({ ok: true, link: l });
  });

  test("a follow that does not reach the server is a generic failure", async () => {
    h.follow.mockRejectedValue(new Error("offline"));
    const { follow } = useChannelFollow();
    expect(await follow({ spaceId: "s", channelId: "c" }, { spaceId: "t", channelId: "d" })).toEqual({
      ok: false,
      errorKey: "follow_error_unknown",
    });
  });

  test("followers and followed sources come back as plain arrays", async () => {
    h.getFollowers.mockResolvedValue([link()]);
    h.getFollowedSources.mockResolvedValue([]);
    const { followers, followedSources } = useChannelFollow();
    expect(await followers("s", "c")).toHaveLength(1);
    expect(await followedSources("s", "c")).toEqual([]);
    expect(h.getFollowers).toHaveBeenCalledWith("s", "c");
  });

  test("removeFollow is asked of the open channel", async () => {
    h.removeFollow.mockResolvedValue(new SuccessRemoveFollow());
    const { removeFollow } = useChannelFollow();
    expect(await removeFollow("s", "c", "f1")).toEqual({ ok: true });
    expect(h.removeFollow).toHaveBeenCalledWith("s", "c", "f1");
  });
});

describe("publishing from the list", () => {
  test("a publish stamps the message and says how far it went", async () => {
    const at = IonDateTime.now();
    h.publish.mockResolvedValue(new SuccessPublishMessage(at, 2, 2));
    const stamped = vi.fn();
    const { publishMessage } = usePublishToFollowers(() => ({ spaceId: "s", channelId: "news" }), stamped);

    await publishMessage({ messageId: 5n });

    expect(h.publish).toHaveBeenCalledWith("s", "news", 5n);
    expect(stamped).toHaveBeenCalledWith(5n, at);
    expect(h.toast).toHaveBeenCalledWith({ title: "publish_success", description: 'publish_success_reached:{"n":2}' });
  });

  test("a refusal is a destructive toast and stamps nothing", async () => {
    h.publish.mockResolvedValue(new FailedPublishMessage(PublishMessageError.PUBLISH_RATE_LIMITED));
    const stamped = vi.fn();
    const { publishMessage } = usePublishToFollowers(() => ({ spaceId: "s", channelId: "news" }), stamped);

    await publishMessage({ messageId: 5n });

    expect(stamped).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({
      title: "publish_failed",
      description: "publish_error_rate_limited",
      variant: "destructive",
    });
  });

  test("a double click publishes once", async () => {
    let answer!: (v: unknown) => void;
    h.publish.mockReturnValue(new Promise((r) => (answer = r)));
    const { publishMessage } = usePublishToFollowers(() => ({ spaceId: "s", channelId: "news" }), () => {});

    const first = publishMessage({ messageId: 5n });
    await publishMessage({ messageId: 5n });
    answer(new SuccessPublishMessage(IonDateTime.now(), 0, 0));
    await first;

    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  test("outside a space nothing is sent", async () => {
    const { publishMessage } = usePublishToFollowers(() => ({ spaceId: undefined, channelId: "dm" }), () => {});
    await publishMessage({ messageId: 5n });
    expect(h.publish).not.toHaveBeenCalled();
  });
});
