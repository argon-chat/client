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
  maxBatchSize?: number;
  verticalPadding?: number;
  renderAtLeastFromBottom?: (viewportH: number) => number;
  nearBottomThreshold?: number;
  nearTopThreshold?: number;
  onNearBottom?: () => void;
  onNearTop?: () => void;
}

// ── Composable ──

export function useChatVirtualScroller<T>(opts: ChatVirtualScrollerOptions<T>) {
  const {
    list,
    scrollContainer,
    estimateHeight,
    getKey,
    maxBatchSize = 20,
    verticalPadding = 0,
    renderAtLeastFromBottom = () => 0,
    nearBottomThreshold = 120,
    nearTopThreshold = 300,
    onNearBottom,
    onNearTop,
  } = opts;

  const OVERSCAN = 0.25; // fraction of viewport to render beyond edges

  // Reactive output
  const totalHeight = ref(0);
  const topSpace = ref(0);
  const bottomSpace = ref(0);
  const renderedItems: ShallowRef<VirtualItem<T>[]> = shallowRef([]);

  // Per-item height cache
  interface ItemMeta { h: number; y: number }
  const meta = new Map<string | number, ItemMeta>();

  // Internal state
  let viewH = 0;
  let ro: ResizeObserver | null = null;
  let frame: number | null = null;
  let dead = false;
  let paused = false;
  let prevFirstKey: string | number | null = null;

  // ── Scroll suppression (like tweb's setScrollPositionSilently) ──
  let skipScrollEvents = 0; // counter: how many scroll events to skip

  // ── Pinned-to-bottom state ──
  let pinnedToBottom = true;

  // ── Anchor tracking ──
  let anchorKey: string | number | null = null;
  let anchorY = 0; // anchor item's layout offset at last render

  // ── Render cause tracking ──
  // 'scroll' = user scrolled, 'resize' = ResizeObserver height change, 'other' = list change etc
  let renderCause: 'scroll' | 'resize' | 'other' = 'other';

  const elToKey = new WeakMap<Element, string | number>();
  const tracked = new Set<Element>();

  // ── Helpers ──

  function ensureMeta(key: string | number, item: T, idx: number): ItemMeta {
    let m = meta.get(key);
    if (!m) {
      const est = estimateHeight(item, idx);
      m = { h: est, y: 0 };
      meta.set(key, m);
    }
    return m;
  }

  /** Set scrollTop without triggering a re-render from the scroll event */
  function setScrollTopSilently(box: HTMLElement, value: number) {
    skipScrollEvents++;
    box.scrollTop = value;
  }

  // ── Main render pass ──

  function render(scrollTopOverride?: number) {
    const box = scrollContainer.value;
    if (!box || dead || paused) return;

    const items = list.value;
    const n = items.length;
    if (!n) {
      totalHeight.value = verticalPadding * 2;
      topSpace.value = 0;
      bottomSpace.value = 0;
      renderedItems.value = [];
      return;
    }

    viewH = box.clientHeight || 600;

    // 1) Compute full layout
    let y = verticalPadding;
    const layout: { key: string | number; m: ItemMeta; idx: number }[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const item = items[i];
      const key = getKey(item, i);
      const m = ensureMeta(key, item, i);
      m.y = y;
      y += m.h;
      layout[i] = { key, m, idx: i };
    }
    const contentH = y + verticalPadding;
    totalHeight.value = contentH;

    // 2) Detect prepend FIRST (before anchor compensation, to avoid double-shift)
    const firstKey = layout[0].key;
    let prependShift = 0;
    const hasPrepend = prevFirstKey != null && firstKey !== prevFirstKey;
    if (
      scrollTopOverride == null &&
      !pinnedToBottom &&
      hasPrepend
    ) {
      for (let i = 0; i < n; i++) {
        if (layout[i].key === prevFirstKey) {
          prependShift = layout[i].m.y - verticalPadding;
          break;
        }
      }
    }
    prevFirstKey = firstKey;

    // 3) Determine scrollTop to use for this render
    let top: number;
    let topSource = '';

    if (scrollTopOverride != null) {
      top = scrollTopOverride;
      topSource = 'override';
    } else if (pinnedToBottom) {
      top = Math.max(0, contentH - viewH);
      topSource = 'pinned';
    } else {
      top = box.scrollTop;
      topSource = 'scrollTop';

      // Anchor compensation: if the anchor item moved in layout (due to height changes
      // from ResizeObserver/measureElement), adjust scrollTop to prevent visual jump.
      // Skip during prepend (prepend shift handles that case separately).
      if (!hasPrepend && anchorKey != null) {
        const am = meta.get(anchorKey);
        if (am && am.y !== anchorY) {
          const delta = am.y - anchorY;
          // Only compensate small deltas (large ones are from prepend/list changes)
          if (Math.abs(delta) < viewH) {
            top += delta;
            topSource = 'anchor';
            setScrollTopSilently(box, top);
          }
        }
      }

      // Apply prepend shift
      if (prependShift > 0) {
        top += prependShift;
        topSource = 'prepend';
      }
    }

    // Clamp top to valid range — prevents empty renders when content shrinks
    const maxTop = Math.max(0, contentH - viewH);
    if (top > maxTop) {
      top = maxTop;
      topSource = 'clamped';
      if (scrollTopOverride == null && !pinnedToBottom) {
        setScrollTopSilently(box, top);
      }
    }
    if (top < 0) top = 0;

    // 4) Determine visible range
    const vTop = top - OVERSCAN * viewH;
    const vBot = top + viewH * (1 + OVERSCAN);

    // Find start index — first item whose bottom edge is in the viewport
    let start = 0;
    let foundStart = false;
    for (let i = 0; i < n; i++) {
      if (layout[i].m.y + layout[i].m.h > vTop) { start = i; foundStart = true; break; }
    }
    // If nothing found (all items above viewport), render from the last items
    if (!foundStart) start = Math.max(0, n - 1);

    const bottomPin = n - renderAtLeastFromBottom(viewH);
    start = Math.max(0, Math.min(start, bottomPin));

    // 5) Collect visible items
    const out: VirtualItem<T>[] = [];
    const prev = renderedItems.value;
    const prevKeys = new Set(prev.map((v) => v.key));
    let newCount = 0;
    let end = start;

    for (let i = start; i < n; i++) {
      const { key, m } = layout[i];
      const item = items[i];

      const vis = (m.y + m.h > vTop || i >= bottomPin) && m.y < vBot;
      if (!prevKeys.has(key) && vis) newCount++;
      if (newCount > maxBatchSize) break;

      if (vis) {
        out.push({ payload: item, index: i, height: m.h, offset: m.y, key });
        end = i + 1;
      } else if (out.length) {
        break;
      }
    }

    // If no items passed visibility, don't update — keep previous render and retry
    if (!out.length) {
      enqueue();
      return;
    }

    // 6) Compute spacers
    const topH = start > 0 ? layout[start].m.y - verticalPadding : 0;
    const bottomH = end > 0 && end < n
      ? contentH - verticalPadding - (layout[end - 1].m.y + layout[end - 1].m.h)
      : 0;
    const newTopSpace = Math.max(0, topH);
    const prevTopSpace = topSpace.value;

    // Compensate scrollTop when topSpace changes due to height measurement (not window shift).
    // Only when the first rendered item is the SAME — meaning the window didn't shift,
    // only heights of items inside the spacer changed.
    const prevFirstRenderedKey = prev.length ? prev[0].key : null;
    const curFirstRenderedKey = out.length ? out[0].key : null;
    if (
      renderCause === 'resize' &&
      newTopSpace !== prevTopSpace &&
      prevFirstRenderedKey != null &&
      prevFirstRenderedKey === curFirstRenderedKey &&
      !pinnedToBottom &&
      scrollTopOverride == null &&
      prependShift === 0
    ) {
      const spaceDelta = newTopSpace - prevTopSpace;
      setScrollTopSilently(box, box.scrollTop + spaceDelta);
      top += spaceDelta;
    }

    topSpace.value = newTopSpace;
    bottomSpace.value = Math.max(0, bottomH);

    // 7) Unobserve elements leaving render window
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

    // 8) Save anchor for next render: first visible item
    if (out.length) {
      anchorKey = out[0].key;
      anchorY = out[0].offset;
    }

    // 9) Post-render scroll adjustments (after Vue updates DOM)
    if (prependShift > 0 && !pinnedToBottom) {
      const shift = prependShift;
      nextTick(() => {
        if (!dead && box.isConnected) {
          setScrollTopSilently(box, box.scrollTop + shift);
        }
      });
    }

    if (pinnedToBottom && scrollTopOverride == null) {
      // Snap to actual bottom after DOM update
      nextTick(() => {
        if (!dead && box.isConnected) {
          setScrollTopSilently(box, box.scrollHeight);
        }
      });
    }

    // 10) Edge callbacks
    const actualDistFromBottom = contentH - top - viewH;
    if (onNearBottom && actualDistFromBottom <= nearBottomThreshold) onNearBottom();
    if (onNearTop && top <= nearTopThreshold) onNearTop();

    // Reset render cause
    renderCause = 'other';
  }

  // ── Scheduling ──

  function enqueue() {
    if (frame != null || dead) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!dead) render();
    });
  }

  // ── Scroll event handler ──

  function onScroll() {
    if (skipScrollEvents > 0) {
      skipScrollEvents--;
      return;
    }
    // User-initiated scroll: update pinned state
    const box = scrollContainer.value;
    if (box) {
      const distFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
      pinnedToBottom = distFromBottom <= 1;
    }
    renderCause = 'scroll';
    enqueue();
  }

  // ── ResizeObserver callback ──

  function onResize(entries: ResizeObserverEntry[]) {
    const box = scrollContainer.value;
    let dirty = false;
    let scrollDelta = 0;

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
      const h = e.borderBoxSize?.[0]?.blockSize ?? e.target.getBoundingClientRect().height;
      if (Math.abs(h - m.h) > 0.5) {
        const diff = h - m.h;
        m.h = h;
        dirty = true;

        // Immediate scroll compensation: if this element is above the viewport center,
        // its height change shifts everything below (including what user sees).
        // Compensate scrollTop NOW to prevent 1-frame jitter.
        if (box && !pinnedToBottom) {
          const el = e.target as HTMLElement;
          const elRect = el.getBoundingClientRect();
          const boxRect = box.getBoundingClientRect();
          // Element's bottom is above viewport center → it's above what user focuses on
          if (elRect.bottom < boxRect.top + boxRect.height / 2) {
            scrollDelta += diff;
          }
        }
      }
    }

    if (scrollDelta !== 0 && box && !pinnedToBottom) {
      setScrollTopSilently(box, box.scrollTop + scrollDelta);
      // Update anchorY to reflect the shift, so render() doesn't double-compensate
      anchorY += scrollDelta;
    }
    if (dirty) {
      renderCause = 'resize';
      enqueue();
    }
  }

  /** Called from template :ref — measures and observes an element. */
  function measureElement(el: HTMLElement | null, key: string | number) {
    if (!el || !el.isConnected) return;
    const h = el.getBoundingClientRect().height;
    const m = meta.get(key);
    if (m && h > 0 && Math.abs(h - m.h) > 0.5) {
      m.h = h;
      renderCause = 'resize';
      queueMicrotask(() => enqueue());
    }
    if (!tracked.has(el)) {
      elToKey.set(el, key);
      tracked.add(el);
      ro?.observe(el);
    }
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
    }
  }

  /**
   * Render items from the end of the list, then set scrollTop to bottom.
   * Used for initial load and channel switch.
   */
  function renderAtBottom() {
    const box = scrollContainer.value;
    if (!box || dead) return;

    // Cancel any pending RAF
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }

    const items = list.value;
    const n = items.length;
    if (!n) return;

    paused = false;
    pinnedToBottom = true;

    // Compute layout so render() has correct meta
    let y = verticalPadding;
    for (let i = 0; i < n; i++) {
      const item = items[i];
      const key = getKey(item, i);
      const m = ensureMeta(key, item, i);
      m.y = y;
      y += m.h;
    }
    const contentH = y + verticalPadding;

    // Render with scrollTop at the very bottom
    const fakeTop = Math.max(0, contentH - (box.clientHeight || 600));
    render(fakeTop);

    // After Vue updates spacer DOM, set actual scrollTop
    nextTick(() => {
      if (!dead && box.isConnected) {
        setScrollTopSilently(box, box.scrollHeight);
        // Double-tap: ResizeObserver may fire and change heights
        requestAnimationFrame(() => {
          if (!dead && box.isConnected && pinnedToBottom) {
            setScrollTopSilently(box, box.scrollHeight);
          }
        });
      }
    });
  }

  function scrollToIndex(index: number, align: "start" | "center" | "end" = "start") {
    const box = scrollContainer.value;
    if (!box) return;
    const items = list.value;
    if (index < 0 || index >= items.length) return;

    const key = getKey(items[index], index);
    let m = meta.get(key);
    if (!m) { render(); m = meta.get(key); }
    if (!m) return;

    let target: number;
    if (align === "center") target = m.y - viewH / 2 + m.h / 2;
    else if (align === "end") target = m.y - viewH + m.h;
    else target = m.y;

    pinnedToBottom = false;
    box.scrollTop = Math.max(0, target);
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
    anchorKey = null;
    anchorY = 0;
    skipScrollEvents = 0;
    for (const el of tracked) ro?.unobserve(el);
    tracked.clear();
    meta.clear();
    prevFirstKey = null;
    renderedItems.value = [];
    totalHeight.value = verticalPadding * 2;
    topSpace.value = 0;
    bottomSpace.value = 0;
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }
  }

  // ── Lifecycle ──

  watch(list, () => { paused = false; enqueue(); }, { flush: "post" });

  onMounted(() => {
    ro = new ResizeObserver(onResize);
    const box = scrollContainer.value;
    if (box) {
      box.addEventListener("scroll", onScroll, { passive: true });
      const cro = new ResizeObserver(() => enqueue());
      cro.observe(box);
      onUnmounted(() => cro.disconnect());
    }
  });

  watch(scrollContainer, (cur, prev) => {
    if (prev) prev.removeEventListener("scroll", onScroll);
    if (cur) { cur.addEventListener("scroll", onScroll, { passive: true }); enqueue(); }
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
