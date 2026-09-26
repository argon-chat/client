/**
 * The chat list memoises its rows, and the memo keys decide when a row is drawn again.
 *
 * The announcement card context used to be a key: an object built anew on every write of the
 * channel row, which every message in the channel makes (lastMessageId) — so every row was redrawn
 * on every message. And `canEdit` and the channel type were not keys at all, so a row kept showing
 * what it was first drawn with. Keys are primitives now.
 */

import { describe, test, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, shallowRef } from "vue";

const h = vi.hoisted(() => ({
  renders: new Map<string, number>(),
  lastProps: new Map<string, any>(),
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
}));

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/components/MessageItem.vue", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    default: defineComponent({
      name: "MessageItem",
      props: ["message", "canEdit", "channelType", "announcement", "canReply", "canDeleteAny"],
      setup(props) {
        return () => {
          const id = String(props.message.messageId);
          h.renders.set(id, (h.renders.get(id) ?? 0) + 1);
          h.lastProps.set(id, { ...props });
          return hh("div", props.message.text);
        };
      },
    }),
  };
});
vi.mock("@/components/chats/MessageReadCount.vue", () => h.stub("MessageReadCount"));
vi.mock("@/components/chats/ImageLightbox.vue", () => h.stub("ImageLightbox"));
vi.mock("@/components/chats/DateSeparator.vue", () => h.stub("DateSeparator"));
vi.mock("@/components/chats/UnreadSeparator.vue", () => h.stub("UnreadSeparator"));
vi.mock("@/components/shared/EmptyStateArt.vue", () => h.stub("EmptyStateArt"));

import ChatMessageList from "@/components/chats/ChatMessageList.vue";
import { announcementMemoKey } from "@/composables/useAnnouncementChannel";

const card = (reactions = true) => ({
  settings: { reactions, postAsSpace: true, showAuthor: false },
  space: { name: "Argon", avatarFileId: null },
});

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function list(props: Record<string, unknown> = {}) {
  const messages = shallowRef([{ messageId: 1n, text: "hello", entities: [], sender: "u1", timeSent: { toDate: () => new Date() } }] as any[]);
  const w = mount(ChatMessageList, {
    props: {
      source: () => messages,
      groupingMap: [{ isFirstInGroup: true, isLastInGroup: true, showDate: false, showUnread: false }] as any,
      getMessageById: () => ({}) as any,
      isLoading: false,
      isLoadingOlder: false,
      isScrolledUp: false,
      newMessagesCount: 0,
      ...props,
    },
    attachTo: document.body,
  });
  for (let i = 0; i < 3; i++) {
    await frame();
    await flushPromises();
  }
  return w;
}

describe("announcementMemoKey", () => {
  test("the same for an equal context built anew, different when what it renders changes", () => {
    expect(announcementMemoKey(card())).toBe(announcementMemoKey(card()));
    expect(announcementMemoKey(card(false))).not.toBe(announcementMemoKey(card()));
    expect(announcementMemoKey({ ...card(), space: { name: "Other", avatarFileId: null } })).not.toBe(announcementMemoKey(card()));
    expect(announcementMemoKey(null)).toBe("");
  });
});

describe("a row of the chat list", () => {
  test("is not drawn again when the channel row is rewritten with the same card context", async () => {
    h.renders.clear();
    const w = await list({ announcement: card(), channelType: "announcement" });
    const drawn = h.renders.get("1");
    expect(drawn).toBeGreaterThan(0);

    // What a message arriving in the channel does to the context: same content, new object.
    await w.setProps({ announcement: card() });
    await nextTick();
    expect(h.renders.get("1")).toBe(drawn);

    await w.setProps({ announcement: card(false) });
    await nextTick();
    expect(h.renders.get("1")).toBe(drawn! + 1);
    w.unmount();
  });

  test("is drawn again when editing is allowed or the channel type changes", async () => {
    const w = await list({ canEdit: false, channelType: "text" });
    expect(h.lastProps.get("1").canEdit).toBe(false);

    await w.setProps({ canEdit: true });
    await nextTick();
    expect(h.lastProps.get("1").canEdit).toBe(true);

    await w.setProps({ channelType: "announcement" });
    await nextTick();
    expect(h.lastProps.get("1").channelType).toBe("announcement");
    w.unmount();
  });
});

describe("jumping", () => {
  test("away in older history, the list offers the way back instead of the scroll button", async () => {
    const w = await list({ detached: true, isScrolledUp: true, newMessagesCount: 3 });

    const bar = w.find('[data-testid="older-history-bar"]');
    expect(bar.text()).toContain("viewing_older_messages");
    expect(bar.text()).toContain("3");
    await w.get('[data-testid="jump-to-present"]').trigger("click");
    expect(w.emitted("jump-to-present")).toHaveLength(1);
    w.unmount();
  });

  test("a reply whose original is not loaded asks the parent to open it; a loaded one does not", async () => {
    const w = await list();
    const row = w.findComponent({ name: "MessageItem" });

    row.vm.$emit("scroll-to-message", 99n);
    row.vm.$emit("scroll-to-message", 1n);

    expect(w.emitted("jump-to-message")).toEqual([[99n]]);
    w.unmount();
  });
});
