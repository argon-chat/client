import { ref, nextTick, type ShallowRef, onMounted, onUnmounted } from "vue";
import { type ArgonMessage, EntityType } from "@argon/glue";
import { useChatVirtualScroller, type VirtualItem } from "@/composables/useChatVirtualScroller";
import { useHeavyAnimationCheck } from "@/composables/useHeavyAnimationCheck";
import type { ChatMessage } from "@/composables/useChatMessages";

const SCROLL_NEAR_TOP_THRESHOLD = 300;
const SCROLL_NEAR_BOTTOM_THRESHOLD = 120;
/** Distance from bottom (px) within which the list auto-follows new content.
    Matches the views' "scrolled up" threshold so following + FAB stay in sync. */
const SCROLL_PIN_THRESHOLD = 100;

/** Selector for anchor-able message elements inside the scroll container */
const ANCHOR_QUERY = "[data-msg-key]";

export interface ScrollAnchorConfig {
  /** Scrollable container */
  el: HTMLElement;
  /** Selector for anchorable children */
  selector: string;
  /** true = anchor from top (prepend scenario), false = anchor from bottom */
  anchorTop?: boolean;
}

interface Snapshot {
  node: HTMLElement;
  rect: DOMRect;
}

export class PositionDeltaAnchor {
  private el: HTMLElement;
  private selector: string;
  private anchorTop: boolean;

  private savedScrollTop = 0;
  private savedScrollHeight = 0;
  private savedClientHeight = 0;
  private savedDelta = 0; // scrollHeight - scrollTop (for fallback)
  private atEnd = false;
  private anchors: Snapshot[] = [];

  constructor(cfg: ScrollAnchorConfig) {
    this.el = cfg.el;
    this.selector = cfg.selector;
    this.anchorTop = cfg.anchorTop ?? true;
  }

  /** Capture current state. Call before DOM mutation. */
  save(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.el;
    this.savedScrollTop = scrollTop;
    this.savedScrollHeight = scrollHeight;
    this.savedClientHeight = clientHeight;
    this.savedDelta = this.anchorTop
      ? scrollHeight - scrollTop
      : scrollTop;
    this.atEnd = scrollHeight - Math.ceil(scrollTop + clientHeight) <= 1;
    this.anchors = this.collectVisible();
  }

  /** After DOM mutation, restore scroll so the anchor stays in place. */
  restore(): void {
    const { scrollTop, scrollHeight } = this.el;
    this.savedScrollHeight = scrollHeight;

    if (!this.anchors.length && this.selector) {
      this.applyScroll(this.anchorTop ? scrollHeight : 0);
      return;
    }

    let pick = this.pickAnchor();

    // If anchor was removed from DOM, try re-collecting
    if (!pick?.node?.parentElement) {
      this.anchors = this.collectVisible();
      pick = this.pickAnchor();
      if (!pick) {
        this.fallback();
        return;
      }
    }

    const { node, rect: before } = pick;
    const after = node.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();

    const overTop = before.top < box.top;
    const overBot = before.bottom > box.bottom;

    // Which edge of the element do we track?
    let edge: "top" | "bottom" = this.anchorTop ? "top" : "bottom";
    if (this.anchorTop ? (overTop && !overBot) : (overBot && !overTop)) {
      edge = this.anchorTop ? "bottom" : "top";
    }

    const shift = after[edge] - before[edge];
    if (shift === 0 && !this.atEnd) return;
    if (!shift) return;

    this.applyScroll(scrollTop + shift);
  }

  /** Swap a DOM reference (useful when Vue recreates nodes). */
  replaceSaved(from: HTMLElement, to: HTMLElement): void {
    const i = this.anchors.findIndex((s) => s.node === from);
    if (i !== -1) this.anchors[i].node = to;
  }

  // ─── internals ───

  private collectVisible(): Snapshot[] {
    if (!this.selector) return [];

    const box = this.el.getBoundingClientRect();
    const nodes = Array.from(this.el.querySelectorAll(this.selector)) as HTMLElement[];
    const out: Snapshot[] = [];

    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      const visible =
        r.bottom > box.top && r.top < box.bottom &&
        r.right > box.left && r.left < box.right;

      if (visible) {
        out.push({ node, rect: r });
      } else if (out.length) {
        break;
      }
    }

    if (!out.length && nodes.length) {
      out.push({ node: nodes[0], rect: nodes[0].getBoundingClientRect() });
    }
    return out;
  }

  private pickAnchor(): Snapshot | undefined {
    return this.anchors[this.anchorTop ? 0 : this.anchors.length - 1];
  }

  private applyScroll(value: number): void {
    this.el.scrollTop = value;
    this.savedScrollTop = value;
  }

  private fallback(): void {
    const target = this.anchorTop
      ? this.savedScrollHeight - this.savedDelta
      : this.savedDelta;
    this.applyScroll(Math.max(0, target));
  }

  getSaved() {
    return {
      scrollHeight: this.savedScrollHeight,
      scrollTop: this.savedScrollTop,
      clientHeight: this.savedClientHeight,
    };
  }
}


// ── Adaptive height estimates by message content type ──

export function estimateMessageHeight(msg: ArgonMessage | undefined, _index?: number): number {
  if (!msg) return 64;

  const entities = msg.entities ?? [];
  const hasSystemEntity = entities.some(
    (e) =>
      e.type === EntityType.SystemCallStarted ||
      e.type === EntityType.SystemCallEnded ||
      e.type === EntityType.SystemCallTimeout ||
      e.type === EntityType.SystemUserJoined,
  );
  if (hasSystemEntity) return 40;

  const attachments = entities.filter((e) => e.type === EntityType.Attachment);
  const imageAttachments = attachments.filter((a: any) => {
    if (a.contentType?.startsWith("image/")) return true;
    const ext = a.fileName?.split(".").pop()?.toLowerCase();
    return !!ext && ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
  });
  const fileAttachments = attachments.length - imageAttachments.length;
  const gifEntities = entities.filter((e) => e.type === EntityType.Gif);

  let height = 32;

  if (imageAttachments.length === 1) height += 300;
  else if (imageAttachments.length >= 2 && imageAttachments.length <= 4) height += 160;
  else if (imageAttachments.length > 4) height += 120 * Math.ceil(imageAttachments.length / 3);

  for (const gif of gifEntities) {
    const natW = (gif as any).width || 300;
    const natH = (gif as any).height || 200;
    const scale = Math.min(1, 320 / natW, 400 / natH);
    height += Math.round(natH * scale);
  }

  if (fileAttachments > 0) height += 48 * fileAttachments;

  const textLen = msg.text?.length ?? 0;
  if (textLen > 0) {
    if (textLen <= 40) height += 28;
    else if (textLen <= 100) height += 42;
    else if (textLen <= 300) height += 72;
    else height += 100;
  }

  if (msg.replyId) height += 44;

  return Math.max(40, height);
}

export type ScrollStateCallback = (info: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
}) => void;

export function useChatScroll(
  messages: ShallowRef<ChatMessage[]>,
) {
  const parentRef = ref<HTMLElement>();
  const chatWidth = ref(0);

  let onScrollTopCallback: (() => void) | null = null;
  let onScrollCallback: ScrollStateCallback | null = null;

  const { isAnimating } = useHeavyAnimationCheck();

  // ── Virtual scroller ──

  const scroller = useChatVirtualScroller<ChatMessage>({
    list: messages,
    scrollContainer: parentRef,
    estimateHeight: (item, index) => estimateMessageHeight(item, index),
    getKey: (item) => item.messageId?.toString() ?? Math.random().toString(),
    pinThreshold: SCROLL_PIN_THRESHOLD,
    nearBottomThreshold: SCROLL_NEAR_BOTTOM_THRESHOLD,
    nearTopThreshold: SCROLL_NEAR_TOP_THRESHOLD,
    onNearBottom: () => {
      if (!isAnimating.value && onScrollCallback) {
        const container = parentRef.value;
        if (container) {
          const { scrollTop, scrollHeight, clientHeight } = container;
          onScrollCallback({
            scrollTop,
            scrollHeight,
            clientHeight,
            distanceFromBottom: scrollHeight - scrollTop - clientHeight,
          });
        }
      }
    },
    onNearTop: () => {
      if (!isAnimating.value && onScrollTopCallback) {
        onScrollTopCallback();
      }
    },
  });

  // ── Additional scroll state reporting ──
  // The virtual scroller handles its own scroll events for rendering, but the UI
  // (FAB, unread counter, ACK) also needs scroll state on every scroll — not only
  // when near the bottom. Report it here, rAF-throttled.

  let scrollReportTicking = false;

  function handleScrollReport() {
    if (scrollReportTicking) return;
    scrollReportTicking = true;
    requestAnimationFrame(() => {
      scrollReportTicking = false;
      const box = parentRef.value;
      if (!box) return;
      // Skip mid heavy animation; the scroller self-corrects via ResizeObserver.
      if (isAnimating.value) return;

      const { scrollTop, scrollHeight, clientHeight } = box;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      onScrollCallback?.({ scrollTop, scrollHeight, clientHeight, distanceFromBottom });
    });
  }

  // ── ScrollSaver for anchor-based scroll restoration ──

  function createScrollSaver(anchorTop = true): PositionDeltaAnchor {
    return new PositionDeltaAnchor({
      el: parentRef.value!,
      selector: ANCHOR_QUERY,
      anchorTop,
    });
  }

  // ── Public methods ──

  const scrollToBottomImmediate = () => {
    // Render from the end of the list so the bottom items are in DOM immediately
    scroller.renderAtBottom();
  };

  const scrollToBottom = () => {
    // Also use renderAtBottom to avoid the bounce-back from mismatched spacers
    scroller.renderAtBottom();
  };

  const scrollToIndex = (index: number) => {
    scroller.scrollToIndex(index, "start");
  };

  const onScrollNearTop = (callback: () => void) => {
    onScrollTopCallback = callback;
  };

  const onScroll = (callback: ScrollStateCallback) => {
    onScrollCallback = callback;
  };

  const updateChatWidth = () => {
    if (parentRef.value) {
      chatWidth.value = parentRef.value.offsetWidth;
    }
  };

  onMounted(() => {
    if (parentRef.value) {
      parentRef.value.addEventListener("scroll", handleScrollReport, { passive: true });
      chatWidth.value = parentRef.value.offsetWidth;
    }
    window.addEventListener("resize", updateChatWidth);
  });

  onUnmounted(() => {
    if (parentRef.value) {
      parentRef.value.removeEventListener("scroll", handleScrollReport);
    }
    window.removeEventListener("resize", updateChatWidth);
  });

  return {
    parentRef,
    chatWidth,
    /** Virtual items to render in template */
    renderedItems: scroller.renderedItems,
    /** Total height of the virtual content */
    totalHeight: scroller.totalHeight,
    /** Spacer heights for flow layout */
    topSpace: scroller.topSpace,
    bottomSpace: scroller.bottomSpace,
    /** Live distance from the bottom (px) — shared source of truth */
    distanceFromBottom: scroller.distanceFromBottom,
    /** Whether the viewport is pinned to the bottom */
    atBottom: scroller.atBottom,
    /** Register element for measurement */
    measureElement: scroller.measureElement,
    scrollToBottomImmediate,
    scrollToBottom,
    scrollToIndex,
    onScrollNearTop,
    onScroll,
    /** Create a ScrollSaver for anchor-based position preservation */
    createScrollSaver,
    /** Reset scroller state (on channel switch) */
    resetScroller: scroller.resetState,
    /** Force schedule an update */
    scheduleUpdate: scroller.scheduleUpdate,
    /** Heavy animation state */
    isAnimating,
  };
}
