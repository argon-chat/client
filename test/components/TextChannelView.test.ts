/**
 * The composer of a text channel, for a member without SendMessages there.
 *
 * It used to render anyway — an input that let the user type and then failed on send, or a disabled
 * box that looked broken. A channel the user cannot write in now shows a short read-only notice in
 * the composer's place, decided per channel (an overwrite can make one channel read-only). Files
 * dragged onto a channel without AttachFiles are not taken either. An announcement channel follows
 * the same rule, with its own notice; editing a sent message borrows the composer.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  const { vi } = await import("vitest");
  return {
    granted: new Set<string>(),
    channelData: ref<Record<string, unknown> | null>({ channelId: "c1", name: "general" }),
    handleExternalFiles: vi.fn(),
    composerMounts: 0,
  };
});

vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: (flag: string) => h.granted.has(flag),
    hasIn: (_channelId: string, flag: string) => h.granted.has(flag),
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { ref } = await import("vue");
  return { usePoolStore: () => ({ getUserReactive: () => ref(null) }) };
});
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#fff" }) }));
vi.mock("@/composables/useChannelData", () => ({ useChannelData: () => ({ channelData: h.channelData }) }));
vi.mock("@/composables/useChannelTyping", async () => {
  const { ref } = await import("vue");
  return { useChannelTyping: () => ({ typingUsers: ref([]), onTyping() {}, onStopTyping() {} }) };
});
vi.mock("@/components/shared/EmptyStateArt.vue", () => ({ default: { name: "EmptyStateArt", setup: () => () => null } }));
vi.mock("@/components/ChatView.vue", async () => {
  const { h: hh } = await import("vue");
  return {
    default: {
      name: "ChatView",
      setup: (_: unknown, { expose }: any) => {
        expose({ scrollToBottomImmediate() {} });
        return () => hh("div", { class: "stub-chat-view" });
      },
    },
  };
});
vi.mock("@/components/chats/EnterText.vue", async () => {
  const { h: hh } = await import("vue");
  return {
    default: {
      name: "EnterText",
      setup: (_: unknown, { expose }: any) => {
        h.composerMounts++;
        expose({ handleExternalFiles: h.handleExternalFiles, focus() {} });
        return () => hh("div", { class: "stub-enter-text" });
      },
    },
  };
});

vi.mock("@/components/chats/ScheduledPostsChip.vue", async () => {
  const { h: hh } = await import("vue");
  return {
    default: {
      name: "ScheduledPostsChip",
      props: ["spaceId", "channelId"],
      setup: (props: { channelId: string }) => () => hh("div", { class: "stub-scheduled-chip" }, props.channelId),
    },
  };
});

import TextChannelView from "@/components/TextChannelView.vue";

function render(channelType: "text" | "announcement" = "text") {
  return mount(TextChannelView, {
    props: { channelType, selectedSpace: "s1", selectedChannelId: "c1" },
  });
}

function fileDrop() {
  return { dataTransfer: { files: [new File(["x"], "a.png")] } };
}

beforeEach(() => {
  h.granted = new Set();
  h.handleExternalFiles.mockClear();
});

describe("without SendMessages in the channel", () => {
  test("a read-only notice replaces the composer", () => {
    h.granted = new Set(["ViewChannel", "ReadHistory"]);
    const w = render();

    const notice = w.find('[data-testid="composer-read-only"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("composer_read_only");
    expect(w.find(".stub-enter-text").exists()).toBe(false);
  });

  test("dropped files are not taken", async () => {
    h.granted = new Set(["ViewChannel", "AttachFiles"]);
    const w = render();

    await w.trigger("dragover");
    await w.trigger("drop", fileDrop());

    expect(w.text()).not.toContain("drop_files_here");
    expect(h.handleExternalFiles).not.toHaveBeenCalled();
  });
});

describe("with SendMessages", () => {
  test("the composer is there and the notice is not", () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render();

    expect(w.find(".stub-enter-text").exists()).toBe(true);
    expect(w.find('[data-testid="composer-read-only"]').exists()).toBe(false);
  });

  test("without AttachFiles, files dropped on the channel go nowhere", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render();

    await w.trigger("dragover");
    expect(w.text()).not.toContain("drop_files_here");
    await w.trigger("drop", fileDrop());
    expect(h.handleExternalFiles).not.toHaveBeenCalled();
  });

  test("with AttachFiles they reach the composer", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages", "AttachFiles"]);
    const w = render();

    await w.trigger("dragover");
    expect(w.text()).toContain("drop_files_here");
    await w.trigger("drop", fileDrop());
    expect(h.handleExternalFiles).toHaveBeenCalledTimes(1);
  });
});

describe("an announcement channel", () => {
  // The server denies SendMessages to everyone there on creation and the owner allows it per role,
  // so the channel-level SendMessages is the whole answer; ManageChannels has nothing to do with it.
  test("a reader gets the announcement notice, not the composer", () => {
    h.granted = new Set(["ViewChannel", "ReadHistory", "AddReactions"]);
    const w = render("announcement");

    expect(w.text()).toContain("announcement_read_only");
    expect(w.find('[data-testid="composer-read-only"]').exists()).toBe(false);
    expect(w.find(".stub-enter-text").exists()).toBe(false);
  });

  test("a role allowed to post there gets the composer without ManageChannels", () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render("announcement");

    expect(w.find(".stub-enter-text").exists()).toBe(true);
    expect(w.text()).not.toContain("announcement_read_only");
  });
});

describe("editing a sent message", () => {
  const sent = { messageId: 7n, channelId: "c1", spaceId: "s1", text: "Raid at 20:00", entities: [] };

  test("picking Edit on a message puts it in the composer and cancelling takes it out", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render("announcement");

    w.findComponent({ name: "ChatView" }).vm.$emit("select-edit", sent);
    await w.vm.$nextTick();

    expect(w.find('[data-testid="composer-editing"]').exists()).toBe(true);
    expect(w.findComponent({ name: "EnterText" }).vm.$attrs.editing).toEqual(sent);

    w.findComponent({ name: "EnterText" }).vm.$emit("cancel-edit");
    await w.vm.$nextTick();

    expect(w.find('[data-testid="composer-editing"]').exists()).toBe(false);
  });

  test("switching channels drops the edit", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render();

    w.findComponent({ name: "ChatView" }).vm.$emit("select-edit", sent);
    await w.vm.$nextTick();
    await w.setProps({ selectedChannelId: "c2" });

    expect(w.find('[data-testid="composer-editing"]').exists()).toBe(false);
  });

  test("without SendMessages there is nothing to edit with", async () => {
    h.granted = new Set(["ViewChannel"]);
    const w = render();

    w.findComponent({ name: "ChatView" }).vm.$emit("select-edit", sent);
    await w.vm.$nextTick();

    expect(w.find('[data-testid="composer-editing"]').exists()).toBe(false);
  });
});

describe("author tools", () => {
  test("each channel gets a composer of its own, so text never follows the user to another channel", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    h.composerMounts = 0;
    const w = render();
    expect(h.composerMounts).toBe(1);

    await w.setProps({ selectedChannelId: "c2" });
    expect(h.composerMounts).toBe(2);
  });

  test("the scheduled chip follows the open channel, for a moderator without a composer too", async () => {
    h.granted = new Set(["ViewChannel", "ReadHistory", "ManageMessages"]);
    const w = render("announcement");

    expect(w.find(".stub-enter-text").exists()).toBe(false);
    expect(w.find(".stub-scheduled-chip").text()).toBe("c1");
    await w.setProps({ selectedChannelId: "c2" });
    expect(w.find(".stub-scheduled-chip").text()).toBe("c2");
  });

  test("a reader, who has no scheduled posts to see, does not get the chip (nor its request)", () => {
    h.granted = new Set(["ViewChannel", "ReadHistory"]);
    const w = render("announcement");

    expect(w.find(".stub-scheduled-chip").exists()).toBe(false);
  });

  test("an author gets the chip", () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render();

    expect(w.find(".stub-scheduled-chip").text()).toBe("c1");
  });
});

describe("replying", () => {
  const sent = { messageId: 7n, channelId: "c1", spaceId: "s1", text: "Raid at 20:00", entities: [], sender: "u1" };

  test("switching channels drops the reply target, so it never lands in another channel", async () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render();

    w.findComponent({ name: "ChatView" }).vm.$emit("select-reply", sent);
    await w.vm.$nextTick();
    expect(w.findComponent({ name: "EnterText" }).vm.$attrs["reply-to"]).toEqual(sent);

    await w.setProps({ selectedChannelId: "c2" });

    expect(w.findComponent({ name: "EnterText" }).vm.$attrs["reply-to"]).toBeNull();
    expect(w.text()).not.toContain("Raid at 20:00");
  });
});
