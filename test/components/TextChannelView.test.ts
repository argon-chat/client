/**
 * The composer of a text channel, for a member without SendMessages there.
 *
 * It used to render anyway — an input that let the user type and then failed on send, or a disabled
 * box that looked broken. A channel the user cannot write in now shows a short read-only notice in
 * the composer's place, decided per channel (an overwrite can make one channel read-only). Files
 * dragged onto a channel without AttachFiles are not taken either.
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
  return { default: { name: "ChatView", setup: () => () => hh("div", { class: "stub-chat-view" }) } };
});
vi.mock("@/components/chats/EnterText.vue", async () => {
  const { h: hh } = await import("vue");
  return {
    default: {
      name: "EnterText",
      setup: (_: unknown, { expose }: any) => {
        expose({ handleExternalFiles: h.handleExternalFiles, focus() {} });
        return () => hh("div", { class: "stub-enter-text" });
      },
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
  test("a member who may not post there gets the follow notice, not the read-only one", () => {
    h.granted = new Set(["ViewChannel", "SendMessages"]);
    const w = render("announcement");

    expect(w.text()).toContain("follow_to_get_updates");
    expect(w.find('[data-testid="composer-read-only"]').exists()).toBe(false);
    expect(w.find(".stub-enter-text").exists()).toBe(false);
  });
});
