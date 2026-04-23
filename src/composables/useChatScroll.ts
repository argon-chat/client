import { ref, computed, onMounted, onUnmounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { type ArgonMessage, EntityType } from "@argon/glue";

const SCROLL_THRESHOLD = 150;

// Adaptive height estimates by message content type
function estimateMessageHeight(msg: ArgonMessage | undefined): number {
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

  let height = 32; // meta (username + time)

  if (imageAttachments.length === 1) height += 300;
  else if (imageAttachments.length >= 2 && imageAttachments.length <= 4) height += 160;
  else if (imageAttachments.length > 4) height += 120 * Math.ceil(imageAttachments.length / 3);

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
  messages: () => ArgonMessage[],
  isRestoringScroll: () => boolean,
) {
  const parentRef = ref<HTMLElement>();
  const chatWidth = ref(0);

  let onScrollTopCallback: (() => void) | null = null;
  let onScrollCallback: ScrollStateCallback | null = null;
  let scrollTicking = false;

  const virtualizerOptions = computed(() => ({
    count: messages().length,
    getScrollElement: () => parentRef.value ?? null,
    estimateSize: (index: number) => estimateMessageHeight(messages()[index]),
    overscan: 10,
    getItemKey: (index: number) => messages()[index]?.messageId?.toString() ?? index,
  }));

  const virtualizer = useVirtualizer(virtualizerOptions);
  const virtualItems = computed(() => virtualizer.value.getVirtualItems());

  // TanStack's measureElement is cheap on repeated calls (cache hit + ResizeObserver already attached).
  // No guard needed — just forward to tanstack.
  const measureItem = (el: HTMLElement | null, _index: number) => {
    if (!el) return;
    virtualizer.value.measureElement(el);
  };

  const scrollToBottomImmediate = () => {
    if (messages().length === 0) return;
    const lastIndex = messages().length - 1;
    virtualizer.value.scrollToIndex(lastIndex, { align: "end", behavior: "auto" });
    // Fallback: after measurement settles, snap via direct scrollTop for reliability
    requestAnimationFrame(() => {
      const el = parentRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const scrollToBottom = () => {
    if (messages().length === 0) return;
    const lastIndex = messages().length - 1;
    virtualizer.value.scrollToIndex(lastIndex, { align: "end", behavior: "auto" });
  };

  const scrollToIndex = (index: number) => {
    virtualizer.value.scrollToIndex(index, { align: "start", behavior: "auto" });
  };

  // RAF-throttled unified scroll handler
  const handleScroll = () => {
    if (scrollTicking) return;
    scrollTicking = true;

    requestAnimationFrame(() => {
      scrollTicking = false;
      if (!parentRef.value || isRestoringScroll()) return;

      const { scrollTop, scrollHeight, clientHeight } = parentRef.value;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (onScrollCallback) {
        onScrollCallback({ scrollTop, scrollHeight, clientHeight, distanceFromBottom });
      }

      if (scrollTop < SCROLL_THRESHOLD && onScrollTopCallback) {
        onScrollTopCallback();
      }
    });
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
      parentRef.value.addEventListener("scroll", handleScroll, { passive: true });
      chatWidth.value = parentRef.value.offsetWidth;
    }
    window.addEventListener("resize", updateChatWidth);
  });

  onUnmounted(() => {
    if (parentRef.value) {
      parentRef.value.removeEventListener("scroll", handleScroll);
    }
    window.removeEventListener("resize", updateChatWidth);
  });

  return {
    parentRef,
    chatWidth,
    virtualizer,
    virtualItems,
    measureItem,
    scrollToBottomImmediate,
    scrollToBottom,
    scrollToIndex,
    handleScroll,
    onScrollNearTop,
    onScroll,
  };
}
