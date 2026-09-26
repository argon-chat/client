import { onBeforeUnmount, watch } from "vue";
import { logger } from "@argon/core";
import type { IMessageEntity, MessageDraft } from "@argon/glue";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { useApi } from "@/store/system/apiStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import type { ParsedMessage } from "@/lib/chat/parseMessageContent";

/**
 * The server-side draft of a channel composer: loaded when the channel opens with an empty
 * composer, saved a few seconds after the user stops typing (sooner when the composer loses focus,
 * at once when the window is hidden or the channel is left), deleted on send or schedule.
 *
 * One composer instance serves one channel (TextChannelView keys it by channel), so the target
 * never changes under it; leaving the channel unmounts it, and a pending save goes out then.
 * Nothing is saved while a sent message is being edited — the composer holds that message, not
 * the draft.
 *
 * What each channel's draft is, as far as this session knows, is kept in memory and updated by
 * every save: a channel opened again does not ask the server.
 */

export const DRAFT_SAVE_DELAY_MS = 5000;
export const DRAFT_BLUR_GRACE_MS = 300;
export const DRAFT_MAX_LENGTH = 4096;
/** Shorter than this is not worth keeping: it is never saved, only clears a draft the server has. */
export const DRAFT_MIN_LENGTH = 3;

export interface DraftTarget {
  spaceId: string;
  channelId: string;
}

export interface DraftApi {
  get(spaceId: string, channelId: string): Promise<MessageDraft | null>;
  save(spaceId: string, channelId: string, text: string, entities: IMessageEntity[]): Promise<void>;
}

export interface ChannelDraftOptions {
  /** Null for a composer without drafts: a direct chat or a caption. */
  target: () => DraftTarget | null;
  /** The composer's raw text, markers and all. */
  text: () => string;
  /** What would be sent right now. */
  parse: () => ParsedMessage;
  /** Puts a stored draft into the composer. */
  restore: (draft: MessageDraft) => void;
  editing: () => boolean;
  api?: DraftApi;
  delayMs?: number;
  maxLength?: number;
}

/** Saves in flight per channel, so a composer opened again reads after its predecessor wrote. */
const inflight = new Map<string, Promise<void>>();
/** Each channel's draft as this session last wrote or read it; null: there is none. */
const known = new Map<string, MessageDraft | null>();
let session = 0;

// The next account has drafts of its own.
onSessionReset(() => {
  session++;
  inflight.clear();
  known.clear();
});

function apiDrafts(): DraftApi {
  const api = useApi();
  return {
    get: (spaceId, channelId) => api.channelComposerInteraction.GetDraft(spaceId, channelId),
    save: (spaceId, channelId, text, entities) => api.channelComposerInteraction.SaveDraft(spaceId, channelId, text, entities),
  };
}

export function useChannelDraft(options: ChannelDraftOptions) {
  const drafts = options.api ?? apiDrafts();
  const delay = options.delayMs ?? DRAFT_SAVE_DELAY_MS;
  const maxLength = options.maxLength ?? DRAFT_MAX_LENGTH;

  /** The text the server already has (or that came from it); typing away from it is what saves. */
  let baseline = "";
  let serverHasDraft = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** The user typed, sent or scheduled here: a draft that loads after that must not overwrite it. */
  let touched = false;
  /** A save went out after the load was asked for, so the load's answer is older than it. */
  let savedSinceLoad = false;

  function persist(target: DraftTarget, content: ParsedMessage): Promise<void> {
    if (disposed) return Promise.resolve();
    const empty = content.text.trim().length < DRAFT_MIN_LENGTH;
    if (!empty && content.text.length > maxLength) return Promise.resolve();
    if (empty && !serverHasDraft) return Promise.resolve();

    serverHasDraft = !empty;
    savedSinceLoad = true;
    const text = empty ? "" : content.text;
    const entities = empty ? [] : content.entities;
    const key = target.channelId;
    known.set(key, empty ? null : { channelId: key, text, entities, updatedAt: IonDateTime.now() });

    const previous = inflight.get(key) ?? Promise.resolve();
    const saving = previous
      .then(() => drafts.save(target.spaceId, target.channelId, text, entities))
      .catch((e) => logger.warn("Failed to save the draft", e))
      .finally(() => {
        if (inflight.get(key) === saving) inflight.delete(key);
      });
    inflight.set(key, saving);
    return saving;
  }

  function cancelPending() {
    clearTimeout(timer);
    timer = undefined;
  }

  /**
   * Saves now what a pending autosave would have saved: the window was hidden, the channel is being
   * left, or an edit takes the composer (while editing no autosave is ever pending, so then this is
   * a no-op).
   */
  function flush(): Promise<void> {
    if (timer === undefined) return Promise.resolve();
    cancelPending();
    const target = options.target();
    if (!target) return Promise.resolve();
    baseline = options.text();
    return persist(target, options.parse());
  }

  /**
   * The composer lost focus: the pending autosave goes out within {@link DRAFT_BLUR_GRACE_MS}. Not at
   * once, because a click on Send blurs the composer first, and a save right before the send's clear
   * is two calls for nothing.
   */
  function blurred() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), DRAFT_BLUR_GRACE_MS);
  }

  /** After a send or a schedule: nothing is left to keep. Costs a call only when the server has a draft. */
  function clear(): Promise<void> {
    cancelPending();
    touched = true;
    baseline = "";
    const target = options.target();
    if (!target) return Promise.resolve();
    return persist(target, { text: "", entities: [] });
  }

  function apply(draft: MessageDraft | null) {
    if (!draft || disposed || touched || options.editing() || options.text()) return;
    options.restore(draft);
    baseline = options.text();
  }

  async function load(): Promise<void> {
    const target = options.target();
    if (!target || options.editing() || options.text()) return;

    const held = known.get(target.channelId);
    if (held !== undefined) {
      serverHasDraft = held !== null;
      apply(held);
      return;
    }

    const askedIn = session;
    savedSinceLoad = false;
    await inflight.get(target.channelId);
    try {
      const draft = await drafts.get(target.spaceId, target.channelId);
      if (askedIn !== session || disposed) return;
      if (!savedSinceLoad) {
        serverHasDraft = !!draft;
        known.set(target.channelId, draft ?? null);
      }
      // The user may have started typing, sent, or left, while it loaded.
      apply(draft);
    } catch (e) {
      logger.warn("Failed to load the draft", e);
    }
  }

  watch(options.text, (text) => {
    if (!options.target() || options.editing()) return;
    if (text === baseline) {
      cancelPending();
      return;
    }
    touched = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const target = options.target();
      if (!target || options.editing()) return;
      baseline = options.text();
      void persist(target, options.parse());
    }, delay);
  });

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") void flush();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // A save still waiting when the account switches would go out under the next account.
  const stopReset = onSessionReset(() => {
    cancelPending();
    disposed = true;
  });

  onBeforeUnmount(() => {
    void flush();
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopReset();
  });

  void load();

  return { flush, blurred, clear, load };
}
