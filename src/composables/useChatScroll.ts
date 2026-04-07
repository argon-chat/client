import { ref, computed, onMounted, onUnmounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ArgonMessage } from "@argon/glue";

const SCROLL_THRESHOLD = 150;
const MESSAGE_HEIGHT_ESTIMATE = 72;

export function useChatScroll(
  messages: () => ArgonMessage[],
  isRestoringScroll: () => boolean,
) {
  const parentRef = ref<HTMLElement>();
  const chatWidth = ref(0);
  const measuredItems = new Set<number>();

  let scrollLoadTimeout: ReturnType<typeof setTimeout> | null = null;
  let onScrollTopCallback: (() => void) | null = null;

  const virtualizerOptions = computed(() => ({
    count: messages().length,
    getScrollElement: () => parentRef.value ?? null,
    estimateSize: () => MESSAGE_HEIGHT_ESTIMATE,
    overscan: 10,
    getItemKey: (index: number) => messages()[index]?.messageId?.toString() ?? index,
  }));

  const virtualizer = useVirtualizer(virtualizerOptions);
  const virtualItems = computed(() => virtualizer.value.getVirtualItems());

  const measureItem = (el: HTMLElement | null, index: number) => {
    if (!el || measuredItems.has(index)) return;
    measuredItems.add(index);
    virtualizer.value.measureElement(el);
  };

  const shiftMeasuredIndices = (count: number) => {
    const shifted = new Set<number>();
    measuredItems.forEach((idx) => shifted.add(idx + count));
    measuredItems.clear();
    shifted.forEach((idx) => measuredItems.add(idx));
  };

  const scrollToBottomImmediate = () => {
    if (messages().length === 0) return;

    const lastIndex = messages().length - 1;

    virtualizer.value.scrollToIndex(lastIndex, { align: "end", behavior: "auto" });

    requestAnimationFrame(() => {
      virtualizer.value.scrollToIndex(lastIndex, { align: "end", behavior: "auto" });
      setTimeout(() => {
        if (parentRef.value) {
          parentRef.value.scrollTop = parentRef.value.scrollHeight;
        }
      }, 50);
    });
  };

  const scrollToBottom = () => {
    if (messages().length === 0) return;

    const lastIndex = messages().length - 1;
    virtualizer.value.scrollToIndex(lastIndex, { align: "end", behavior: "auto" });

    requestAnimationFrame(() => {
      if (parentRef.value) {
        parentRef.value.scrollTop = parentRef.value.scrollHeight;
      }
    });
  };

  const scrollToIndex = (index: number) => {
    virtualizer.value.scrollToIndex(index, { align: "start", behavior: "auto" });
  };

  const handleScroll = () => {
    if (!parentRef.value || isRestoringScroll()) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.value;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (scrollLoadTimeout) clearTimeout(scrollLoadTimeout);

    scrollLoadTimeout = setTimeout(() => {
      if (scrollTop < SCROLL_THRESHOLD && onScrollTopCallback) {
        onScrollTopCallback();
      }
    }, 100);

    return distanceFromBottom;
  };

  const onScrollNearTop = (callback: () => void) => {
    onScrollTopCallback = callback;
  };

  const updateChatWidth = () => {
    if (parentRef.value) {
      chatWidth.value = parentRef.value.offsetWidth;
    }
  };

  const resetMeasurements = () => {
    measuredItems.clear();
  };

  onMounted(() => {
    if (parentRef.value) {
      parentRef.value.addEventListener("scroll", (e) => handleScroll(), { passive: true });
      chatWidth.value = parentRef.value.offsetWidth;
    }
    window.addEventListener("resize", updateChatWidth);
  });

  onUnmounted(() => {
    if (scrollLoadTimeout) clearTimeout(scrollLoadTimeout);
    if (parentRef.value) {
      parentRef.value.removeEventListener("scroll", handleScroll as any);
    }
    window.removeEventListener("resize", updateChatWidth);
  });

  return {
    parentRef,
    chatWidth,
    virtualizer,
    virtualItems,
    measureItem,
    shiftMeasuredIndices,
    scrollToBottomImmediate,
    scrollToBottom,
    scrollToIndex,
    handleScroll,
    onScrollNearTop,
    resetMeasurements,
  };
}
