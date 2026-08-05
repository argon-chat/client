import { computed, ref } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import type { VideoQuality } from "livekit-client";
import { usePoolStore, type IRealtimeChannelUserWithData } from "@/store/data/poolStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMe } from "@/store/auth/meStore";
import { useSystemStore } from "@/store/system/systemStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";

export type VideoSource = "camera" | "screen_share";
export type MediaLayoutMode = "channel" | "dm";

/**
 * Build a Map<Guid, IRealtimeChannelUserWithData> from voice.participants + local participant.
 * Used in DM mode where there is no realtime channel users from the pool.
 */
function buildDmUsers(
  voice: ReturnType<typeof useUnifiedCall>,
  me: ReturnType<typeof useMe>,
  sys: ReturnType<typeof useSystemStore>,
): Map<Guid, IRealtimeChannelUserWithData> {
  const map = new Map<Guid, IRealtimeChannelUserWithData>();

  // Local participant
  const myId = me.me?.userId;
  if (myId && voice.room?.localParticipant) {
    map.set(myId, {
      User: { userId: myId, displayName: me.me?.displayName ?? "You" } as any,
      isSpeaking: voice.speaking.has(myId),
      isMuted: sys.microphoneMuted,
      isScreenShare: voice.isSharing,
      volume: [100],
      isRecording: false,
    } as IRealtimeChannelUserWithData);
  }

  // Remote participants
  for (const [uid, p] of Object.entries(voice.participants)) {
    map.set(uid, {
      User: { userId: uid, displayName: p.displayName } as any,
      isSpeaking: voice.speaking.has(uid),
      isMuted: p.muted,
      isScreenShare: p.screencast,
      volume: p.volume,
      isRecording: false,
    } as IRealtimeChannelUserWithData);
  }

  return map;
}

export function useMediaLayout(
  selectedChannelId: () => string | null,
  mode: MediaLayoutMode = "channel",
) {
  const pool = usePoolStore();
  const voice = useUnifiedCall();
  const me = useMe();
  const sys = useSystemStore();
  const activity = usePlayFrameActivity();

  const focusedUserId = ref<Guid | null>(null);

  const users = computed(() => {
    if (mode === "dm") {
      return buildDmUsers(voice, me, sys);
    }
    const ch = selectedChannelId() ? pool.realtimeChannelUsers.get(selectedChannelId()!) : null;
    return ch?.Users ?? new Map<Guid, IRealtimeChannelUserWithData>();
  });

  const allUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() =>
    Array.from(users.value as Map<Guid, IRealtimeChannelUserWithData>),
  );

  const mainStreamer = computed<IRealtimeChannelUserWithData | null>(() => {
    if (focusedUserId.value) {
      const user = users.value.get(focusedUserId.value);
      if (user) return user as IRealtimeChannelUserWithData;
    }

    for (const [, user] of users.value) {
      if (user.isScreenShare) return user as IRealtimeChannelUserWithData;
    }

    // Check for any screen share track
    for (const [key] of voice.videoTracks) {
      const [userId, source] = key.split(":");
      if (source === "screen_share") {
        const user = users.value.get(userId);
        if (user) return user as IRealtimeChannelUserWithData;
      }
    }

    return null;
  });

  const otherUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() => {
    if (!mainStreamer.value) return allUsers.value;
    const mainId = mainStreamer.value.User.userId;
    return allUsers.value.filter(([id]) => id !== mainId);
  });

  const hasActiveStream = computed(() => !!mainStreamer.value);

  const gridClasses = computed(() => ({
    "grid-cols-1": allUsers.value.length === 1,
    "grid-cols-2": allUsers.value.length >= 3 && allUsers.value.length <= 4,
    "grid-cols-3": allUsers.value.length > 4,
  }));

  const gridCardStyle = (userCount: number) => ({
    aspectRatio: "16/9",
    maxHeight: userCount === 1 ? "25rem" : "19rem",
    minWidth: userCount === 1 ? "28rem" : "20rem",
    minHeight: userCount === 1 ? "15.75rem" : "11.25rem",
  });

  const muteStates = computed(() => {
    const states = new Map<Guid, { muted: boolean; headphoneMuted: boolean }>();
    const myId = me.me?.userId;
    const sysMicMuted = sys.microphoneMuted;
    const sysHeadMuted = sys.headphoneMuted;

    if (myId) {
      states.set(myId, { muted: sysMicMuted, headphoneMuted: sysHeadMuted });
    }

    for (const uid of Object.keys(voice.participants)) {
      if (uid === myId) continue;
      const participant = voice.participants[uid];
      states.set(uid, { muted: participant.muted, headphoneMuted: participant.mutedAll });
    }

    return states;
  });

  const isSpeaking = (uid: Guid) => {
    const _ = voice.speaking.size;
    return voice.speaking.has(uid);
  };

  /** Check if user has ANY video track (camera or screen_share) */
  const hasVideo = (uid: Guid) => voice.hasVideoTrack(uid);

  /** Check if user has a camera video track */
  const hasCameraVideo = (uid: Guid) => {
    return voice.videoTracks.has(voice.videoTrackKey(uid, "camera"));
  };

  /** Check if user has a screen share video track */
  const hasScreenShareVideo = (uid: Guid) => {
    return voice.videoTracks.has(voice.videoTrackKey(uid, "screen_share"));
  };

  /**
   * Returns the best video source for a participant card.
   * - 'camera' preferred for grid/thumbnail cards (user face)
   * - 'screen_share' preferred for the main streamer card
   */
  const getPreferredSource = (uid: Guid, prefer: "camera" | "screen_share" = "camera") => {
    const hasCam = voice.videoTracks.has(voice.videoTrackKey(uid, "camera"));
    const hasSS = voice.videoTracks.has(voice.videoTrackKey(uid, "screen_share"));

    if (prefer === "camera") {
      if (hasCam) return "camera";
      if (hasSS) return "screen_share";
    } else {
      if (hasSS) return "screen_share";
      if (hasCam) return "camera";
    }
    return "camera";
  };

  /**
   * Whether the video a card would show is currently paused by adaptive streaming
   * (tile off-screen or hidden), so the picture is a frozen last frame.
   */
  const isVideoPaused = (uid: Guid, prefer: "camera" | "screen_share" = "camera") =>
    voice.isVideoPaused(uid, getPreferredSource(uid, prefer));

  /** Whether the local user switched this tile's video off (see call store). */
  const isVideoHidden = (uid: Guid, prefer: "camera" | "screen_share" = "camera") =>
    voice.isVideoHidden(uid, getPreferredSource(uid, prefer));

  /** Server-reported link quality for one participant, for a per-tile warning badge. */
  const qualityOf = (uid: Guid) => voice.participantQuality.get(uid) ?? null;

  /** Set when the SFU refused to give us this participant's track. */
  const subscriptionErrorOf = (uid: Guid) => voice.subscriptionErrors.get(uid) ?? null;

  /**
   * Live receive stats for a tile, already collected once a second by the call store.
   * Shown on hover so "why does this look bad" is answerable without a debug overlay.
   */
  const videoStats = (uid: Guid) => {
    const d = voice.diagnostics.get(uid);
    if (!d) return null;
    return {
      width: d.width as number | null,
      height: d.height as number | null,
      codec: (d.codec as string | null)?.split("/").pop() ?? null,
      bitrateKbps: d.bitrateKbps as number | null,
      packetsLost: (d.videoPacketsLost ?? d.audioPacketsLost) as number | null,
    };
  };

  /**
   * Aspect ratio of the incoming picture, so a 16:10, ultrawide or portrait share
   * fills the main tile instead of sitting in letterbox bars inside a forced 16:9.
   */
  const videoAspectRatio = (uid: Guid) => {
    const d = voice.diagnostics.get(uid);
    const w = d?.width as number | undefined;
    const h = d?.height as number | undefined;
    if (!w || !h) return "16 / 9";
    return `${w} / ${h}`;
  };

  /**
   * The per-tile bindings every ParticipantCard needs, in one object — there are eight
   * call sites across the channel and DM views and they must not drift apart.
   */
  const tileProps = (uid: Guid, prefer: "camera" | "screen_share" = "camera") => {
    const source = getPreferredSource(uid, prefer);
    return {
      videoSource: source,
      isVideoPaused: voice.isVideoPaused(uid, source),
      isVideoHidden: voice.isVideoHidden(uid, source),
      videoQuality: voice.videoQualityOf(uid, source),
      isPinned: isPinned(uid),
      connectionQuality: qualityOf(uid),
      subscriptionError: subscriptionErrorOf(uid),
      stats: videoStats(uid),
    };
  };

  const setVideoHidden = (uid: Guid, source: string, hidden: boolean) =>
    voice.setVideoHidden(uid, source, hidden);

  const setVideoQuality = (uid: Guid, source: string, quality: VideoQuality) =>
    voice.setVideoQuality(uid, source, quality);

  const isScreenSharing = (uid: Guid) => {
    const myId = me.me?.userId;
    if (uid === myId) return voice.isSharing;
    // Check remote screen share track
    if (hasScreenShareVideo(uid)) return true;
    const user = users.value.get(uid);
    return user?.isScreenShare ?? false;
  };

  const isMuted = (uid: Guid) => muteStates.value.get(uid)?.muted ?? false;

  const isHeadphoneMuted = (uid: Guid) => muteStates.value.get(uid)?.headphoneMuted ?? false;

  const isPlayingActivity = (uid: Guid) => {
    // Any channel activity that's actually in-play and counts `uid` as a player
    // (host OR a joined player — presence carries the full player list, so the
    // icon syncs to every participant, not only the host). While a multiplayer
    // host waits for player 2 the state is "waiting", so no icon shows yet.
    for (const a of activity.channelActivities) {
      if (a.state !== "playing") continue;
      if (a.hostId === uid || a.players.includes(uid)) return true;
    }
    // My own hosted activity (self presence isn't broadcast). Only the host
    // reports a live lifecycle; players/watchers rely on the loop above.
    if (activity.isActive && activity.myRole === "host" && uid === me.me?.userId) {
      return activity.sessionLifecycle === "playing";
    }
    return false;
  };

  const toggleFocus = (userId: Guid) => {
    focusedUserId.value = focusedUserId.value === userId ? null : userId;
  };

  /** True when this tile is pinned by hand, as opposed to being main by default. */
  const isPinned = (uid: Guid) => focusedUserId.value === uid;

  const clearFocus = () => {
    focusedUserId.value = null;
  };

  /**
   * The participant the server currently hears as loudest. Only meaningful for
   * auto-focus in the grid; the per-tile speaking ring stays on our own VU meter,
   * which reacts faster.
   */
  const activeSpeakerId = computed(() => voice.activeSpeakerId);

  // The call store owns this: it prefers the server's own quality report (real packet
  // loss and jitter) and only falls back to RTT before the first report arrives.
  const qualityConnection = computed<"NONE" | "GREEN" | "ORANGE" | "RED">(
    () => voice.qualityConnection as "NONE" | "GREEN" | "ORANGE" | "RED",
  );

  return {
    allUsers,
    mainStreamer,
    otherUsers,
    hasActiveStream,
    gridClasses,
    gridCardStyle,
    isSpeaking,
    hasVideo,
    hasCameraVideo,
    hasScreenShareVideo,
    getPreferredSource,
    isVideoPaused,
    isVideoHidden,
    qualityOf,
    subscriptionErrorOf,
    videoStats,
    videoAspectRatio,
    tileProps,
    setVideoHidden,
    setVideoQuality,
    isScreenSharing,
    isMuted,
    isHeadphoneMuted,
    isPlayingActivity,
    toggleFocus,
    isPinned,
    clearFocus,
    activeSpeakerId,
    qualityConnection,
  };
}
