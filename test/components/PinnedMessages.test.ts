/**
 * The pinned-messages panel in the channel header: one row per pin with author, date, a text
 * preview and an attachment hint; Jump for everyone, Unpin only with ManageMessages. The header
 * button shows the count and says so when a pinned message is not loaded in the list.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { EntityType } from "@argon/glue";
import { Subject } from "rxjs";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  const { Subject } = await import("rxjs");
  return {
    granted: true,
    getPinned: vi.fn(),
    unpinMessage: vi.fn(),
    toast: vi.fn(),
    reconnected: new Subject<void>(),
    resumed: new Subject<void>(),
    resync: new Subject<void>(),
    handlers: new Map<string, (e: any) => void>(),
  };
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} },
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      getUserReactive: (id: { value: string }) => computed(() => ({ userId: id.value, displayName: `name-${id.value}` })),
    }),
  };
});
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#fff" }) }));
vi.mock("@/components/ArgonAvatar.vue", () => ({ default: { name: "ArgonAvatar", setup: () => () => null } }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelPinsInteraction: {
      GetPinnedMessages: (...a: unknown[]) => h.getPinned(...a),
      UnpinMessage: (...a: unknown[]) => h.unpinMessage(...a),
    },
  }),
}));
vi.mock("@/store/realtime/busStore", async () => {
  return {
    useBus: () => ({
      onServerEvent: (event: string, handler: (e: any) => void) => {
        h.handlers.set(event, handler);
        return { unsubscribe() {} };
      },
      reconnected: h.reconnected,
      resumed: h.resumed,
      needFullResync: h.resync,
    }),
  };
});
vi.mock("@/store/data/messageStore", () => ({ useMessageStore: () => ({ getMessageById: async () => undefined }) }));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ hasIn: (_c: string, flag: string) => h.granted && flag === "ManageMessages" }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
// The popover renders in place, so its content is part of the wrapper.
vi.mock("@argon/ui/popover", async () => {
  const { defineComponent, h: hh } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => hh("div", { class: name }, slots.default?.()) });
  return { Popover: pass("Popover"), PopoverTrigger: pass("PopoverTrigger"), PopoverContent: pass("PopoverContent") };
});

vi.mock("@argon/ui/context-menu", async () => {
  const { defineComponent, h: hh } = await import("vue");
  return {
    ContextMenuItem: defineComponent({
      name: "ContextMenuItem",
      emits: ["select"],
      setup: (_, { slots, emit }) => () => hh("button", { onClick: () => emit("select") }, slots.default?.()),
    }),
  };
});

import PinnedMessagesPanel from "@/components/chats/PinnedMessagesPanel.vue";
import MessagePinMenuItem from "@/components/chats/MessagePinMenuItem.vue";
import PinnedMessagesButton from "@/components/chats/PinnedMessagesButton.vue";
import MessagePinMarker from "@/components/chats/MessagePinMarker.vue";
import { SPOILER_MASK } from "@/lib/chat/spoilers";

const attachment = { type: EntityType.Attachment, offset: 0, length: 0, version: 1, fileId: "f1", fileName: "a.png" };

const pinned = (messageId: bigint, text: string, sender = "u1", entities: unknown[] = []) =>
  ({
    message: { messageId, channelId: "c1", spaceId: "s1", text, entities, sender, timeSent: IonDateTime.now() },
    pinnedBy: "mod",
    pinnedAt: new IonDateTime(messageId * 10_000_000n),
  }) as any;

beforeEach(() => {
  setActivePinia(createPinia());
  h.granted = true;
  h.getPinned.mockReset();
  h.unpinMessage.mockReset();
  h.toast.mockReset();
  h.reconnected = new Subject<void>();
  h.resumed = new Subject<void>();
  h.resync = new Subject<void>();
});

describe("the panel", () => {
  test("lists each pin with its author, text and attachment hint", () => {
    const w = mount(PinnedMessagesPanel, {
      props: { pins: [pinned(2n, "rules", "u2", [attachment, attachment]), pinned(1n, "welcome")], canManage: false },
    });

    const rows = w.findAll('[data-testid="pinned-message-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("name-u2");
    expect(rows[0].text()).toContain("rules");
    expect(rows[0].find('[data-testid="pinned-attachment-hint"]').text()).toContain('pins_attachments:{"count":2}');
    expect(rows[1].text()).toContain("welcome");
    expect(rows[1].find('[data-testid="pinned-attachment-hint"]').exists()).toBe(false);
    expect(w.text()).toContain("2/50");
  });

  test("a spoiler in a pinned message is masked in its preview", () => {
    const spoiler = { type: EntityType.Spoiler, offset: 12, length: 4, version: 1 };
    const w = mount(PinnedMessagesPanel, {
      props: { pins: [pinned(1n, "the code is 4815, keep it", "u1", [spoiler])], canManage: false },
    });

    const row = w.find('[data-testid="pinned-message-row"]').text();
    expect(row).not.toContain("4815");
    expect(row).toContain(`the code is ${SPOILER_MASK}, keep it`);
  });

  test("Jump is there for everyone, Unpin only for those who manage messages", async () => {
    const reader = mount(PinnedMessagesPanel, { props: { pins: [pinned(1n, "x")], canManage: false } });
    expect(reader.find('[data-testid="pinned-unpin"]').exists()).toBe(false);

    await reader.find('[data-testid="pinned-jump"]').trigger("click");
    expect(reader.emitted("jump")).toEqual([[1n]]);

    const moderator = mount(PinnedMessagesPanel, { props: { pins: [pinned(1n, "x")], canManage: true } });
    await moderator.find('[data-testid="pinned-unpin"]').trigger("click");
    expect(moderator.emitted("unpin")).toEqual([[1n]]);
  });

  test("with nothing pinned it says so, and while loading it waits", () => {
    const empty = mount(PinnedMessagesPanel, { props: { pins: [], canManage: true } });
    expect(empty.find('[data-testid="pinned-messages-empty"]').exists()).toBe(true);
    expect(empty.text()).toContain("pins_empty");

    const loading = mount(PinnedMessagesPanel, { props: { pins: [], canManage: true, loading: true } });
    expect(loading.find('[data-testid="pinned-messages-empty"]').exists()).toBe(false);
  });
});

describe("the header button", () => {
  async function button(jumpTo: (id: bigint) => boolean | Promise<boolean> = () => true) {
    const w = mount(PinnedMessagesButton, { props: { channelId: "c1", spaceId: "s1", jumpTo } });
    await flushPromises();
    return w;
  }

  test("loads the channel's pins and shows how many there are", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(1n, "a"), pinned(2n, "b")]);
    const w = await button();

    expect(h.getPinned).toHaveBeenCalledWith("s1", "c1");
    expect(w.find('[data-testid="pinned-messages-count"]').text()).toBe("2");
  });

  test("shows no count for a channel without pins", async () => {
    h.getPinned.mockResolvedValueOnce([]);
    const w = await button();

    expect(w.find('[data-testid="pinned-messages-count"]').exists()).toBe(false);
  });

  test("Jump goes to the message, loading it if need be, and says so when it is gone", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(2n, "still here"), pinned(1n, "deleted since")]);
    const jumpTo = vi.fn(async (id: bigint) => id === 2n);
    const w = await button(jumpTo);

    const jumps = w.findAll('[data-testid="pinned-jump"]');
    await jumps[0].trigger("click");
    await flushPromises();
    expect(jumpTo).toHaveBeenLastCalledWith(2n);
    expect(h.toast).not.toHaveBeenCalled();

    await jumps[1].trigger("click");
    await flushPromises();
    expect(jumpTo).toHaveBeenLastCalledWith(1n);
    expect(h.toast).toHaveBeenCalledWith({ title: "message_jump_gone" });
  });

  test("Unpin from the panel removes the pin", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(2n, "b"), pinned(1n, "a")]);
    const { SuccessUnpinMessage } = await import("@argon/glue");
    h.unpinMessage.mockResolvedValueOnce(new SuccessUnpinMessage());
    const w = await button();

    await w.findAll('[data-testid="pinned-unpin"]')[1].trigger("click");
    await flushPromises();

    expect(h.unpinMessage).toHaveBeenCalledWith("s1", "c1", 1n);
    expect(w.findAll('[data-testid="pinned-message-row"]')).toHaveLength(1);
    expect(w.find('[data-testid="pinned-messages-count"]').text()).toBe("1");
  });

  test("a resumed session asks nothing, a resync asks again", async () => {
    h.getPinned.mockResolvedValue([]);
    await button();

    h.resumed.next();
    await flushPromises();
    expect(h.getPinned).toHaveBeenCalledTimes(1);

    h.resync.next();
    await flushPromises();
    expect(h.getPinned).toHaveBeenCalledTimes(2);
  });

  test("back to a channel opened a moment ago: its pins are shown without asking", async () => {
    h.getPinned.mockResolvedValue([pinned(1n, "a")]);
    const w = await button();

    await w.setProps({ channelId: "c2" });
    await flushPromises();
    await w.setProps({ channelId: "c1" });
    await flushPromises();

    expect(h.getPinned.mock.calls.map((c) => c[1])).toEqual(["c1", "c2"]);
    expect(w.find('[data-testid="pinned-messages-count"]').text()).toBe("1");
  });

  test("a pin the cache cannot fill in is asked for when the panel opens, not when it happens", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(1n, "a")]);
    const w = await button();

    h.handlers.get("MessagePinned")!({ spaceId: "s1", channelId: "c1", messageId: 2n, byUserId: "mod" });
    await flushPromises();
    expect(h.getPinned).toHaveBeenCalledTimes(1);

    h.getPinned.mockResolvedValueOnce([pinned(2n, "b"), pinned(1n, "a")]);
    w.findComponent({ name: "Popover" }).vm.$emit("update:open", true);
    await flushPromises();

    expect(h.getPinned).toHaveBeenCalledTimes(2);
    expect(w.findAll('[data-testid="pinned-message-row"]')).toHaveLength(2);
  });

  test("a failed load shows an error with Try again instead of spinning", async () => {
    h.getPinned.mockRejectedValueOnce(new Error("offline"));
    const w = await button();

    expect(w.find('[data-testid="pinned-messages-error"]').text()).toContain("pins_load_failed");
    expect(w.find(".animate-spin").exists()).toBe(false);

    h.getPinned.mockResolvedValueOnce([pinned(1n, "a")]);
    await w.find('[data-testid="pinned-messages-retry"]').trigger("click");
    await flushPromises();

    expect(w.find('[data-testid="pinned-messages-error"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="pinned-message-row"]')).toHaveLength(1);
  });

  test("a reconnect loads the pins again", async () => {
    h.getPinned.mockResolvedValue([]);
    await button();

    h.reconnected.next();
    await flushPromises();

    expect(h.getPinned).toHaveBeenCalledTimes(2);
  });
});

describe("the message menu", () => {
  test("offers Pin on an unpinned message and Unpin on a pinned one", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(1n, "a")]);
    mount(PinnedMessagesButton, { props: { channelId: "c1", spaceId: "s1", jumpTo: () => true } });
    await flushPromises();

    const { SuccessUnpinMessage } = await import("@argon/glue");
    h.unpinMessage.mockResolvedValueOnce(new SuccessUnpinMessage());

    const onPinned = mount(MessagePinMenuItem, { props: { message: pinned(1n, "a").message } });
    const onOther = mount(MessagePinMenuItem, { props: { message: pinned(2n, "b").message } });

    expect(onPinned.text()).toBe("pins_unpin");
    expect(onOther.text()).toBe("pins_pin");

    await onPinned.find("button").trigger("click");
    await flushPromises();

    expect(h.unpinMessage).toHaveBeenCalledWith("s1", "c1", 1n);
    expect(onPinned.text()).toBe("pins_pin");
  });
});

describe("the marker on a message", () => {
  test("appears only on pinned messages", async () => {
    h.getPinned.mockResolvedValueOnce([pinned(1n, "a")]);
    await mount(PinnedMessagesButton, { props: { channelId: "c1", spaceId: "s1", jumpTo: () => true } });
    await flushPromises();

    const onPinned = mount(MessagePinMarker, { props: { channelId: "c1", messageId: 1n } });
    const onOther = mount(MessagePinMarker, { props: { channelId: "c1", messageId: 2n } });

    expect(onPinned.find('[data-testid="message-pin-marker"]').exists()).toBe(true);
    expect(onOther.find('[data-testid="message-pin-marker"]').exists()).toBe(false);
  });
});
