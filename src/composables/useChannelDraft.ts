import { onBeforeUnmount, watch } from "vue";
import { logger } from "@argon/core";
import type { IMessageEntity, MessageDraft } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import type { ParsedMessage } from "@/lib/chat/parseMessageContent";

/**
 * The server-side draft of a channel composer: loaded when the channel opens with an empty
 * composer, saved a moment after the user stops typing, deleted on send or schedule.
 *
 * One composer instance serves one channel (TextChannelView keys it by channel), so the target
 * never changes under it; leaving the channel unmounts it, and a pending save goes out then.
 * Nothing is saved while a sent message is being edited — the composer holds that message, not
 * the draft.
 */

export const DRAFT_SAVE_DELAY_MS = 1500;
export const DRAFT_MAX_LENGTH = 4096;

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

  function persist(target: DraftTarget, content: ParsedMessage): Promise<void> {
    const empty = !content.text.trim();
    if (!empty && content.text.length > maxLength) return Promise.resolve();
    if (empty && !serverHasDraft) return Promise.resolve();

    serverHasDraft = !empty;
    const text = empty ? "" : content.text;
    const entities = empty ? [] : content.entities;
    const key = target.channelId;
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
   * Saves now what a pending autosave would have saved. Called as an edit takes the composer, before
   * the message replaces the text; while editing no autosave is ever pending, so this is a no-op.
   */
  function flush(): Promise<void> {
    if (timer === undefined) return Promise.resolve();
    cancelPending();
    const target = options.target();
    if (!target) return Promise.resolve();
    baseline = options.text();
    return persist(target, options.parse());
  }

  /** After a send or a schedule: nothing is left to keep. */
  function clear(): Promise<void> {
    cancelPending();
    baseline = "";
    const target = options.target();
    if (!target) return Promise.resolve();
    return persist(target, { text: "", entities: [] });
  }

  async function load(): Promise<void> {
    const target = options.target();
    if (!target || options.editing() || options.text()) return;
    await inflight.get(target.channelId);
    try {
      const draft = await drafts.get(target.spaceId, target.channelId);
      // The user may have started typing, or left, while it loaded.
      if (disposed || !draft || options.editing() || options.text()) return;
      serverHasDraft = true;
      options.restore(draft);
      baseline = options.text();
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
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const target = options.target();
      if (!target || options.editing()) return;
      baseline = options.text();
      void persist(target, options.parse());
    }, delay);
  });

  onBeforeUnmount(() => {
    void flush();
    disposed = true;
  });

  void load();

  return { flush, clear, load };
}
