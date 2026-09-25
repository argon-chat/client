import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useSystemStore } from "@/store/system/systemStore";
import { useMe } from "@/store/auth/meStore";
import { resolveVoiceIndicators, type LiveVoiceState, type VoiceIndicators } from "@/lib/voice/indicators";

/**
 * Voice indicators for any member of any voice channel: the roster flags everywhere, plus the
 * live state for members of the room we are in, so a mute there shows without waiting for the
 * server's echo.
 */
export function useVoiceIndicators() {
  const voice = useUnifiedCall();
  const sys = useSystemStore();
  const me = useMe();

  function liveStateOf(userId: string, channelId: string | null | undefined): LiveVoiceState | null {
    if (!channelId || voice.connectedVoiceChannelId !== channelId) return null;
    if (userId === me.me?.userId) {
      return {
        self: true,
        muted: sys.microphoneMuted,
        deafened: sys.headphoneMuted,
        streaming: voice.isSharing,
        serverMuted: voice.serverMuted,
        serverDeafened: voice.serverDeafened,
      };
    }
    const p = voice.participants[userId];
    if (!p) return null;
    return { self: false, muted: p.muted, deafened: p.mutedAll, streaming: p.screencast };
  }

  function indicatorsFor(userId: string, channelId: string | null | undefined, state: number | null | undefined): VoiceIndicators {
    return resolveVoiceIndicators(state, liveStateOf(userId, channelId));
  }

  return { indicatorsFor };
}
