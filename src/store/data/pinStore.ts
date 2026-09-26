import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { IonDateTime, type Guid } from "@argon-chat/ion.webcore";
import {
  PinMessageError,
  type ArgonMessage,
  type MessageDeleted,
  type MessagePinned,
  type MessageUnpinned,
  type MessageUpdated,
  type PinnedMessage,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import { useBus } from "@/store/realtime/busStore";
import { useMessageStore } from "@/store/data/messageStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/** The server refuses a pin past this many in one channel. */
export const PIN_LIMIT = 50;

/** A channel opened again within this long shows the pins it had, without asking the server. */
export const PIN_TTL_MS = 2 * 60_000;
/** How many channels' pins are kept; the least recently opened one goes first. */
export const PIN_CHANNELS_KEPT = 10;

export type PinOutcome = { ok: true } | { ok: false; error: PinMessageError | null };

const EMPTY: readonly PinnedMessage[] = Object.freeze([]);

function newestFirst(pins: PinnedMessage[]): PinnedMessage[] {
  return [...pins].sort((a, b) => {
    const byTime = b.pinnedAt.unixTicks - a.pinnedAt.unixTicks;
    if (byTime !== 0n) return byTime > 0n ? 1 : -1;
    return b.message.messageId > a.message.messageId ? 1 : b.message.messageId < a.message.messageId ? -1 : 0;
  });
}

/**
 * Pinned messages per channel, newest first. A channel is loaded when its view opens, unless it was
 * loaded less than {@link PIN_TTL_MS} ago, and kept current by MessagePinned / MessageUnpinned while
 * it is watched (they are channel-scoped). A pin whose message is not in the local cache marks the
 * list stale instead of asking at once; the panel asks when it opens. The {@link PIN_CHANNELS_KEPT}
 * most recently opened channels are kept.
 */
export const usePinStore = defineStore("pins", () => {
  const api = useApi();
  const bus = useBus();
  const messageStore = useMessageStore();

  // Absent key: never loaded (or evicted). Lists are replaced, never mutated, so the map is the only
  // thing tracked.
  const byChannel = shallowReactive(new Map<string, readonly PinnedMessage[]>());
  // The held channels, least recently opened first. Not reactive: opening one redraws nothing.
  const recency = new Set<string>();
  // Channels whose last load failed, for the panel's error state.
  const failed = shallowReactive(new Set<string>());
  const loadedAt = new Map<string, number>();
  const stale = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  // Bumped on an account switch: a load that answers after it belongs to the previous account.
  let session = 0;

  function list(channelId: Guid): readonly PinnedMessage[] {
    return byChannel.get(channelId) ?? EMPTY;
  }

  function isLoaded(channelId: Guid): boolean {
    return byChannel.has(channelId);
  }

  function isFailed(channelId: Guid): boolean {
    return failed.has(channelId);
  }

  function isPinned(channelId: Guid, messageId: bigint): boolean {
    return list(channelId).some((p) => p.message.messageId === messageId);
  }

  function touch(channelId: string) {
    recency.delete(channelId);
    recency.add(channelId);
  }

  function evict(channelId: string) {
    byChannel.delete(channelId);
    loadedAt.delete(channelId);
    stale.delete(channelId);
    recency.delete(channelId);
  }

  /** Stores a channel's list as the most recently used one, dropping the least recent past the cap. */
  function keep(channelId: string, pins: readonly PinnedMessage[]) {
    byChannel.set(channelId, pins);
    touch(channelId);
    for (const oldest of recency) {
      if (byChannel.size <= PIN_CHANNELS_KEPT) break;
      evict(oldest);
    }
  }

  /** Asks the server, whatever is held. */
  function load(spaceId: Guid, channelId: Guid): Promise<void> {
    const pending = inflight.get(channelId);
    if (pending) return pending;

    const askedIn = session;
    const run = (async () => {
      try {
        const pins = await api.channelPinsInteraction.GetPinnedMessages(spaceId, channelId);
        if (askedIn !== session) return;
        keep(channelId, newestFirst(Array.from(pins)));
        loadedAt.set(channelId, Date.now());
        stale.delete(channelId);
        failed.delete(channelId);
      } catch (e) {
        logger.error("[Pins] Failed to load pinned messages", channelId, e);
        if (askedIn === session) failed.add(channelId);
      } finally {
        inflight.delete(channelId);
      }
    })();

    inflight.set(channelId, run);
    return run;
  }

  /** The held list while it is fresh; otherwise (stale, expired, failed, never loaded) a load. */
  function ensure(spaceId: Guid, channelId: Guid): Promise<void> {
    const pins = byChannel.get(channelId);
    const at = loadedAt.get(channelId);
    if (pins && at !== undefined && !stale.has(channelId) && Date.now() - at < PIN_TTL_MS) {
      touch(channelId);
      return Promise.resolve();
    }
    return load(spaceId, channelId);
  }

  function upsert(channelId: Guid, pin: PinnedMessage) {
    const current = byChannel.get(channelId);
    if (!current) return;
    const rest = current.filter((p) => p.message.messageId !== pin.message.messageId);
    byChannel.set(channelId, newestFirst([pin, ...rest]));
  }

  function remove(channelId: Guid, messageId: bigint) {
    const current = byChannel.get(channelId);
    if (!current) return;
    const next = current.filter((p) => p.message.messageId !== messageId);
    if (next.length !== current.length) byChannel.set(channelId, next);
  }

  function replaceMessage(message: ArgonMessage) {
    const current = byChannel.get(message.channelId);
    if (!current?.some((p) => p.message.messageId === message.messageId)) return;
    byChannel.set(
      message.channelId,
      current.map((p) => (p.message.messageId === message.messageId ? { ...p, message } : p)),
    );
  }

  async function pin(spaceId: Guid, channelId: Guid, messageId: bigint): Promise<PinOutcome> {
    try {
      const result = await api.channelPinsInteraction.PinMessage(spaceId, channelId, messageId);
      if (result.isSuccessPinMessage()) {
        metrics.count("message.pinned", { action: "pin", result: "ok" });
        upsert(channelId, result.pin);
        return { ok: true };
      }
      const error = result.isFailedPinMessage() ? result.error : null;
      metrics.count("message.pinned", { action: "pin", result: "failed", error: error === null ? "unknown" : metrics.enumName(PinMessageError, error) });
      return { ok: false, error };
    } catch (e) {
      metrics.count("message.pinned", { action: "pin", result: "failed", error: errorKind(e) });
      logger.error("[Pins] Failed to pin", messageId, e);
      return { ok: false, error: null };
    }
  }

  async function unpin(spaceId: Guid, channelId: Guid, messageId: bigint): Promise<PinOutcome> {
    try {
      const result = await api.channelPinsInteraction.UnpinMessage(spaceId, channelId, messageId);
      if (result.isFailedUnpinMessage()) {
        metrics.count("message.pinned", { action: "unpin", result: "failed", error: metrics.enumName(PinMessageError, result.error) });
        return { ok: false, error: result.error };
      }
      if (!result.isSuccessUnpinMessage()) return { ok: false, error: null };
      metrics.count("message.pinned", { action: "unpin", result: "ok" });
      remove(channelId, messageId);
      return { ok: true };
    } catch (e) {
      metrics.count("message.pinned", { action: "unpin", result: "failed", error: errorKind(e) });
      logger.error("[Pins] Failed to unpin", messageId, e);
      return { ok: false, error: null };
    }
  }

  // The event names the message only. A cached copy is enough for the panel; otherwise the list is
  // stale, and is asked for again when the panel opens (every viewer asking at once is a stampede).
  async function onPinned(x: MessagePinned) {
    if (!isLoaded(x.channelId) || isPinned(x.channelId, x.messageId)) return;
    const cached = await messageStore.getMessageById(x.messageId);
    // The cache is keyed by a rounded Number: a row there may be another message.
    if (cached && cached.messageId === x.messageId && cached.channelId === x.channelId) {
      upsert(x.channelId, { message: cached, pinnedBy: x.byUserId, pinnedAt: IonDateTime.now() });
      return;
    }
    stale.add(x.channelId);
  }

  bus.onServerEvent<MessagePinned>("MessagePinned", (x) => void onPinned(x));
  bus.onServerEvent<MessageUnpinned>("MessageUnpinned", (x) => remove(x.channelId, x.messageId));
  bus.onServerEvent<MessageDeleted>("MessageDeleted", (x) => remove(x.channelId, x.messageId));
  bus.onServerEvent<MessageUpdated>("MessageUpdated", (x) => replaceMessage(x.message));

  onSessionReset(() => {
    session++;
    byChannel.clear();
    recency.clear();
    failed.clear();
    loadedAt.clear();
    stale.clear();
    inflight.clear();
  });

  return { list, isLoaded, isFailed, isPinned, load, ensure, pin, unpin };
});
