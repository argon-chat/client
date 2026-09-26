/**
 * A chat wired the way the chat view wires it (the message composable, grouping, the list and its
 * scroll engine, the navigation), mounted at a fixed size with the app's own stylesheet, and a
 * camera that records what is on screen in every frame, just before the browser paints it.
 *
 * The module mocks live in the test files (they must be hoisted there); this file only imports
 * what they replace.
 */
import "../../../packages/assets/styles/index.css";
import { defineComponent, h as hh, nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { useChatMessages } from "@/composables/useChatMessages";
import { useChatNavigation } from "@/composables/useChatNavigation";
import { useMessageGrouping } from "@/composables/useMessageGrouping";
import ChatMessageList from "@/components/chats/ChatMessageList.vue";
import { events, msg, world } from "./chatState";

export const VIEW = 600;

const Chat = defineComponent({
  setup(_, { expose }) {
    const chat = useChatMessages(() => "c1", () => "s1");
    const listRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
    const nav = useChatNavigation(chat, listRef);
    const { groupingMap } = useMessageGrouping(chat.messages, { lastReadId: () => world.read.lastReadId });
    expose({ chat, nav, listRef });
    return () =>
      hh("div", { style: { display: "flex", flexDirection: "column", width: "800px", height: `${VIEW}px` } }, [
        hh(ChatMessageList, {
          ref: listRef,
          class: "flex-1 min-h-0",
          source: () => chat.messages,
          groupingMap: groupingMap.value,
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

export const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

export async function settle() {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await nextTick();
    await frame();
  }
  await new Promise((r) => setTimeout(r, 20));
  await flushPromises();
  await frame();
}

/** Runs after the current frame is painted, as a network event or a decoded image would land. */
export const later = (fn: () => void) => setTimeout(fn, 0);

let mounted: VueWrapper | null = null;

export function unmountChat() {
  if (mounted?.vm) (mounted.vm as unknown as ChatVm).chat.cleanup();
  mounted?.unmount();
  mounted = null;
}

/** One frame as the browser painted it. */
export interface Shot {
  frame: number;
  scrollTop: number;
  /** From the bottom of the content. */
  distance: number;
  /** Rendered rows: where each message's body starts, in px from the top of the viewport. */
  rows: Map<bigint, number>;
  /** Rows whose slot showed another message than the one it is keyed by. */
  mixedUp: bigint[];
  /** How far the user scrolled during this frame, as the browser applied it. */
  userDelta: number;
  /** A size change in this frame was left for the next one: painted a frame late. */
  late?: boolean;
}

/** Opens the channel the way the chat view does: newest messages, pinned to the bottom. */
export async function openChat() {
  mounted = mount(Chat, { attachTo: document.body });
  const wrapper = mounted;
  const vm = wrapper.vm as unknown as ChatVm;
  const box = wrapper.find(".chat-scrollbar").element as HTMLElement;

  const toBottom = () => vm.listRef.scrollToBottomImmediate();
  vm.chat.subscribeToNewMessages("c1", toBottom);
  await vm.chat.loadInitialMessages(toBottom);
  await settle();

  function shoot(frameNo: number, userDelta: number): Shot {
    const view = box.getBoundingClientRect();
    const rows = new Map<bigint, number>();
    const mixedUp: bigint[] = [];
    for (const el of box.querySelectorAll<HTMLElement>("[data-msg-key]")) {
      const id = BigInt(el.dataset.msgKey!);
      // Where the message itself is, below its date line, unread line and author header.
      const body = el.querySelector<HTMLElement>("[data-row-body]") ?? el;
      rows.set(id, body.getBoundingClientRect().top - view.top);
      const shown = el.querySelector<HTMLElement>("[data-shown]")?.dataset.shown;
      if (shown !== undefined && shown !== el.dataset.msgKey) mixedUp.push(id);
    }
    return {
      frame: frameNo,
      scrollTop: box.scrollTop,
      distance: box.scrollHeight - box.scrollTop - box.clientHeight,
      rows,
      mixedUp,
      userDelta,
    };
  }

  /**
   * Films `frames` frames. At the start of each the script may scroll (by trackpad-sized steps, as
   * the browser would apply them) and set events going; just before each paint, what is on screen
   * is recorded. The camera is a ResizeObserver created after the list's own, so it sees the frame
   * after the list has had its say, as the screen will.
   */
  async function film(
    frames: number,
    script: { scroll?: (frame: number) => number; act?: (frame: number) => void } = {},
  ): Promise<Shot[]> {
    const shots: Shot[] = [];
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none;opacity:0";
    document.body.appendChild(sentinel);

    let frameNo = 0;
    let delta = 0;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));

    // The browser reports it after the frame's observers ran, before the paint.
    const onLate = (e: ErrorEvent) => {
      if (!String(e.message).includes("ResizeObserver loop")) return;
      const last = shots.at(-1);
      if (last) last.late = true;
    };
    window.addEventListener("error", onLate, true);

    // Between two frames, as input and the network arrive: the user's scroll (the browser applies
    // it at once and tells the page in the next frame) and the script's events.
    const between = () => {
      if (shots.length > frames) return;
      frameNo++;
      script.act?.(frameNo);
      const step = script.scroll?.(frameNo) ?? 0;
      if (step) {
        const before = box.scrollTop;
        box.scrollTop = before + step;
        delta += box.scrollTop - before;
      }
    };

    const camera = new ResizeObserver(() => {
      shots.push(shoot(frameNo, delta));
      delta = 0;
      if (shots.length > frames) {
        camera.disconnect();
        sentinel.remove();
        window.removeEventListener("error", onLate, true);
        // Out of this callback: a film started from here would observe inside the frame's loop.
        setTimeout(finish, 0);
        return;
      }
      setTimeout(between, 0);
    });
    camera.observe(sentinel);

    // A size change each frame keeps the camera firing once per frame.
    const tick = () => {
      if (shots.length > frames) return;
      sentinel.style.width = sentinel.style.width === "2px" ? "1px" : "2px";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    await finished;
    return shots;
  }

  const ids = () => vm.chat.messages.value.map((m) => m.messageId);
  const shot = () => shoot(0, 0);

  return {
    vm,
    box,
    wrapper,
    ids,
    film,
    shot,
    async scrollTo(value: number) {
      box.scrollTop = value;
      await settle();
    },
    /** A message arrives from the server. */
    arrive(id: bigint, sender?: string) {
      world.held.push(id);
      events.onNewMessageReceived.next(msg(id, sender));
    },
    /** The server rewrote a message in place (a reaction, an edit, a link card filled in). */
    update(id: bigint) {
      events.onMessageUpdated.next(msg(id));
    },
    remove(id: bigint) {
      world.held = world.held.filter((x) => x !== id);
      events.onMessageDeleted.next({ spaceId: "s1", channelId: "c1", messageId: id, byUserId: "mod" });
    },
  };
}

export type ChatUnderTest = Awaited<ReturnType<typeof openChat>>;

// ── What the frames must show ──

/**
 * Frames in which what the reader was looking at moved other than by their own scroll: the first
 * row starting inside the viewport in one frame, and still inside it once their scroll is applied,
 * must be in the next frame exactly where that scroll took it.
 */
export function jolts(shots: Shot[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const cur = shots[i];
    const inView = (top: number) => top >= -0.5 && top < VIEW;
    const reader = [...prev.rows]
      .filter(([, top]) => inView(top) && inView(top - cur.userDelta))
      .sort((a, b) => a[1] - b[1])[0];
    if (!reader) continue;
    const [id, top] = reader;
    const now = cur.rows.get(id);
    const expected = top - cur.userDelta;
    // Scrolled far enough away that the row left the rendered window: nothing to hold.
    if (now === undefined && (expected < -VIEW || expected > 2 * VIEW)) continue;
    if (now === undefined) out.push(`frame ${cur.frame}: row ${id} was taken off the screen`);
    else if (Math.abs(now - expected) > 1)
      out.push(`frame ${cur.frame}: row ${id} at ${now.toFixed(1)}, expected ${expected.toFixed(1)} (scrolled ${cur.userDelta.toFixed(1)})`);
  }
  return out;
}

/** Frames in which a slot showed another message than its own. */
export const mixups = (shots: Shot[]) =>
  shots.filter((s) => s.mixedUp.length).map((s) => `frame ${s.frame}: rows ${s.mixedUp.join(", ")} showed another message`);

/** Frames in which a row's new size reached the screen a frame after the row did. */
export const late = (shots: Shot[]) =>
  shots.filter((s) => s.late).map((s) => `frame ${s.frame}: a size change was left for the next frame`);

/** Frames in which the list, meant to sit at the bottom, did not. */
export const offBottom = (shots: Shot[]) =>
  shots.filter((s) => s.distance > 1).map((s) => `frame ${s.frame}: ${s.distance.toFixed(1)}px from the bottom`);
