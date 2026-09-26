import { computed, type ComputedRef } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { usePexStore } from "@/store/data/permissionStore";
import type { ArgonEntitlementFlag } from "@/lib/rbac/ArgonEntitlement";

/**
 * What the user may do in the voice channel they are in: speak, show video, share the screen,
 * transmit on the radio when it is a broadcast channel.
 * Outside a channel call (a direct call, or no call) everything is allowed — those have no roles.
 */
export function useCallPermissions() {
  const voice = useUnifiedCall();
  const pex = usePexStore();

  const allows = (flag: ArgonEntitlementFlag): ComputedRef<boolean> =>
    computed(() => {
      const channelId = voice.connectedVoiceChannelId;
      if (voice.mode !== "channel" || !channelId) return true;
      return pex.hasIn(channelId, flag, voice.connectedVoiceSpaceId);
    });

  return {
    canSpeak: allows("Speak"),
    canVideo: allows("Video"),
    canStream: allows("Stream"),
    canBroadcast: allows("Broadcast"),
  };
}
