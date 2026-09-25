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
import { cdnUrl } from "@/store/system/fileStorage";
import { useVoiceIndicators } from "@/composables/useVoiceIndicators";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

export interface OverlayMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  /** Muted/deafened by a moderator: drawn in the stronger "server" style. */
  isServerMuted: boolean;
  isServerDeafened: boolean;
  isScreenShare: boolean;
}

/**
 * The overlay draws avatars onto a canvas, so it loads them with crossorigin="anonymous" — a CORS
 * request. The main window shows the same picture through a plain <img>, whose cached 302 from
 * the API carried no CORS header, and the browser handed that cached redirect to the overlay and
 * failed the load. A query marker gives the overlay a cache entry of its own; the API ignores it.
 */
function overlayAvatarUrl(fileId: string): string {
  return `${cdnUrl(fileId)}?overlay=1`;
}

export function useOverlayPublisher(): void {
  const bridge = (globalThis as any).argonOverlay;
  // Only the main app window (with the preload bridge) publishes. The overlay
  // window subscribes instead; the web build has no bridge at all.
  if (!bridge?.publishVoiceState || bridge?.isOverlayWindow) return;

  const voice = useUnifiedCall();
  const realtimeStore = useRealtimeStore();
  const userColors = useUserColors();
  const featureFlags = useFeatureFlags();
  const { indicatorsFor } = useVoiceIndicators();

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
      const ind = indicatorsFor(userId, channelId, user.state);

      const fileId = user.User?.avatarFileId ?? null;
      result.push({
        userId,
        displayName: user.User?.displayName ?? "Unknown",
        avatarUrl: fileId ? overlayAvatarUrl(fileId) : null,
        avatarColor: userColors.getColorByUserId(userId),
        isSpeaking: voice.speaking.has(userId),
        isMuted: ind.micOff,
        isDeafened: ind.headphonesOff,
        isServerMuted: ind.micByServer,
        isServerDeafened: ind.headphonesByServer,
        isScreenShare: ind.streaming || ((user as { isScreenShare?: boolean }).isScreenShare ?? false),
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
