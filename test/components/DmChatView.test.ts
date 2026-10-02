/**
 * The MOTD strip under the header of a DM with a bot: loaded only for a bot, in the reader's
 * language, and giving way while somebody types.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { UserFlag } from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    peer: ref<{ flags: number } | null>(null),
    locale: "en",
    motd: null as string | null,
    ensureLoaded: vi.fn(async () => {}),
    motdFor: vi.fn(),
  };
});

vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string) => k, currentLocale: h.locale }),
}));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ getUserReactive: () => h.peer }) }));
vi.mock("@/store/data/appTextsStore", () => ({
  useAppTextsStore: () => ({
    ensureLoaded: h.ensureLoaded,
    text: (ref: string, key: string, locale: string) => {
      h.motdFor(ref, key, locale);
      return h.motd;
    },
  }),
}));
vi.mock("@/store/chat/useRecentChatsStore", () => ({
  useRecentChatsStore: () => ({ viewingPeer: null, setViewing() {} }),
}));
vi.mock("@/composables/useDirectMessages", async () => {
  const { ref, shallowRef } = await import("vue");
  return {
    useDirectMessages: () => ({
      messages: shallowRef([]),
      hasReachedEnd: ref(true),
      isLoading: ref(false),
      isLoadingOlder: ref(false),
      newMessagesCount: ref(0),
      isScrolledUp: ref(false),
      loadOlderMessages() {},
      loadInitialMessages: async () => {},
      subscribeToNewMessages() {},
      getMessageById: () => undefined,
      addOptimisticMessage() {},
      resolveOptimisticMessage() {},
      markOptimisticFailed() {},
      retryMessage() {},
      cleanup() {},
    }),
  };
});
vi.mock("@/composables/useMessageGrouping", async () => {
  const { ref } = await import("vue");
  return { useMessageGrouping: () => ({ groupingMap: ref(new Map()) }) };
});
vi.mock("@/components/chats/ChatMessageList.vue", async () => {
  const { h: hh } = await import("vue");
  return {
    default: {
      name: "ChatMessageList",
      setup: (_: unknown, { expose }: any) => {
        expose({ resetScroller() {}, scrollToBottomImmediate() {} });
        return () => hh("div", { class: "stub-list" });
      },
    },
  };
});

import DmChatView from "@/components/home/views/dms/DmChatView.vue";

const BOT = "0199a1b2-0000-7000-8000-00000000b07a";

enableAutoUnmount(afterEach);

function mountView(typingUsers: { displayName: string }[] = []) {
  return mount(DmChatView, {
    props: { peerId: BOT, typingUsers },
    global: { stubs: { Transition: false } },
  });
}

beforeEach(() => {
  h.peer.value = { flags: UserFlag.BOT };
  h.locale = "en";
  h.motd = "Type /help";
  h.ensureLoaded.mockClear();
  h.motdFor.mockClear();
});

describe("DmChatView MOTD", () => {
  test("a bot's MOTD is loaded and shown in the reader's language", () => {
    h.locale = "ru";
    const wrapper = mountView();

    expect(h.ensureLoaded).toHaveBeenCalledWith(`bot:${BOT}`, ["motd"]);
    expect(h.motdFor).toHaveBeenCalledWith(`bot:${BOT}`, "motd", "ru");
    expect(wrapper.find("[data-testid='bot-motd']").text()).toBe("Type /help");
  });

  test("a person has no MOTD and is not asked about", () => {
    h.peer.value = { flags: UserFlag.NONE };
    const wrapper = mountView();

    expect(h.ensureLoaded).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='bot-motd']").exists()).toBe(false);
  });

  test("the system account is not treated as a developer's bot", () => {
    h.peer.value = { flags: UserFlag.BOT | UserFlag.SYSTEM };
    mountView();

    expect(h.ensureLoaded).not.toHaveBeenCalled();
  });

  test("a bot without a MOTD shows nothing", () => {
    h.motd = null;
    const wrapper = mountView();

    expect(wrapper.find("[data-testid='bot-motd']").exists()).toBe(false);
  });

  test("the strip gives way while somebody types", () => {
    const wrapper = mountView([{ displayName: "Helper" }]);

    expect(wrapper.find("[data-testid='bot-motd']").exists()).toBe(false);
    expect(wrapper.text()).toContain("typing.one");
  });
});
