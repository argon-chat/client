/**
 * Publishes the current voice-channel state to the Electron main process so the
 * in-game overlay window can render it. No-op outside Electron (the `argonOverlay`
 * preload bridge only exists there) and in the overlay window itself.
 *
 * Mirrors the member computation in OverlayDebug.vue, but resolves avatars to a
 * fetchable CDN URL (via {@link cdnUrl}) so the offscreen overlay window can load them.
 */
import { computed, watch } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useRealtimeStore } from "@/store/realtime/realtimeStore";
import { useUserColors } from "@/store/chat/userColors";
import { useSystemStore } from "@/store/system/systemStore";
import { useMe } from "@/store/auth/meStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

export interface OverlayMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenShare: boolean;
}

export function useOverlayPublisher(): void {
  const bridge = (globalThis as any).argonOverlay;
  // Only the main app window (with the preload bridge) publishes. The overlay
  // window subscribes instead; the web build has no bridge at all.
  if (!bridge?.publishVoiceState || bridge?.isOverlayWindow) return;

  const voice = useUnifiedCall();
  const realtimeStore = useRealtimeStore();
  const userColors = useUserColors();
  const sys = useSystemStore();
  const me = useMe();
  const featureFlags = useFeatureFlags();

  // Gated behind the `af.overlay.games.enabled` feature flag (default off). When
  // disabled, inVoice stays false so the native overlay never activates.
  const inVoice = computed(
    () => featureFlags.overlayGamesEnabled && !!voice.connectedVoiceChannelId,
  );

  const members = computed<OverlayMember[]>(() => {
    const result: OverlayMember[] = [];
    const channelId = voice.connectedVoiceChannelId;
    if (!channelId) return result;

    const channel = realtimeStore.realtimeChannels.get(channelId);
    if (!channel) return result;

    for (const [userId, user] of channel.Users) {
      const isMe = userId === me.me?.userId;
      let isMuted = false;
      let isDeafened = false;
      if (isMe) {
        isMuted = sys.microphoneMuted;
        isDeafened = sys.headphoneMuted;
      } else {
        const participant = voice.participants[userId];
        isMuted = participant?.muted ?? false;
        isDeafened = participant?.mutedAll ?? false;
      }

      const fileId = user.User?.avatarFileId ?? null;
      result.push({
        userId,
        displayName: user.User?.displayName ?? "Unknown",
        avatarUrl: fileId ? cdnUrl(fileId) : null,
        avatarColor: userColors.getColorByUserId(userId),
        isSpeaking: voice.speaking.has(userId),
        isMuted,
        isDeafened,
        isScreenShare: (user as { isScreenShare?: boolean }).isScreenShare ?? false,
      });
    }
    return result;
  });

  const publish = () =>
    bridge.publishVoiceState({ inVoice: inVoice.value, members: members.value });

  // `members` recomputes when speaking/mute/membership changes, so a deep watch
  // here covers every overlay-relevant transition.
  watch([inVoice, members], publish, { deep: true, immediate: true });
}
