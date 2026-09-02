import { computed, reactive } from "vue";
import { watchDebounced } from "@vueuse/core";
import {
  EntityType,
  LinkPreviewError,
  LinkPreviewFailed,
  LinkPreviewReady,
  MessageEntityLinkPreview,
  type ILinkPreviewResult,
  type LinkPreview,
} from "@argon/glue";
import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { firstLink } from "@/lib/linkPreview/detectLinks";

/** Typing pauses this long before the first link in the draft is looked up. */
const LOOKUP_DEBOUNCE_MS = 400;

/** A lookup the crawler could not answer is asked again after this, not on every keystroke. */
const RETRY_UNAVAILABLE_MS = 15_000;

interface CacheEntry {
  preview: LinkPreview | null;
  at: number;
  /** The answer will not change by asking again (ready, or a page with nothing to show). */
  final: boolean;
}

/**
 * The link preview of a draft, the way Telegram does it: while the user types, the first link is
 * looked up and shown above the input; the user may dismiss it for this draft; on send, a stub is
 * attached to the message so the server fills in (or removes) the card for everyone.
 *
 * Looking up while typing also warms the crawler's cache, which is what lets the server answer
 * the send itself in a few milliseconds instead of following up with MessageUpdated.
 */
export function useLinkPreviewDraft(opts: { text: () => string; enabled: () => boolean }) {
  const api = useApi();

  const state = reactive({
    /** The link the bar is about — the first one in the draft. */
    url: null as string | null,
    preview: null as LinkPreview | null,
    loading: false,
    /** Dismissed with the X: stays hidden until the draft no longer starts with this link. */
    dismissedUrl: null as string | null,
  });

  const cache = new Map<string, CacheEntry>();
  let requestSeq = 0;

  const visible = computed(
    () => opts.enabled() && !!state.url && state.dismissedUrl !== state.url && (state.loading || !!state.preview),
  );

  function isFinal(result: ILinkPreviewResult): boolean {
    if (result instanceof LinkPreviewReady || result.UnionKey === "LinkPreviewReady") return true;
    const error = (result as LinkPreviewFailed).error;
    return error !== LinkPreviewError.UNAVAILABLE && error !== LinkPreviewError.RATE_LIMITED;
  }

  async function lookup(url: string) {
    const cached = cache.get(url);
    if (cached && (cached.final || Date.now() - cached.at < RETRY_UNAVAILABLE_MS)) {
      state.preview = cached.preview;
      return;
    }

    const seq = ++requestSeq;
    state.loading = true;
    try {
      const result = await api.linkPreviewInteraction.GetLinkPreview(url);
      const preview = result.UnionKey === "LinkPreviewReady" ? (result as LinkPreviewReady).preview : null;
      cache.set(url, { preview, at: Date.now(), final: isFinal(result) });
      // Stale: the draft moved on to another link (or none) while this was in flight.
      if (seq !== requestSeq || state.url !== url) return;
      state.preview = preview;
    } catch (e) {
      logger.warn("link preview lookup failed", e);
      cache.set(url, { preview: null, at: Date.now(), final: false });
    } finally {
      if (seq === requestSeq) state.loading = false;
    }
  }

  function setLink(url: string | null) {
    if (url === state.url) return;
    requestSeq++;
    state.url = url;
    state.preview = null;
    state.loading = false;
    // A dismissal is about one link; a different one (or none) starts over.
    if (state.dismissedUrl !== null && state.dismissedUrl !== url) state.dismissedUrl = null;
    if (url && state.dismissedUrl !== url) void lookup(url);
  }

  watchDebounced(
    () => (opts.enabled() ? opts.text() : ""),
    (text) => setLink(text ? (firstLink(text)?.url ?? null) : null),
    { debounce: LOOKUP_DEBOUNCE_MS },
  );

  function dismiss() {
    if (state.url) state.dismissedUrl = state.url;
  }

  function reset() {
    requestSeq++;
    state.url = null;
    state.preview = null;
    state.loading = false;
    state.dismissedUrl = null;
  }

  /**
   * The entity to send with the message, or null when there is no link or the user dismissed it.
   * Built from the clean text (markers stripped) so the offset points at the link as it will be
   * stored; the debounce may not have caught a link typed just before Enter, so the text is
   * searched again here rather than trusting `state.url`. Whatever the client knows about the page
   * rides along for the optimistic render — the server replaces all of it. Ends the draft.
   */
  function takeStub(cleanText: string): MessageEntityLinkPreview | null {
    const link = opts.enabled() ? firstLink(cleanText) : null;
    const dismissed = link !== null && state.dismissedUrl === link.url;
    const preview = link !== null && state.url === link.url ? state.preview : null;
    reset();
    if (!link || dismissed) return null;

    return new MessageEntityLinkPreview(
      EntityType.LinkPreview,
      link.offset,
      link.length,
      1,
      link.url,
      preview?.title ?? null,
      preview?.description ?? null,
      preview?.siteName ?? null,
      preview?.imageUrl ?? null,
      preview?.canonicalUrl ?? null,
    );
  }

  return reactive({
    url: computed(() => state.url),
    preview: computed(() => state.preview),
    loading: computed(() => state.loading),
    visible,
    dismiss,
    reset,
    takeStub,
  });
}

export type LinkPreviewDraft = ReturnType<typeof useLinkPreviewDraft>;
