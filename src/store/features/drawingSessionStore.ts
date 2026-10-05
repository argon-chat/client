/**
 * Screencast drawing: who may draw on whose share, and the strokes themselves.
 *
 * The host's own client decides whether its share can be drawn on, and says so with the `draw`
 * capability on its LiveKit participant (see @argon/calls capabilities). It is offered only when
 * the native overlay can paint on the shared monitor — the Windows desktop app on a hardware GPU;
 * a browser or a Mac has no overlay and offers nothing — and the host's "stream.draw" privacy rule
 * allows it: `draw` for anyone, `draw=contacts` for the host's contacts. A host whose rule says
 * nobody can still allow drawing on this one share, which offers `draw` until the share ends.
 *
 * Everyone reads the offer off the host's participant, so someone joining mid-share sees it as
 * soon as they see the host. A viewer may draw when the host's offer covers them and, in a
 * channel, the channel grants them CanDrawOnStream.
 *
 * Data plane: stroke packets ride the LiveKit room data channel on topic "af-draw". Every
 * participant paints them into a canvas over the host's <video>; the host additionally forwards
 * them to the native overlay so they land on the real monitor. The host takes a stroke only from
 * someone its offer covers, judged by the sender's identity rather than what the packet claims.
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Room, RemoteParticipant } from "livekit-client";
import { RoomEvent } from "livekit-client";
import { logger } from "@argon/core";
import { PrivacyRuleMode } from "@argon/glue";

import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMe } from "@/store/auth/meStore";
import { useApi } from "@/store/system/apiStore";
import { useFriendsStore } from "@/store/data/friendsStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { DRAW_TOPIC, type DrawPacket } from "@/lib/screencast-draw/types";

/** The capability a host publishes while its share can be drawn on. */
export const DRAW_CAPABILITY = "draw";
/** Its value when the offer is to the host's contacts only. */
export const DRAW_CONTACTS = "contacts";
/** The privacy rule behind the offer: who may draw on my streams. */
const STREAM_DRAW_RULE = "stream.draw";

/** The Electron bridge to the native overlay; absent on the web. */
interface ScreencastDrawBridge {
  isAvailable?(): Promise<boolean>;
  start?(sourceId: string | null): void;
  stop?(): void;
  applyStroke?(packet: DrawPacket): void;
}

const bridge = (): ScreencastDrawBridge | undefined =>
  (window as any).argonScreencastDraw as ScreencastDrawBridge | undefined;

/** Fields a DrawOverlay supplies; the store stamps the envelope (v/from/target/t). */
type PacketBody =
  | Omit<Extract<DrawPacket, { kind: "begin" }>, "v" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "append" }>, "v" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "end" }>, "v" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "clear" }>, "v" | "from" | "target" | "t">
  | Omit<Extract<DrawPacket, { kind: "undo" }>, "v" | "from" | "target" | "t">;

export const useDrawingSession = defineStore("drawingSession", () => {
  const call = useUnifiedCall();
  const me = useMe();
  const api = useApi();
  const friends = useFriendsStore();
  const pex = usePexStore();
  const ff = useFeatureFlags();

  const selfId = () => me.me?.userId ?? null;

  // ── Host: what my share offers ────────────────────────────────────

  /** Whether this client can paint on the shared monitor at all. Probed once; false on the web. */
  const overlayAvailable = ref(false);
  void Promise.resolve()
    .then(() => bridge()?.isAvailable?.())
    .then((ok) => { overlayAvailable.value = !!ok; })
    .catch(() => { overlayAvailable.value = false; });

  const sharing = ref(false);
  let shareSourceId: string | null = null;
  /** Counts shares, so one that ended while its rule was still loading does not come back. */
  let shareEpoch = 0;
  /** The host's "stream.draw" rule, read when a share starts. */
  const privacyMode = ref<PrivacyRuleMode>(PrivacyRuleMode.NOBODY);
  /** The host allowed drawing on this one share although their rule says nobody. */
  const allowedThisShare = ref(false);

  /** What my share offers: "" to anyone, "contacts" to my contacts, null when nothing. */
  const offered = computed<string | null>(() => {
    if (!ff.screencastDrawingActive || !sharing.value || !overlayAvailable.value) return null;
    if (allowedThisShare.value) return "";
    switch (privacyMode.value) {
      case PrivacyRuleMode.CONTACTS: return DRAW_CONTACTS;
      case PrivacyRuleMode.NOBODY: return null;
      default: return "";
    }
  });

  /** The host can turn drawing on for this share: there is an overlay, and only their rule is in the way. */
  const canAllowThisShare = computed(
    () => ff.screencastDrawingActive && sharing.value && overlayAvailable.value && privacyMode.value === PrivacyRuleMode.NOBODY,
  );

  function toggleAllowThisShare(): void {
    if (!canAllowThisShare.value) return;
    allowedThisShare.value = !allowedThisShare.value;
  }

  // The offer is the capability, and the native overlay lives exactly as long as the offer.
  watch(offered, (value, previous) => {
    try { call.setCapability(DRAW_CAPABILITY, value); }
    catch (e) { logger.warn("[draw] failed to publish the offer", e); }
    if (value !== null && previous === null) {
      try { bridge()?.start?.(shareSourceId); } catch (e) { logger.warn("[draw] overlay start failed", e); }
    } else if (value === null && previous !== null) {
      try { bridge()?.stop?.(); } catch (e) { logger.warn("[draw] overlay stop failed", e); }
    }
  }, { flush: "sync" });

  /** The rule as the server holds it; when it cannot be read nothing is offered rather than everything. */
  async function readPrivacyMode(): Promise<PrivacyRuleMode> {
    try {
      const rule = await api.privacyInteraction.GetPrivacyRule(STREAM_DRAW_RULE, null);
      return rule?.mode ?? PrivacyRuleMode.EVERYBODY;
    } catch (e) {
      logger.warn("[draw] could not read the stream.draw rule; offering nothing", e);
      return PrivacyRuleMode.NOBODY;
    }
  }

  /** Host: a share just started from `sourceId` (the captured monitor, where the overlay goes). */
  async function beginStreamerSession(sourceId: string | null): Promise<void> {
    const epoch = ++shareEpoch;
    shareSourceId = sourceId;
    allowedThisShare.value = false;
    if (!ff.screencastDrawingActive || !overlayAvailable.value) return;
    const mode = await readPrivacyMode();
    if (epoch !== shareEpoch) return;
    privacyMode.value = mode;
    sharing.value = true;
  }

  /** Host: the share ended, and with it every offer made for it. */
  function endStreamerSession(): void {
    shareEpoch++;
    sharing.value = false;
    allowedThisShare.value = false;
    shareSourceId = null;
  }

  // ── Viewer: what others offer me ──────────────────────────────────

  /** What `hostId`'s share offers: "" to anyone, "contacts" to their contacts, null when nothing. */
  function offeredBy(hostId: string): string | null {
    if (hostId === selfId()) return offered.value;
    return call.capabilityOf(hostId, DRAW_CAPABILITY);
  }

  /** Whether `hostId`'s share can be drawn on by someone — what puts a drawing surface over it. */
  function isDrawable(hostId: string): boolean {
    return ff.screencastDrawingActive && offeredBy(hostId) !== null;
  }

  /** Whether the local user may draw on `hostId`'s share right now. */
  function canIDrawOn(hostId: string): boolean {
    const id = selfId();
    if (!id || hostId === id || !ff.screencastDrawingActive) return false;
    const value = offeredBy(hostId);
    if (value === null) return false;
    if (value === DRAW_CONTACTS && !friends.isFriend(hostId)) return false;
    // In a channel the right to draw is a channel entitlement; a direct call has no such thing.
    const channelId = call.connectedVoiceChannelId;
    return !channelId || pex.hasIn(channelId, "CanDrawOnStream", call.connectedVoiceSpaceId);
  }

  /** The host's side of the offer: whether a stroke from `userId` lands on my monitor. */
  function acceptedFrom(userId: string): boolean {
    const value = offered.value;
    if (value === null || userId === selfId()) return false;
    return value !== DRAW_CONTACTS || friends.isFriend(userId);
  }

  /** True if there is at least one share the local user may draw on. */
  const canDrawAnywhere = computed(() => Object.keys(call.participants).some((uid) => canIDrawOn(uid)));

  /** Whether the brush UI is engaged (per-share pointer capture is still gated by canIDrawOn). */
  const drawMode = ref(false);
  function toggleDrawMode(): void { drawMode.value = !drawMode.value; }
  watch(canDrawAnywhere, (ok) => { if (!ok) drawMode.value = false; });

  // ── Data plane ────────────────────────────────────────────────────

  /** Per-host packet consumers (each mounted DrawOverlay registers one). */
  const consumers = new Map<string, Set<(p: DrawPacket) => void>>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let boundRoom: Room | null = null;

  function onData(
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ): void {
    if (topic !== DRAW_TOPIC) return;
    let packet: DrawPacket;
    try {
      packet = JSON.parse(decoder.decode(payload)) as DrawPacket;
    } catch (e) {
      logger.warn("[draw] failed to decode packet", e);
      return;
    }
    // A stroke is whoever sent it, not whoever it says it is.
    if (!participant || packet.from !== participant.identity) return;
    if (!isDrawable(packet.target)) return;
    if (packet.target === selfId() && !acceptedFrom(packet.from)) return;
    dispatch(packet);
  }

  /** Fan a packet out to the canvases for its host, and to the native overlay if the host is me. */
  function dispatch(packet: DrawPacket): void {
    const set = consumers.get(packet.target);
    if (set) for (const cb of set) cb(packet);
    if (packet.target === selfId()) {
      try { bridge()?.applyStroke?.(packet); }
      catch (e) { logger.warn("[draw] native forward failed", e); }
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
        drawMode.value = false;
      }
    },
    { immediate: true },
  );

  function registerConsumer(hostId: string, cb: (p: DrawPacket) => void): () => void {
    let set = consumers.get(hostId);
    if (!set) { set = new Set(); consumers.set(hostId, set); }
    set.add(cb);
    return () => {
      const s = consumers.get(hostId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) consumers.delete(hostId);
    };
  }

  /** Send a stroke to `hostId`'s share; nothing leaves unless the host's offer covers me. */
  function publish(hostId: string, body: PacketBody): void {
    const id = selfId();
    if (!id || !canIDrawOn(hostId)) return;

    const packet = { v: 1, from: id, target: hostId, t: Date.now(), ...body } as DrawPacket;
    dispatch(packet); // local echo

    // Reliable for begin/end/clear/undo; unreliable for high-rate append.
    boundRoom?.localParticipant
      .publishData(encoder.encode(JSON.stringify(packet)), {
        reliable: packet.kind !== "append",
        topic: DRAW_TOPIC,
      })
      .catch((e) => logger.warn("[draw] publishData failed", e));
  }

  /** Clear only the local user's own strokes on a host's share. */
  function clearOwn(hostId: string): void {
    const id = selfId();
    if (!id) return;
    publish(hostId, { kind: "clear", who: id });
  }

  return {
    overlayAvailable,
    offered,
    canAllowThisShare,
    allowedThisShare,
    toggleAllowThisShare,
    beginStreamerSession,
    endStreamerSession,
    isDrawable,
    canIDrawOn,
    canDrawAnywhere,
    drawMode,
    toggleDrawMode,
    registerConsumer,
    publish,
    clearOwn,
  };
});
