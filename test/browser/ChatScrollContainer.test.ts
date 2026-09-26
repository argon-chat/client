/**
 * The message list's scroll container moving through a channel's history, in a real browser: what
 * is on screen after opening a channel, after jumping far back (a pin, a reply's original), while
 * paging in either direction, after returning to the present, while messages arrive, and while
 * media in the rows finish loading at heights the estimates did not know.
 *
 * Everything below the server is real: the message composable with its cache on the browser's
 * IndexedDB, the list, its scroll engine with the browser's ResizeObserver, and the navigation the
 * chat view uses. The server is an in-memory channel. A row is a block as tall as its content:
 * its estimate until the test says its media loaded, then the height they turned out to have.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed, defineComponent, h as hh, nextTick, reactive, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { Subject } = await import("rxjs");
  const { reactive: r } = await import("vue");
  return {
    onNewMessageReceived: new Subject<any>(),
    onMessageUpdated: new Subject<any>(),
    onMessageDeleted: new Subject<any>(),
    onMessagePublished: new Subject<any>(),
    held: [] as bigint[],
    /** A row's height once its content loaded, by message id; absent: the estimate. */
    real: r(new Map<string, number>()),
    estimate: (_id: string): number => 60,
    stub: (name: string) => ({ default: { name, setup: () => () => null } }),
  };
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/toneStore", () => ({ useTone: () => ({ playNotificationSound() {} }) }));
vi.mock("@/store/data/notificationStore", () => ({ useNotificationStore: () => ({ effectiveMuteLevel: () => 0 }) }));

// The channel on the server: ids in `h.held`, answered newest first as the real queries are.
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: {
      async QueryMessages(_s: string, _c: string, from: bigint | null, limit: number) {
        return page(desc().filter((id) => from === null || id < from).slice(0, limit));
      },
      async QueryMessagesAround(_s: string, _c: string, id: bigint, older: number, newer: number) {
        const before = desc().filter((x) => x <= id).slice(0, older + 1);
        const after = asc().filter((x) => x > id).slice(0, newer + 1);
        return {
          messages: page([...after.slice(0, newer).reverse(), ...before.slice(0, older)]),
          hasOlder: before.length > older,
          hasNewer: after.length > newer,
          containsAnchor: older > 0 && before[0] === id,
        };
      },
    },
  }),
}));
vi.mock("@/store/data/poolStore", async () => {
  const { useMessageStore } = await import("@/store/data/messageStore");
  return {
    usePoolStore: () => {
      const store = useMessageStore();
      return {
        onNewMessageReceived: h.onNewMessageReceived,
        onMessageUpdated: h.onMessageUpdated,
        onMessageDeleted: h.onMessageDeleted,
        onMessagePublished: h.onMessagePublished,
        loadCachedMessages: store.loadCachedMessages,
        loadOlderCachedMessages: store.loadOlderCachedMessages,
        reconcileMessages: store.reconcileMessages,
        cacheMessages: store.cacheMessages,
        cacheMessage: store.cacheMessage,
        removeCachedMessage: store.removeCachedMessage,
        getMessageById: store.getMessageById,
      };
    },
  };
});

// A row is a block as tall as its content: the estimate, until its media have loaded.
vi.mock("@/components/MessageItem.vue", async () => {
  const { defineComponent: dc, h: hx } = await import("vue");
  return {
    default: dc({
      name: "MessageItem",
      props: ["message"],
      emits: ["scroll-to-message"],
      setup: (props) => () => {
        const key = String(props.message.messageId);
        const height = h.real.get(key) ?? h.estimate(key);
        return hx("div", { class: "row", style: { height: `${height}px`, boxSizing: "border-box" } }, props.message.text);
      },
    }),
  };
});
vi.mock("@/components/chats/ImageLightbox.vue", () => h.stub("ImageLightbox"));
vi.mock("@/components/chats/DateSeparator.vue", () => h.stub("DateSeparator"));
vi.mock("@/components/chats/UnreadSeparator.vue", () => h.stub("UnreadSeparator"));
vi.mock("@/components/shared/EmptyStateArt.vue", () => h.stub("EmptyStateArt"));

import { EntityType } from "@argon/glue";
import { db, ensureDbOpen } from "@/store/db/dexie";
import { useChatMessages } from "@/composables/useChatMessages";
import { useChatNavigation } from "@/composables/useChatNavigation";
import { estimateMessageHeight } from "@/composables/useChatScroll";
import ChatMessageList from "@/components/chats/ChatMessageList.vue";

const ROW = 60;
const VIEW = 600;

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
const asc = () => [...h.held].sort(cmp);
const desc = () => asc().reverse();
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));
const page = (ids: bigint[]) => ids.map((id) => msg(id));

// ── What a message carries ──

type Kind = "text" | "image" | "file" | "link" | "gif";
/** Messages that carry more than their text, by id. */
const kinds = reactive(new Map<bigint, Kind>());

function entitiesOf(kind: Kind): any[] {
  switch (kind) {
    case "image":
      return [{ type: EntityType.Attachment, fileId: "f", fileName: "photo.png", contentType: "image/png", width: 800, height: 600 }];
    case "file":
      return [{ type: EntityType.Attachment, fileId: "f", fileName: "notes.pdf", contentType: "application/pdf" }];
    case "link":
      return [{ type: EntityType.LinkPreview, url: "https://argon.gl", title: "Argon", description: "chat" }];
    case "gif":
      return [{ type: EntityType.Gif, gifId: "g", width: 300, height: 200 }];
    default:
      return [];
  }
}

function msg(messageId: bigint, sender = "u1") {
  const entities = entitiesOf(kinds.get(messageId) ?? "text");
  return { messageId, channelId: "c1", spaceId: "s1", text: `m${messageId}`, entities, sender, replyId: null } as any;
}
h.estimate = (key: string) => estimateMessageHeight(msg(BigInt(key)));

// ── The chat, wired the way the chat view wires it ──

const Chat = defineComponent({
  setup(_, { expose }) {
    const chat = useChatMessages(() => "c1", () => "s1");
    const listRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
    const nav = useChatNavigation(chat, listRef);
    const grouping = computed(() =>
      chat.messages.value.map(() => ({ isFirstInGroup: true, isLastInGroup: true, isGrouped: false, showDate: false, showUnread: false })),
    );
    expose({ chat, nav, listRef });
    return () =>
      hh("div", { class: "chat-host" }, [
        hh(ChatMessageList, {
          ref: listRef,
          class: "flex-1 min-h-0",
          source: () => chat.messages,
          groupingMap: grouping.value as any,
          getMessageById: chat.getMessageById,
          isLoading: chat.isLoading.value,
          isLoadingOlder: chat.isLoadingOlder.value,
          isScrolledUp: chat.isScrolledUp.value,
          newMessagesCount: chat.newMessagesCount.value,
          detached: !chat.hasReachedLatest.value,
          onNearTop: nav.onNearTop,
          onScrollState: nav.onScrollState,
          onJumpToMessage: (id: bigint) => void nav.jumpToMessage(id),
          onJumpToPresent: () => void nav.goToPresent(),
        }),
      ]);
  },
});

type ChatVm = {
  chat: ReturnType<typeof useChatMessages>;
  nav: ReturnType<typeof useChatNavigation>;
  listRef: InstanceType<typeof ChatMessageList>;
};

let wrapper: VueWrapper | null = null;

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
async function settle() {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await nextTick();
    await frame();
  }
  await new Promise((r) => setTimeout(r, 20));
  await flushPromises();
  await frame();
}

/** Opens the channel the way the chat view does: newest messages, pinned to the bottom. */
async function open() {
  wrapper = mount(Chat, { attachTo: document.body });
  const vm = wrapper.vm as unknown as ChatVm;
  const box = wrapper.find(".chat-scrollbar").element as HTMLElement;

  const toBottom = () => vm.listRef.scrollToBottomImmediate();
  vm.chat.subscribeToNewMessages("c1", toBottom);
  await vm.chat.loadInitialMessages(toBottom);
  await settle();

  const rows = () =>
    [...box.querySelectorAll<HTMLElement>("[data-msg-key]")].map((el) => {
      const rect = el.getBoundingClientRect();
      const view = box.getBoundingClientRect();
      return { id: BigInt(el.dataset.msgKey!), top: rect.top - view.top, bottom: rect.bottom - view.top };
    });
  const ids = () => vm.chat.messages.value.map((m) => m.messageId);

  return {
    vm,
    box,
    ids,
    /** Where a message's row starts, in px from the top of the viewport; undefined when not rendered. */
    onScreen: (id: bigint) => {
      const row = rows().find((r) => r.id === id);
      return row ? Math.round(row.top) : undefined;
    },
    distanceFromBottom: () => Math.round(box.scrollHeight - box.scrollTop - box.clientHeight),
    /** The messages whose rows are at least partly in the viewport. */
    visible: () => rows().filter((r) => r.bottom > 0.5 && r.top < VIEW - 0.5).map((r) => r.id),
    /** Rendered rows wholly above the viewport (the overscan), whose growth the reader must not feel. */
    aboveView: () => rows().filter((r) => r.bottom <= 0.5).map((r) => r.id),
    /** Rendered rows wholly below the viewport. */
    belowView: () => rows().filter((r) => r.top >= VIEW - 0.5).map((r) => r.id),
    rendered: () => wrapper!.findAll(".row").map((r) => r.text()),
    async scrollTo(value: number) {
      box.scrollTop = value;
      await settle();
    },
    async scrollBy(delta: number) {
      box.scrollTop = box.scrollTop + delta;
      await settle();
    },
    /** These rows' content finished loading at these heights (an image, a file card, a link preview). */
    async loaded(changes: [bigint, number][]) {
      for (const [id, height] of changes) h.real.set(String(id), height);
      await settle();
    },
  };
}

beforeAll(() => {
  // The layout the app's stylesheet gives the list; the test loads none of it.
  const style = document.createElement("style");
  style.textContent = `
    body { margin: 0; }
    .chat-host { display: flex; flex-direction: column; width: 800px; height: ${VIEW}px; }
    .relative { position: relative; }
    .absolute { position: absolute; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .flex-1 { flex: 1 1 0%; }
    .min-h-0 { min-height: 0; }
    .overflow-y-scroll { overflow-y: scroll; }
    .w-full { width: 100%; }
  `;
  document.head.appendChild(style);
});

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.messages.clear();
  h.held = range(1, 300);
  kinds.clear();
  h.real.clear();
});

afterEach(() => {
  wrapper?.vm && (wrapper.vm as unknown as ChatVm).chat.cleanup();
  wrapper?.unmount();
  wrapper = null;
});

describe("the chat scroll container", () => {
  test("opens a channel on its newest messages, at the bottom", async () => {
    const c = await open();

    expect(c.box.clientHeight).toBe(VIEW);
    expect(c.ids()).toEqual(range(251, 300));
    expect(c.distanceFromBottom()).toBe(0);
    expect(c.visible().at(-1)).toBe(300n);
  });

  test("a jump to a message already loaded scrolls to it without replacing the list", async () => {
    const c = await open();

    expect(await c.vm.nav.jumpToMessage(270n)).toBe(true);
    await settle();

    expect(c.ids()).toEqual(range(251, 300));
    expect(c.visible()).toContain(270n);
    expect(c.vm.chat.hasReachedLatest.value).toBe(true);
  });

  test("a jump far back opens the history around the message, centred, and stays there", async () => {
    const c = await open();

    expect(await c.vm.nav.jumpToMessage(100n)).toBe(true);
    await settle();

    expect(c.ids()).toEqual(range(76, 125));
    expect(c.onScreen(100n)! + ROW / 2).toBe(VIEW / 2);

    // Nothing drags it anywhere afterwards: not the pin to the bottom the list had before the jump.
    const before = c.box.scrollTop;
    for (let i = 0; i < 3; i++) await settle();
    expect(c.box.scrollTop).toBe(before);
    expect(c.distanceFromBottom()).toBeGreaterThan(0);
  });

  test("scrolling down from a jump pages newer history in below, without moving what is on screen", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    await c.scrollTo(c.box.scrollHeight);
    const reading = c.visible()[0];
    const at = c.onScreen(reading);
    await settle();

    expect(c.ids().at(-1)).toBeGreaterThan(125n);
    expect(c.onScreen(reading)).toBe(at);
    expect(c.vm.chat.hasReachedLatest.value).toBe(false);
    expect(c.distanceFromBottom()).toBeGreaterThan(0);
  });

  test("scrolling up from a jump pages older history in above, without moving what is on screen", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    await c.scrollTo(0);
    await settle();

    expect(c.ids()[0]).toBeLessThan(76n);
    expect(c.onScreen(76n)).toBe(0);
  });

  test("paging down all the way reaches the present, and the list follows new messages again", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    for (let i = 0; i < 10 && !c.vm.chat.hasReachedLatest.value; i++) await c.scrollTo(c.box.scrollHeight);

    expect(c.vm.chat.hasReachedLatest.value).toBe(true);
    expect(c.ids().at(-1)).toBe(300n);
    const loaded = c.ids();
    expect(loaded).toEqual(range(Number(loaded[0]), 300));

    await c.scrollTo(c.box.scrollHeight);
    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();

    expect(c.ids().at(-1)).toBe(301n);
    expect(c.distanceFromBottom()).toBe(0);
  });

  test("a message arriving while away is held and counted; the list and the view do not move", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();
    const ids = c.ids();
    const top = c.box.scrollTop;

    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();

    expect(c.ids()).toEqual(ids);
    expect(c.box.scrollTop).toBe(top);
    expect(c.vm.chat.newMessagesCount.value).toBe(1);
    expect(wrapper!.find('[data-testid="older-history-bar"]').text()).toContain("1");
  });

  test("reaching the bottom of history opened by a jump keeps the count of what is still held", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();
    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();

    await c.scrollTo(0);
    await c.scrollTo(c.box.scrollHeight);

    expect(c.vm.chat.hasReachedLatest.value).toBe(false);
    expect(c.vm.chat.newMessagesCount.value).toBe(1);
  });

  test("the way back from older history shows the newest messages at the bottom, and follows again", async () => {
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    await wrapper!.get('[data-testid="jump-to-present"]').trigger("click");
    await settle();

    expect(c.ids()).toEqual(range(251, 300));
    expect(c.distanceFromBottom()).toBe(0);
    expect(wrapper!.find('[data-testid="older-history-bar"]').exists()).toBe(false);

    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();
    expect(c.ids().at(-1)).toBe(301n);
    expect(c.distanceFromBottom()).toBe(0);
  });

  test("a reply whose original is far back opens it like a pin", async () => {
    const c = await open();

    wrapper!.findAllComponents({ name: "MessageItem" }).at(-1)!.vm.$emit("scroll-to-message", 40n);
    await settle();

    expect(c.ids()).toContain(40n);
    expect(c.visible()).toContain(40n);
    expect(c.vm.chat.hasReachedLatest.value).toBe(false);
  });

  test("scrolled up in the present, a new message does not move the view; at the bottom it follows", async () => {
    const c = await open();

    await c.scrollTo(600);
    const top = c.box.scrollTop;
    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();

    expect(c.ids().at(-1)).toBe(301n);
    expect(c.box.scrollTop).toBe(top);

    await c.scrollTo(c.box.scrollHeight);
    h.held.push(302n);
    h.onNewMessageReceived.next(msg(302n));
    await settle();
    expect(c.distanceFromBottom()).toBe(0);
  });
});

describe("loading media in the scroll container", () => {
  // Estimates and real heights differ the way they do in the app: an image placeholder is not the
  // picture, a link card fills in after the send, a file card is a few pixels off.
  const IMAGE = 420;
  const LINK = 230;
  const FILE = 112;
  const GIF = 240;

  /** Every other message from `from` to `to` carries media, cycling through the kinds. */
  function withMedia(from: number, to: number) {
    const cycle: Kind[] = ["image", "link", "file", "gif"];
    for (let i = from; i <= to; i += 2) kinds.set(BigInt(i), cycle[Math.floor(i / 2) % cycle.length]);
  }
  const realFor = (id: bigint) => ({ image: IMAGE, link: LINK, file: FILE, gif: GIF, text: ROW })[kinds.get(id) ?? "text"];
  const loadedAt = (ids: bigint[]) => ids.filter((id) => kinds.has(id)).map((id) => [id, realFor(id)] as [bigint, number]);

  test("a channel opened on media ends at the bottom once they have loaded", async () => {
    withMedia(281, 300);
    const c = await open();
    expect(c.distanceFromBottom()).toBe(0);

    // The pictures come in one after another, bottom first.
    for (const id of c.visible().filter((id) => kinds.has(id)).reverse()) {
      await c.loaded([[id, realFor(id)]]);
      expect(c.distanceFromBottom()).toBe(0);
    }
  });

  test("media above the reader loading, one after another, does not move what they are reading", async () => {
    withMedia(251, 300);
    const c = await open();
    await c.scrollTo(c.box.scrollHeight - VIEW - 1500);

    const reading = c.visible()[1];
    const at = c.onScreen(reading);
    const above = c.aboveView().filter((id) => kinds.has(id));
    expect(above.length).toBeGreaterThan(0);

    for (const id of above) {
      await c.loaded([[id, realFor(id)]]);
      expect(c.onScreen(reading)).toBe(at);
    }
  });

  test("several pieces of media loading in one frame, above the reader, still do not move it", async () => {
    withMedia(251, 300);
    const c = await open();
    await c.scrollTo(c.box.scrollHeight - VIEW - 1500);

    const reading = c.visible()[1];
    const at = c.onScreen(reading);
    await c.loaded(loadedAt(c.aboveView()));

    expect(c.onScreen(reading)).toBe(at);
  });

  test("media below the reader loading, while scrolled up, does not pull the view down", async () => {
    withMedia(251, 300);
    const c = await open();
    await c.scrollTo(c.box.scrollHeight - VIEW - 1500);

    const reading = c.visible()[0];
    const at = c.onScreen(reading);
    const below = c.belowView().filter((id) => kinds.has(id));
    expect(below.length).toBeGreaterThan(0);

    await c.loaded(loadedAt(below));

    expect(c.onScreen(reading)).toBe(at);
    expect(c.distanceFromBottom()).toBeGreaterThan(0);
  });

  test("scrolling up through media whose real heights differ from the estimates moves by exactly the scroll", async () => {
    withMedia(251, 300);
    for (let i = 251; i <= 300; i++) if (kinds.has(BigInt(i))) h.real.set(String(i), realFor(BigInt(i)));
    const c = await open();

    for (let step = 0; step < 8; step++) {
      const reading = c.visible()[1];
      const at = c.onScreen(reading)!;
      await c.scrollBy(-200);
      if (c.box.scrollTop === 0) break;
      // Rows entering above are measured at their real height as they render; the reader feels
      // only their own 200px.
      expect(c.onScreen(reading)).toBe(at + 200);
    }
  });

  test("a picture loading in the row cut by the top edge does not move what is under it", async () => {
    withMedia(251, 300);
    const c = await open();
    await c.scrollTo(c.box.scrollHeight - VIEW - 1500);

    // Bring an image row to straddle the top edge.
    const cut = c.visible().find((id) => kinds.get(id) === "image")!;
    await c.scrollTo(c.box.scrollTop + c.onScreen(cut)! + 100);
    expect(c.onScreen(cut)).toBe(-100);

    const reading = c.visible().find((id) => id > cut)!;
    const at = c.onScreen(reading);
    await c.loaded([[cut, IMAGE]]);

    expect(c.onScreen(reading)).toBe(at);
  });

  test("after a jump, media around the message loading keeps it where it was put", async () => {
    withMedia(70, 130);
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();
    const at = c.onScreen(100n);

    await c.loaded(loadedAt(c.aboveView()));
    expect(c.onScreen(100n)).toBe(at);

    await c.loaded(loadedAt(c.belowView()));
    expect(c.onScreen(100n)).toBe(at);
  });

  test("the jumped-to message's own picture loading does not move its top", async () => {
    kinds.set(100n, "image");
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();
    const at = c.onScreen(100n);

    await c.loaded([[100n, IMAGE]]);

    expect(c.onScreen(100n)).toBe(at);
  });

  test("older history with media paged in above the reader keeps the view as it loads", async () => {
    withMedia(1, 300);
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    await c.scrollTo(0);
    expect(c.ids()[0]).toBeLessThan(76n);
    const reading = c.visible()[1];
    const at = c.onScreen(reading);

    await c.loaded(loadedAt(c.aboveView()));
    expect(c.onScreen(reading)).toBe(at);
  });

  test("newer history with media paged in below the reader, after a jump, keeps the view as it loads", async () => {
    withMedia(1, 300);
    const c = await open();
    await c.vm.nav.jumpToMessage(100n);
    await settle();

    await c.scrollTo(c.box.scrollHeight);
    expect(c.ids().at(-1)).toBeGreaterThan(125n);
    const reading = c.visible()[0];
    const at = c.onScreen(reading);

    await c.loaded(loadedAt(c.belowView()));
    expect(c.onScreen(reading)).toBe(at);
  });

  test("a new message with a picture arriving at the bottom stays at the bottom as the picture loads", async () => {
    const c = await open();

    kinds.set(301n, "image");
    h.held.push(301n);
    h.onNewMessageReceived.next(msg(301n));
    await settle();
    expect(c.distanceFromBottom()).toBe(0);

    await c.loaded([[301n, IMAGE]]);
    expect(c.distanceFromBottom()).toBe(0);
  });
});
