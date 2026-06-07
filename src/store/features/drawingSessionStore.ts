/**
 * Screencast drawing — client data + control plane.
 *
 * Data plane: stroke packets ride the LiveKit room data channel on topic "af-draw"
 * (same mechanism as PlayFrame). Every participant receives them; viewers paint into a
 * DOM canvas over the <video>, and the STREAMER additionally forwards each packet to the
 * native overlay plugin (via the argonScreencastDraw preload bridge) so it paints on the
 * real monitor.
 *
 * Control plane: the streamer opens/closes a session through ChannelInteraction; the
 * server computes the allowed-drawers set (entitlement + privacy) and broadcasts
 * DrawingSessionStarted/Ended. Clients only enable the brush UI / accept packets for an
 * active session whose drawer is in that set.
 */
import { defineStore } from "pinia";
import { reactive, watch } from "vue";
import type { Room, RemoteParticipant } from "livekit-client";
import { RoomEvent } from "livekit-client";
import { logger } from "@argon/core";
import { DrawingSessionStarted, DrawingSessionEnded } from "@argon/glue";

import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMe } from "@/store/auth/meStore";
import { useBus } from "@/store/realtime/busStore";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import {
  DRAW_TOPIC,
  DEFAULT_TTL_MS,
  type DrawPacket,
} from "@/lib/screencast-draw/types";

interface ActiveSession {
  sessionId: string;
  allowedDrawers: Set<string>;
  defaultTtlMs: number;
}

/** Fields a DrawOverlay supplies; the store stamps the envelope (v/sid/from/target/t). */
type PacketBody =
  | Omit<Extract<DrawPacket, { kind: "begin" }>, "v" | "sid" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "append" }>, "v" | "sid" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "end" }>, "v" | "sid" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "clear" }>, "v" | "sid" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "undo" }>, "v" | "sid" | "from" | "target" | "t">;

export const useDrawingSession = defineStore("drawingSession", () => {
  const call = useUnifiedCall();
  const me = useMe();
  const bus = useBus();
  const api = useApi();
  const pool = usePoolStore();
  const ff = useFeatureFlags();

  /** Active sessions keyed by streamer (target) identity. */
  const sessions = reactive(new Map<string, ActiveSession>());

  /** Per-target packet consumers (each mounted DrawOverlay registers one). */
  const consumers = new Map<string, Set<(p: DrawPacket) => void>>();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let boundRoom: Room | null = null;
  // The capture source id of the local user's current share (for the native overlay).
  let myShareSourceId: string | null = null;

  const selfId = () => me.me?.userId ?? null;

  // ── LiveKit data channel ──────────────────────────────────────────

  function onData(
    payload: Uint8Array,
    _participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ): void {
    if (topic !== DRAW_TOPIC) return;
    try {
      const packet = JSON.parse(decoder.decode(payload)) as DrawPacket;
      handleIncoming(packet);
    } catch (e) {
      logger.warn("[draw] failed to decode packet", e);
    }
  }

  function handleIncoming(packet: DrawPacket): void {
    const sess = sessions.get(packet.target);
    if (!sess || sess.sessionId !== packet.sid) return; // unknown / stale session
    // The streamer may always annotate their own surface; others must be allowed.
    if (packet.from !== packet.target && !sess.allowedDrawers.has(packet.from)) return;
    dispatch(packet);
  }

  /** Fan a packet out to local canvases for its target, and to native if I'm the streamer. */
  function dispatch(packet: DrawPacket): void {
    const set = consumers.get(packet.target);
    if (set) for (const cb of set) cb(packet);

    if (packet.target === selfId()) {
      try {
        (window as any).argonScreencastDraw?.applyStroke?.(packet);
      } catch (e) {
        logger.warn("[draw] native forward failed", e);
      }
    }
  }

  function bindRoom(room: Room): void {
    if (boundRoom === room) return;
    unbindRoom();
    boundRoom = room;
    room.on(RoomEvent.DataReceived, onData);
  }

  function unbindRoom(): void {
    if (boundRoom) boundRoom.off(RoomEvent.DataReceived, onData);
    boundRoom = null;
  }

  watch(
    () => call.room,
    (r) => {
      if (r) bindRoom(r as unknown as Room);
      else {
        unbindRoom();
        sessions.clear();
      }
    },
    { immediate: true },
  );

  // ── Consumer registration (DrawOverlay ↔ store) ───────────────────

  function registerConsumer(targetId: string, cb: (p: DrawPacket) => void): () => void {
    let set = consumers.get(targetId);
    if (!set) { set = new Set(); consumers.set(targetId, set); }
    set.add(cb);
    return () => {
      const s = consumers.get(targetId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) consumers.delete(targetId);
    };
  }

  // ── Capabilities (drive the viewer brush UI) ──────────────────────

  function sessionFor(targetId: string): ActiveSession | undefined {
    return sessions.get(targetId);
  }

  function isSessionActive(targetId: string): boolean {
    return ff.screencastDrawingActive && sessions.has(targetId);
  }

  /** Whether the local user may draw on targetId's stream right now. */
  function canIDrawOn(targetId: string): boolean {
    if (!ff.screencastDrawingActive) return false;
    const sess = sessions.get(targetId);
    if (!sess) return false;
    const id = selfId();
    if (!id) return false;
    if (targetId === id) return true; // annotate my own surface
    return sess.allowedDrawers.has(id);
  }

  // ── Outgoing strokes (called by DrawOverlay) ──────────────────────

  function publish(targetId: string, body: PacketBody): void {
    const sess = sessions.get(targetId);
    const id = selfId();
    if (!sess || !id) return;

    const packet = {
      v: 1,
      sid: sess.sessionId,
      from: id,
      target: targetId,
      t: Date.now(),
      ...body,
    } as DrawPacket;

    dispatch(packet); // local echo (incl. native forward if I'm the streamer)

    // Reliable for begin/end/clear/undo; unreliable for high-rate append.
    boundRoom?.localParticipant
      .publishData(encoder.encode(JSON.stringify(packet)), {
        reliable: packet.kind !== "append",
        topic: DRAW_TOPIC,
      })
      .catch((e) => logger.warn("[draw] publishData failed", e));
  }

  /** Clear only the local user's own strokes on a target's surface. */
  function clearOwn(targetId: string): void {
    const id = selfId();
    if (!id) return;
    publish(targetId, { kind: "clear", who: id });
  }

  // ── Control plane ─────────────────────────────────────────────────

  function ctx(): { spaceId: string; channelId: string } | null {
    const spaceId = pool.selectedServer;
    const channelId = call.connectedVoiceChannelId;
    if (!spaceId || !channelId) return null;
    return { spaceId, channelId };
  }

  /** Streamer: open a drawing session for the share just started on `sourceId`. */
  async function beginStreamerSession(sourceId: string | null): Promise<void> {
    if (!ff.screencastDrawingActive) return;
    const c = ctx();
    const id = selfId();
    if (!c || !id) return;

    myShareSourceId = sourceId;
    try {
      const res = await api.channelInteraction.StartDrawingSession(c.spaceId, c.channelId);
      if (!res || !res.isDrawingStarted?.()) {
        logger.warn("[draw] StartDrawingSession denied", res);
        return;
      }
      const s = res.session;
      sessions.set(id, {
        sessionId: s.sessionId,
        allowedDrawers: new Set<string>(s.allowedDrawers ?? []),
        defaultTtlMs: s.defaultTtlMs || DEFAULT_TTL_MS,
      });
      // Bring up the native overlay on the shared monitor.
      try { (window as any).argonScreencastDraw?.start?.(sourceId); } catch { /* not electron */ }
      logger.info("[draw] streamer session started", s.sessionId);
    } catch (e) {
      logger.error("[draw] beginStreamerSession failed", e);
    }
  }

  /** Streamer: close the drawing session for the local user's share. */
  async function endStreamerSession(): Promise<void> {
    const c = ctx();
    const id = selfId();
    const sess = id ? sessions.get(id) : undefined;
    try { (window as any).argonScreencastDraw?.stop?.(); } catch { /* not electron */ }
    myShareSourceId = null;
    if (id) sessions.delete(id);
    if (c && sess) {
      try { await api.channelInteraction.StopDrawingSession(c.spaceId, c.channelId, sess.sessionId); }
      catch (e) { logger.warn("[draw] StopDrawingSession failed", e); }
    }
  }

  // ── Server broadcasts (viewer side) ───────────────────────────────

  bus.onServerEvent<DrawingSessionStarted>("DrawingSessionStarted", (ev) => {
    sessions.set(ev.ownerId, {
      sessionId: ev.sessionId,
      allowedDrawers: new Set<string>((ev.allowedDrawers as unknown as string[]) ?? []),
      defaultTtlMs: ev.defaultTtlMs || DEFAULT_TTL_MS,
    });
  });

  bus.onServerEvent<DrawingSessionEnded>("DrawingSessionEnded", (ev) => {
    for (const [target, s] of sessions) {
      if (s.sessionId === ev.sessionId) {
        sessions.delete(target);
        if (target === selfId()) {
          try { (window as any).argonScreencastDraw?.stop?.(); } catch { /* not electron */ }
        }
      }
    }
  });

  return {
    sessions,
    registerConsumer,
    sessionFor,
    isSessionActive,
    canIDrawOn,
    publish,
    clearOwn,
    beginStreamerSession,
    endStreamerSession,
  };
});
