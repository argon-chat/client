import { computed, ref } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import { usePoolStore, type IRealtimeChannelUserWithData } from "@/store/data/poolStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMe } from "@/store/auth/meStore";
import { useSystemStore } from "@/store/system/systemStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";

export type VideoSource = "camera" | "screen_share";

export function useMediaLayout(selectedChannelId: () => string | null) {
  const pool = usePoolStore();
  const voice = useUnifiedCall();
  const me = useMe();
  const sys = useSystemStore();
  const activity = usePlayFrameActivity();

  const focusedUserId = ref<Guid | null>(null);

  const users = computed(() => {
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
    if (!activity.isActive) return false;
    return activity.participants.some(
      (p) => p.displayName === users.value.get(uid)?.User.displayName,
    );
  };

  const toggleFocus = (userId: Guid) => {
    focusedUserId.value = focusedUserId.value === userId ? null : userId;
  };

  const qualityConnection = computed<"NONE" | "GREEN" | "ORANGE" | "RED">(() => {
    if (!voice.isConnected) return "NONE";
    const ms = parseInt(String(voice.ping).replace("ms", "").trim(), 10);
    if (!ms || ms <= 0) return "NONE";
    if (ms < 50) return "GREEN";
    if (ms < 100) return "ORANGE";
    return "RED";
  });

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
    isScreenSharing,
    isMuted,
    isHeadphoneMuted,
    isPlayingActivity,
    toggleFocus,
    qualityConnection,
  };
}
