import {
  ref,
  shallowRef,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  type Ref,
  type ShallowRef,
} from "vue";

// ── Types ──

export interface VirtualItem<T> {
  payload: T;
  index: number;
  height: number;
  offset: number;
  key: string | number;
}

export interface ChatVirtualScrollerOptions<T> {
  list: Ref<T[]> | ShallowRef<T[]>;
  scrollContainer: Ref<HTMLElement | undefined>;
  estimateHeight: (item: T, index: number) => number;
  getKey: (item: T, index: number) => string | number;
  /** Accepted for API compatibility — no longer used (window is viewport-bounded). */
  maxBatchSize?: number;
  verticalPadding?: number;
  /** Distance from bottom (px) within which we auto-follow new content. */
  pinThreshold?: number;
  nearBottomThreshold?: number;
  nearTopThreshold?: number;
  onNearBottom?: () => void;
  onNearTop?: () => void;
  /**
   * Whether content added below follows the viewport down while it sits at the bottom. Off while
   * the list shows a stretch of history paged in below the reader, who stays where they read.
   */
  followBottom?: () => boolean;
  /**
   * How far down its row an item's content starts (below a date line, an author header). What
   * stays put under the reader is that content: when something above it inside the row comes or
   * goes, the row's top moves and the content does not.
   */
  leadOf?: (el: HTMLElement) => number;
}

/**
 * Custom virtual scroller for chat.
 *
 * Design notes (see plan): cumulative offsets are cached and recomputed
 * incrementally from the first dirty index; the visible window is found with a
 * binary search; element heights flow in through a single ResizeObserver (no
 * per-render getBoundingClientRect); "pinned to bottom" is a single tolerant
 * source of truth; programmatic scrolls are detected by value comparison rather
 * than an event counter.
 */
export function useChatVirtualScroller<T>(opts: ChatVirtualScrollerOptions<T>) {
  const {
    list,
    scrollContainer,
    estimateHeight,
    getKey,
    verticalPadding = 0,
    pinThreshold = 120,
    nearBottomThreshold = 120,
    nearTopThreshold = 300,
    onNearBottom,
    onNearTop,
    followBottom = () => true,
    leadOf = () => 0,
  } = opts;

  const OVERSCAN = 0.4; // fraction of viewport rendered beyond each edge

  // ── Reactive output ──
  const totalHeight = ref(0);
  const topSpace = ref(0);
  const bottomSpace = ref(0);
  const renderedItems: ShallowRef<VirtualItem<T>[]> = shallowRef([]);
  /** Live distance (px) from the bottom; mirrors the scroll position. */
  const distanceFromBottom = ref(0);
  /** Whether the viewport is pinned to the bottom (within pinThreshold). */
  const atBottom = ref(true);

  // ── Layout model ──
  interface Entry {
    key: string | number;
    h: number;
    y: number;
    index: number;
    /** `h` came from the page, not the estimate. */
    measured?: boolean;
    /** Where the content starts inside the item (see `leadOf`). */
    lead?: number;
  }
  const meta = new Map<string | number, Entry>();
  let order: Entry[] = [];
  let firstDirty = 0; // index from which cumulative offsets need recompute
  let contentH = verticalPadding * 2;

  // ── Internal state ──
  let viewH = 0;
  let ro: ResizeObserver | null = null;
  let frame: number | null = null;
  let dead = false;
  let paused = false;
  let listChanged = true;

  // Pinned-to-bottom: whether the viewport is at the bottom (tracked from the
  // user's own scrolls). It alone does NOT cause snapping — see snapRequested.
  let pinnedToBottom = true;

  // A snap to the bottom is wanted on the next render because content changed
  // (append / media growth) while pinned. Cleared once consumed. This is what
  // keeps user wheel-scrolls from being yanked back: scroll events never set it.
  let snapRequested = false;

  // Anchors (the first visible item, then the ones after it) — used to keep position
  // stable across prepends, removals and above-viewport height changes while NOT pinned.
  // The later ones stand in when a row is taken out of the list (a deletion, or a
  // cached row the server no longer has): the first one still present holds the place.
  let anchors: { key: string | number; y: number }[] = [];

  // Programmatic-scroll guard: the scrollTop value we last wrote ourselves.
  let lastProgrammaticTop = -1;
  // Where the last scroll event found the list, to tell which way the user went.
  let lastSeenTop = 0;

  /** Where an item's content sits in the list: what anchoring keeps in place. */
  const pointOf = (e: Entry) => e.y + (e.lead ?? 0);

  const elToKey = new WeakMap<Element, string | number>();
  const tracked = new Set<Element>();

  // ── Layout helpers ──

  function rebuildOrder() {
    const items = list.value;
    const n = items.length;
    const next: Entry[] = new Array(n);
    const seen = new Set<string | number>();
    for (let i = 0; i < n; i++) {
      const key = getKey(items[i], i);
      seen.add(key);
      let e = meta.get(key);
      if (!e) {
        e = { key, h: estimateHeight(items[i], i), y: 0, index: i };
        meta.set(key, e);
      } else {
        e.index = i;
      }
      next[i] = e;
    }
    // Prune metas for keys no longer present (keeps the map bounded).
    if (meta.size > n) {
      for (const k of meta.keys()) if (!seen.has(k)) meta.delete(k);
    }
    order = next;
    firstDirty = 0;
  }

  function ensureLayout() {
    const n = order.length;
    if (firstDirty >= n) return; // offsets are clean
    let y = firstDirty === 0
      ? verticalPadding
      : order[firstDirty - 1].y + order[firstDirty - 1].h;
    for (let i = firstDirty; i < n; i++) {
      order[i].y = y;
      y += order[i].h;
    }
    contentH = y + verticalPadding;
    firstDirty = n;
  }

  function ensureReady() {
    if (listChanged) {
      rebuildOrder();
      listChanged = false;
    }
    ensureLayout();
  }

  /** First index whose bottom edge is below `targetY` (binary search). */
  function findStart(targetY: number): number {
    let lo = 0;
    let hi = order.length - 1;
    let res = order.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = order[mid];
      if (e.y + e.h > targetY) {
        res = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return res;
  }

  /** Set scrollTop without it being misread as a user scroll. */
  function setScrollTopSilently(box: HTMLElement, value: number) {
    box.scrollTop = value;
    lastProgrammaticTop = box.scrollTop; // read back the clamped value
    lastSeenTop = lastProgrammaticTop;
  }

  function updateScrollState(box: HTMLElement) {
    const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
    distanceFromBottom.value = Math.max(0, dist);
    atBottom.value = dist <= pinThreshold;
  }

  // ── Main render pass ──

  function render(scrollTopOverride?: number) {
    const box = scrollContainer.value;
    if (!box || dead || paused) return;

    ensureReady();
    const items = list.value;
    const n = order.length;

    if (!n) {
      contentH = verticalPadding * 2;
      totalHeight.value = contentH;
      topSpace.value = 0;
      bottomSpace.value = 0;
      renderedItems.value = [];
      anchors = [];
      return;
    }

    viewH = box.clientHeight || 600;
    totalHeight.value = contentH;

    // Snap to bottom only when content changed while pinned — never on a plain
    // user scroll (that would fight the wheel / drag).
    const doSnap = scrollTopOverride == null && pinnedToBottom && snapRequested;
    snapRequested = false;

    // 1) Decide the scrollTop this pass renders for.
    let top: number;
    let clampedTop: number | null = null;
    if (scrollTopOverride != null) {
      top = scrollTopOverride;
    } else if (doSnap) {
      top = Math.max(0, contentH - viewH);
    } else {
      top = box.scrollTop;
      // Anchor compensation (only while not pinned): if the first-visible item
      // shifted (prepend or above-viewport height change), move scrollTop by the
      // same delta so the content under the user's eyes stays put.
      if (!pinnedToBottom && anchors.length) {
        const anchor = anchors.find((a) => meta.has(a.key));
        const ae = anchor && meta.get(anchor.key);
        if (anchor && ae && pointOf(ae) !== anchor.y) {
          const delta = pointOf(ae) - anchor.y;
          if (Math.abs(delta) < contentH) {
            top += delta;
            setScrollTopSilently(box, top);
            // The spacers this pass sets are not in the DOM yet, so a scroll past the old content
            // (a page prepended while at the very top) is clamped by the browser: applied again
            // once they are (see step 4).
            if (box.scrollTop < top - 1) clampedTop = top;
          }
        }
      }
    }

    // Clamp to a valid range (prevents empty renders when content shrinks).
    const maxTop = Math.max(0, contentH - viewH);
    if (top > maxTop) {
      top = maxTop;
      if (scrollTopOverride == null && !pinnedToBottom) setScrollTopSilently(box, top);
    }
    if (top < 0) top = 0;

    // 2) Visible range.
    const vTop = top - OVERSCAN * viewH;
    const vBot = top + viewH * (1 + OVERSCAN);

    let start = findStart(vTop);
    if (start < 0) start = 0;

    const out: VirtualItem<T>[] = [];
    for (let i = start; i < n; i++) {
      const e = order[i];
      if (e.y > vBot) break;
      out.push({ payload: items[i], index: i, height: e.h, offset: e.y, key: e.key });
    }
    if (!out.length) {
      // Safety net: render the last item so the list is never blank.
      const i = n - 1;
      const e = order[i];
      out.push({ payload: items[i], index: i, height: e.h, offset: e.y, key: e.key });
      start = i;
    }
    const end = out[out.length - 1].index + 1;

    // 3) Spacers.
    topSpace.value = Math.max(0, order[start].y - verticalPadding);
    bottomSpace.value = Math.max(
      0,
      contentH - verticalPadding - (order[end - 1].y + order[end - 1].h),
    );

    // 4) Stop observing elements that left the window.
    const kept = new Set(out.map((v) => v.key));
    for (const el of tracked) {
      const k = elToKey.get(el);
      if (k != null && !kept.has(k)) {
        ro?.unobserve(el);
        tracked.delete(el);
        elToKey.delete(el);
      }
    }

    renderedItems.value = out;

    // A compensation the browser clamped: again after the DOM has the spacers set above.
    if (clampedTop != null) {
      const wanted = clampedTop;
      nextTick(() => {
        if (!dead && box.isConnected && !pinnedToBottom) {
          setScrollTopSilently(box, wanted);
          updateScrollState(box);
        }
      });
    }

    // 5) Save the anchors for the next pass: the first item inside the viewport whose height has
    // been measured, then the ones after it. Items that have just come into view are still at
    // their estimate and about to be measured; so may be one cut by the top edge (media loading).
    // Anchoring on any of them would let its correction push what the reader is looking at. Only
    // failing that, the first item starting inside, then the one cut by the edge.
    let firstVisible = out.findIndex((v) => v.offset >= top && v.offset < top + viewH && meta.get(v.key)?.measured);
    if (firstVisible < 0) firstVisible = out.findIndex((v) => v.offset >= top);
    if (firstVisible < 0) firstVisible = Math.max(0, out.findIndex((v) => v.offset + v.height > top));
    anchors = out.slice(firstVisible).map((v) => ({ key: v.key, y: v.offset + (meta.get(v.key)?.lead ?? 0) }));

    // 6) When following new content, re-snap to the true bottom after the DOM
    // updates. This is what makes the list follow async media (GIFs/images)
    // growing below — but only because content changed, not on user scroll.
    if (doSnap) {
      nextTick(() => {
        if (!dead && box.isConnected && pinnedToBottom) {
          setScrollTopSilently(box, box.scrollHeight);
          updateScrollState(box);
        }
      });
    }

    // 7) Edge callbacks.
    const dist = contentH - top - viewH;
    if (onNearBottom && dist <= nearBottomThreshold) onNearBottom();
    if (onNearTop && top <= nearTopThreshold) onNearTop();
  }

  /**
   * Rows on the page changed height (media loaded, reactions, an edit, a separator, or a row's real
   * height replacing its estimate as it mounted). Called before the frame is painted: the scroll
   * position moves now, so the reader never sees a frame with the new heights and the old position.
   * Pinned to the bottom, the bottom stays the bottom; otherwise the anchor stays where it was.
   */
  function settleHeights() {
    const box = scrollContainer.value;
    if (!box || dead || paused || !order.length) return;
    ensureLayout();

    if (pinnedToBottom && followBottom()) {
      setScrollTopSilently(box, box.scrollHeight);
      updateScrollState(box);
    } else if (!pinnedToBottom && anchors.length) {
      const anchor = anchors.find((a) => meta.has(a.key));
      const ae = anchor && meta.get(anchor.key);
      if (anchor && ae && pointOf(ae) !== anchor.y) {
        setScrollTopSilently(box, box.scrollTop + (pointOf(ae) - anchor.y));
        // Saved against the old offsets: brought up to date, or the next pass would move it again.
        for (const a of anchors) {
          const e = meta.get(a.key);
          if (e) a.y = pointOf(e);
        }
      }
    }
    enqueue();
  }

  let settleQueued = false;
  function queueSettle() {
    if (settleQueued) return;
    settleQueued = true;
    queueMicrotask(() => {
      settleQueued = false;
      settleHeights();
    });
  }

  // ── Scheduling ──

  function enqueue() {
    if (frame != null || dead) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!dead) render();
    });
  }

  // ── Scroll handler ──

  function onScroll() {
    const box = scrollContainer.value;
    if (!box) return;
    // Ignore our own programmatic writes.
    if (Math.abs(box.scrollTop - lastProgrammaticTop) <= 2) {
      lastSeenTop = box.scrollTop;
      return;
    }
    const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
    // Scrolling up leaves the bottom at once: within the threshold, the next height change would
    // otherwise pull the reader straight back down. Coming down, near enough is the bottom.
    const up = box.scrollTop < lastSeenTop;
    lastSeenTop = box.scrollTop;
    pinnedToBottom = up ? dist <= 1 : dist <= pinThreshold;
    distanceFromBottom.value = Math.max(0, dist);
    atBottom.value = pinnedToBottom;
    enqueue();
  }

  // ── ResizeObserver ──

  function onResize(entries: ResizeObserverEntry[]) {
    let changed = false;
    for (const e of entries) {
      if (!e.target.isConnected) {
        ro?.unobserve(e.target);
        tracked.delete(e.target);
        elToKey.delete(e.target);
        continue;
      }
      const k = elToKey.get(e.target);
      if (k == null) continue;
      const m = meta.get(k);
      if (!m) continue;
      const h = e.borderBoxSize?.[0]?.blockSize
        ?? (e.target as HTMLElement).getBoundingClientRect().height;
      if (h > 0) m.measured = true;
      if (h > 0 && Math.abs(h - m.h) > 0.5) {
        m.h = h;
        if (m.index < firstDirty) firstDirty = m.index;
        changed = true;
      }
      const lead = leadOf(e.target as HTMLElement);
      if (Math.abs(lead - (m.lead ?? 0)) > 0.5) {
        m.lead = lead;
        changed = true;
      }
    }
    if (changed) settleHeights();
  }

  /** Called from the template :ref — registers an element for measurement. */
  function measureElement(el: HTMLElement | null, key: string | number) {
    if (!el) return;
    // A row mounting inside a new wrapper gets its ref before the wrapper is attached. Skipping it
    // then left the row unmeasured and unobserved until some later render: its real height landed
    // on the next scroll tick as a jolt, and media loading in it went unseen.
    if (!el.isConnected) {
      queueMicrotask(() => {
        if (!dead && el.isConnected) measureElement(el, key);
      });
      return;
    }
    if (tracked.has(el)) return; // already observed; RO owns subsequent deltas

    elToKey.set(el, key);
    tracked.add(el);

    // Measure once up front so the first paint uses the real height instead of
    // the estimate (bounded: only newly-entering elements, not every render).
    const m = meta.get(key);
    if (m) {
      const h = el.getBoundingClientRect().height;
      if (h > 0) m.measured = true;
      const lead = leadOf(el);
      const leadMoved = Math.abs(lead - (m.lead ?? 0)) > 0.5;
      const resized = h > 0 && Math.abs(h - m.h) > 0.5;
      m.lead = lead;
      if (resized) {
        m.h = h;
        if (m.index < firstDirty) firstDirty = m.index;
      }
      // Once for every row this patch mounted, still before the paint.
      if (resized || leadMoved) queueSettle();
    }

    ro?.observe(el); // the RO delivers later height changes (media load, reactions…)
  }

  // ── Public API ──

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const box = scrollContainer.value;
    if (!box) return;
    pinnedToBottom = true;
    if (behavior === "auto") {
      renderAtBottom();
    } else {
      box.scrollTo({ top: box.scrollHeight, behavior });
      lastProgrammaticTop = box.scrollHeight;
    }
  }

  /** Render the tail of the list and pin scrollTop to the bottom. */
  function renderAtBottom() {
    const box = scrollContainer.value;
    if (!box || dead) return;
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }

    paused = false;
    ensureReady();
    if (!order.length) {
      render();
      return;
    }

    pinnedToBottom = true;
    const fakeTop = Math.max(0, contentH - (box.clientHeight || 600));
    render(fakeTop);

    // After spacers commit, snap to the real bottom; double-tap to absorb the
    // ResizeObserver's first height corrections.
    nextTick(() => {
      if (dead || !box.isConnected) return;
      setScrollTopSilently(box, box.scrollHeight);
      updateScrollState(box);
      requestAnimationFrame(() => {
        if (!dead && box.isConnected && pinnedToBottom) {
          setScrollTopSilently(box, box.scrollHeight);
          updateScrollState(box);
        }
      });
    });
  }

  function scrollToIndex(index: number, align: "start" | "center" | "end" = "start") {
    const box = scrollContainer.value;
    if (!box) return;
    ensureReady();
    if (index < 0 || index >= order.length) return;

    const e = order[index];
    let target: number;
    if (align === "center") target = e.y - viewH / 2 + e.h / 2;
    else if (align === "end") target = e.y - viewH + e.h;
    else target = e.y;

    pinnedToBottom = false;
    setScrollTopSilently(box, Math.max(0, target));
    updateScrollState(box);
    enqueue();
  }

  function getDistanceFromBottom(): number {
    const box = scrollContainer.value;
    if (!box) return 0;
    return box.scrollHeight - box.scrollTop - box.clientHeight;
  }

  function resetState() {
    paused = true;
    pinnedToBottom = true;
    snapRequested = false;
    anchors = [];
    lastProgrammaticTop = -1;
    for (const el of tracked) ro?.unobserve(el);
    tracked.clear();
    meta.clear();
    order = [];
    firstDirty = 0;
    listChanged = true;
    contentH = verticalPadding * 2;
    renderedItems.value = [];
    totalHeight.value = contentH;
    topSpace.value = 0;
    bottomSpace.value = 0;
    distanceFromBottom.value = 0;
    atBottom.value = true;
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }
  }

  // ── Lifecycle ──

  watch(
    list,
    () => {
      listChanged = true;
      paused = false;
      // Appends while pinned should follow to the bottom; prepends (not pinned)
      // are handled by anchor compensation instead.
      if (pinnedToBottom && followBottom()) snapRequested = true;
      enqueue();
    },
    { flush: "post" },
  );

  onMounted(() => {
    ro = new ResizeObserver(onResize);
    const box = scrollContainer.value;
    if (box) {
      box.addEventListener("scroll", onScroll, { passive: true });
      // Viewport resize (e.g. reply bar opens): stay at the bottom if pinned, in this frame.
      const cro = new ResizeObserver(() => {
        if (pinnedToBottom && followBottom() && !dead) {
          setScrollTopSilently(box, box.scrollHeight);
          updateScrollState(box);
        }
        enqueue();
      });
      cro.observe(box);
      onUnmounted(() => cro.disconnect());
    }
  });

  watch(scrollContainer, (cur, prev) => {
    if (prev) prev.removeEventListener("scroll", onScroll);
    if (cur) {
      cur.addEventListener("scroll", onScroll, { passive: true });
      enqueue();
    }
  });

  onUnmounted(() => {
    dead = true;
    scrollContainer.value?.removeEventListener("scroll", onScroll);
    for (const el of tracked) ro?.unobserve(el);
    tracked.clear();
    ro?.disconnect();
    ro = null;
    if (frame != null) cancelAnimationFrame(frame);
  });

  return {
    totalHeight,
    topSpace,
    bottomSpace,
    renderedItems,
    distanceFromBottom,
    atBottom,
    measureElement,
    scrollToBottom,
    renderAtBottom,
    scrollToIndex,
    getDistanceFromBottom,
    resetState,
    scheduleUpdate: enqueue,
    recompute: render,
  };
}
