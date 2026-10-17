/**
 * Only a group's first message draws its author's look, so only it joins the profile cache's queue,
 * and it asks in the message's own space rather than whichever one is open.
 */

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import {
  nextTick,
  toValue,
} from "vue";

// The environment ships no localStorage, and modules MessageItem imports read it on load.
vi.hoisted(() => {
  const entries = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, String(value));
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
      clear: () => {
        entries.clear();
      },
    },
  });
});

const h = await vi.hoisted(async () => ({
  users: {} as Record<string, unknown>,
  asked: [] as Array<{ spaceId: unknown; userId: unknown; wanted: unknown }>,
  drawnOn: ["nicknameInMessages", "avatar", "profileCard"] as string[],
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
}));

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast() {} }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" }, meProfile: null }) }));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#fff" }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => false, hasInSpace: () => false }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");

  return {
    usePoolStore: () => ({
      selectedServer: "open-space",
      getUserReactive: (id: { value: string | undefined }) => computed(() => (id.value ? h.users[id.value] ?? null : null)),
    }),
  };
});
vi.mock("@/composables/useChannelGroups", () => ({ useChannelGroups: () => ({}) }));
vi.mock("@/lib/linkPreview/settings", async () => {
  const { ref } = await import("vue");

  return { showLinkPreviews: ref(false) };
});
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});
vi.mock("@/composables/useCosmeticsDrawnOn", async () => {
  const { computed } = await import("vue");

  return {
    useCosmeticsDrawnOn: (surfaces: readonly string[]) => computed(() => surfaces.some(surface => h.drawnOn.includes(surface))),
  };
});
vi.mock("@/composables/useCosmeticFit", async () => {
  const { computed } = await import("vue");

  return { useCosmeticOverhang: () => computed(() => ({ top: 0, right: 0, bottom: 0, left: 0 })) };
});
vi.mock("@/composables/useProfileStatus", async () => {
  const { shallowRef } = await import("vue");

  return {
    useProfileStatus: (spaceId: unknown, userId: unknown, wanted: unknown) => {
      h.asked.push({ spaceId, userId, wanted });

      return shallowRef(null);
    },
  };
});

vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/cosmetics/CosmeticNickname.vue", () => h.stub("CosmeticNickname"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/chats/AttachmentImageGrid.vue", () => h.stub("AttachmentImageGrid"));
vi.mock("@/components/chats/AttachmentFileCard.vue", () => h.stub("AttachmentFileCard"));
vi.mock("@/components/chats/LinkPreviewCard.vue", () => h.stub("LinkPreviewCard"));
vi.mock("@/components/chats/MessageReactions.vue", () => h.stub("MessageReactions"));
vi.mock("@/components/chats/MessageControls.vue", () => h.stub("MessageControls"));
vi.mock("@/components/chats/ReactionPicker.vue", () => h.stub("ReactionPicker"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));
vi.mock("@/components/chats/MessagePinMarker.vue", () => h.stub("MessagePinMarker"));
vi.mock("@/components/chats/MessageReadCount.vue", () => h.stub("MessageReadCount"));
vi.mock("@/components/chats/MessagePinMenuItem.vue", () => h.stub("MessagePinMenuItem"));
vi.mock("@/components/chats/AnnouncementCard.vue", () => h.stub("AnnouncementCard"));
vi.mock("@/components/chats/MessageWebhookAuthor.vue", () => h.stub("MessageWebhookAuthor"));
vi.mock("@/components/chats/ChatSegment.vue", () => h.stub("ChatSegment"));

import { IonDateTime } from "@argon-chat/ion.webcore";

import MessageItem from "@/components/MessageItem.vue";

function message(extra: Record<string, unknown> = {}) {
  return {
    messageId: 1n,
    replyId: null,
    channelId: "c1",
    spaceId: "s1",
    text: "hello",
    entities: [],
    timeSent: IonDateTime.fromDate(new Date("2026-10-08T10:00:00Z")),
    sender: "author",
    reactions: [],
    controls: null,
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    ...extra,
  } as never;
}

const mounted: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of mounted) {
    wrapper.unmount();
  }

  mounted.length = 0;
  h.users = {};
  h.asked.length = 0;
  h.drawnOn = ["nicknameInMessages", "avatar", "profileCard"];
  document.body.innerHTML = "";
});

async function render(sent: never, isFirstInGroup = true) {
  const wrapper = mount(MessageItem, {
    attachTo: document.body,
    props: { message: sent, getMsgById: () => ({}) as never, isFirstInGroup },
  });

  mounted.push(wrapper);
  await nextTick();

  const [request] = h.asked;

  return { spaceId: toValue(request.spaceId), wanted: toValue(request.wanted) };
}

describe("the author's look on a message", () => {
  test("is asked for in the message's own space, not the open one", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };

    expect(await render(message())).toEqual({ spaceId: "s1", wanted: true });
  });

  test("a direct message asks with no space", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };

    expect((await render(message({ spaceId: "" }))).spaceId).toBeNull();
  });

  test("only a group's first message asks", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };

    expect((await render(message(), false)).wanted).toBe(false);
  });

  test("asks when only the card it opens has anything on: a frame keeps that card clear of the window", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };
    h.drawnOn = ["profileCard"];

    expect((await render(message())).wanted).toBe(true);
  });

  test("asks for nothing when nothing it or its card could draw is on", async () => {
    h.users.author = { userId: "author", displayName: "Ada" };
    h.drawnOn = [];

    expect((await render(message())).wanted).toBe(false);
  });

  test("the caller's own message asks for nothing: its look comes from meProfile", async () => {
    h.users.me = { userId: "me", displayName: "Me" };

    expect((await render(message({ sender: "me" }))).wanted).toBe(false);
  });
});
