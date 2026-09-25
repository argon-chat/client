import { toast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { MoveVoiceMemberError, VoiceModerationError } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { useRealtimeStore } from "@/store/realtime/realtimeStore";

const MOVE_ERROR_KEYS: Record<MoveVoiceMemberError, string> = {
  [MoveVoiceMemberError.NONE]: "voice_move_failed",
  [MoveVoiceMemberError.INSUFFICIENT_PERMISSIONS]: "voice_move_error_insufficient_permissions",
  [MoveVoiceMemberError.MEMBER_NOT_IN_CHANNEL]: "voice_move_error_member_not_in_channel",
  [MoveVoiceMemberError.TARGET_NOT_FOUND]: "voice_move_error_target_not_found",
  [MoveVoiceMemberError.TARGET_IS_NOT_VOICE]: "voice_move_error_target_is_not_voice",
  [MoveVoiceMemberError.SAME_CHANNEL]: "voice_move_error_same_channel",
  [MoveVoiceMemberError.MEMBER_CANNOT_JOIN_TARGET]: "voice_move_error_member_cannot_join_target",
};

const MODERATION_ERROR_KEYS: Record<VoiceModerationError, string> = {
  [VoiceModerationError.NONE]: "voice_moderation_failed",
  [VoiceModerationError.INSUFFICIENT_PERMISSIONS]: "voice_moderation_error_insufficient_permissions",
  [VoiceModerationError.MEMBER_NOT_FOUND]: "voice_moderation_error_member_not_found",
  [VoiceModerationError.CANNOT_MODERATE_OWNER]: "voice_moderation_error_cannot_moderate_owner",
};

/**
 * Moderator actions on a voice member: move to another voice channel, server mute, server deafen.
 * Each resolves to whether the server accepted it; a refusal is shown as a toast here.
 */
export function useVoiceModeration() {
  const api = useApi();
  const realtime = useRealtimeStore();
  const { t } = useLocale();

  const fail = (key: string) => toast({ title: t(key), variant: "destructive" });

  /** `fromChannelId` is the channel the member is in now: the call is made on it. */
  async function moveMember(spaceId: string, fromChannelId: string, userId: string, targetChannelId: string) {
    try {
      const result = await api.channelInteraction.MoveVoiceMember(spaceId, fromChannelId, userId, targetChannelId);
      // Failure first: the success case carries no fields, so narrowing on it would leave `never`.
      if (!result.isFailedMoveVoiceMember()) return true;
      logger.warn("[voice] move refused", MoveVoiceMemberError[result.error] ?? result.error);
      fail(MOVE_ERROR_KEYS[result.error] ?? "voice_move_failed");
    } catch (e) {
      logger.error("[voice] move failed", e);
      fail("voice_move_failed");
    }
    return false;
  }

  /** Null leaves that flag as it is on the server. */
  async function setRestriction(spaceId: string, userId: string, muted: boolean | null, deafened: boolean | null) {
    try {
      const result = await api.serverInteraction.SetMemberVoiceModeration(spaceId, userId, muted, deafened);
      if (result.isSuccessVoiceModeration()) {
        realtime.setUserServerVoiceState(spaceId, userId, result.muted, result.deafened);
        return true;
      }
      if (result.isFailedVoiceModeration()) {
        logger.warn("[voice] moderation refused", VoiceModerationError[result.error] ?? result.error);
        fail(MODERATION_ERROR_KEYS[result.error] ?? "voice_moderation_failed");
        return false;
      }
      fail("voice_moderation_failed");
    } catch (e) {
      logger.error("[voice] moderation failed", e);
      fail("voice_moderation_failed");
    }
    return false;
  }

  const setServerMuted = (spaceId: string, userId: string, muted: boolean) =>
    setRestriction(spaceId, userId, muted, null);

  const setServerDeafened = (spaceId: string, userId: string, deafened: boolean) =>
    setRestriction(spaceId, userId, null, deafened);

  return { moveMember, setServerMuted, setServerDeafened };
}
