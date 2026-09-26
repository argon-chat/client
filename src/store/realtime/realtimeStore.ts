import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { type Reactive, reactive, ref, shallowReactive } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import type { ArgonChannel, RealtimeChannelUser } from "@argon/glue";
import { withServerVoiceState } from "@argon/calls/voice-state";
import type { RealtimeUser } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/**
 * Extended user in realtime channel with states
 */
export interface IRealtimeChannelUser extends RealtimeChannelUser {
  User: RealtimeUser;
  isSpeaking: boolean;
  isMuted: boolean;
  isScreenShare: boolean;
  volume: number[];
  isRecording: boolean;
}

/**
 * Realtime channel with users and states
 */
export interface IRealtimeChannel {
  Channel: ArgonChannel;
  Users: Map<Guid, IRealtimeChannelUser>;
  isRecordingActive: boolean;
}

/**
 * Store for managing realtime channel states
 */
export const useRealtimeStore = defineStore("realtime", () => {
  const realtimeChannels = reactive(
    new Map<Guid, Reactive<IRealtimeChannel>>()
  );

  // Voice flags (ChannelMemberState) that arrived before the member did. The server sends a
  // joiner's restriction right after JoinedToChannelUser, and that handler still has a user to
  // load before it can add the row, so the flags would otherwise land on nobody.
  const pendingVoiceStates = new Map<string, number>();
  const pendingKey = (channelId: Guid, userId: Guid) => `${channelId}:${userId}`;

  // Seamless account switch: clear all live voice-channel state.
  onSessionReset(() => {
    realtimeChannels.clear();
    pendingVoiceStates.clear();
  });

  /**
   * Create default realtime channel user
   */
  const createRealtimeChannelUser = (
    userId: Guid,
    user: RealtimeUser,
    state = 0
  ): IRealtimeChannelUser => ({
    state,
    userId,
    User: user,
    isSpeaking: false,
    isMuted: false,
    isScreenShare: false,
    volume: [100],
    isRecording: false,
  });

  /**
   * Create or update realtime channel
   */
  const initRealtimeChannel = (
    channel: ArgonChannel,
    users?: Map<Guid, IRealtimeChannelUser>
  ) => {
    realtimeChannels.set(
      channel.channelId,
      reactive({
        Channel: channel,
        Users: users ?? new Map<Guid, IRealtimeChannelUser>(),
        isRecordingActive: false,
      }) as Reactive<IRealtimeChannel>
    );
  };

  /**
   * Replace the channel record of a live channel (a rename, broadcast settings) without touching
   * its members.
   */
  const updateRealtimeChannel = (channel: ArgonChannel) => {
    const existing = realtimeChannels.get(channel.channelId);
    if (existing) existing.Channel = channel;
  };

  /**
   * Remove realtime channel
   */
  const removeRealtimeChannel = (channelId: Guid) => {
    realtimeChannels.delete(channelId);
    for (const key of [...pendingVoiceStates.keys()]) {
      if (key.startsWith(`${channelId}:`)) pendingVoiceStates.delete(key);
    }
  };

  /**
   * Get realtime channel
   */
  const getRealtimeChannel = (channelId: Guid) => {
    return realtimeChannels.get(channelId);
  };

  /**
   * Add user to realtime channel. The voice flags come from `state` when given, else from an
   * event that arrived first, else from the row being replaced — a re-add (a repeated join event,
   * the LiveKit reconciliation) must not wipe a server mute.
   */
  const addUserToChannel = (
    channelId: Guid,
    userId: Guid,
    user: RealtimeUser,
    state?: number
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    const key = pendingKey(channelId, userId);
    const pending = pendingVoiceStates.get(key);
    pendingVoiceStates.delete(key);
    const resolved = state ?? pending ?? channel.Users.get(userId)?.state ?? 0;

    channel.Users.set(userId, createRealtimeChannelUser(userId, user, resolved));
  };

  /**
   * Remove user from realtime channel
   */
  const removeUserFromChannel = (channelId: Guid, userId: Guid) => {
    pendingVoiceStates.delete(pendingKey(channelId, userId));
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    channel.Users.delete(userId);
  };

  /**
   * A member's voice flags (VoiceMemberStateChanged). Kept for later when the member is not in
   * the roster yet; see pendingVoiceStates.
   */
  const setUserVoiceState = (channelId: Guid, userId: Guid, state: number) => {
    const existing = realtimeChannels.get(channelId)?.Users.get(userId);
    if (existing) {
      existing.state = state;
      return;
    }
    pendingVoiceStates.set(pendingKey(channelId, userId), state);
  };

  /**
   * Moderation bits for a member wherever they sit in the space, from a SetMemberVoiceModeration
   * reply. The event that follows carries the same thing; this only saves the moderator the wait.
   */
  const setUserServerVoiceState = (
    spaceId: Guid,
    userId: Guid,
    muted: boolean,
    deafened: boolean
  ) => {
    for (const channel of realtimeChannels.values()) {
      if (channel.Channel.spaceId !== spaceId) continue;
      const existing = channel.Users.get(userId);
      if (existing) existing.state = withServerVoiceState(existing.state, muted, deafened);
    }
  };

  /**
   * Refresh the cached user data (avatar/name/username) for a user across every channel
   * they're sitting in. The voice list renders from this snapshot, so without this it keeps
   * showing the old avatar after a UserUpdated event (other lists read reactive DB rows).
   */
  const updateUserData = (userId: Guid, user: Partial<RealtimeUser>) => {
    for (const channel of realtimeChannels.values()) {
      const existing = channel.Users.get(userId);
      if (existing) Object.assign(existing.User, user);
    }
  };

  /**
   * Set user property in channel
   */
  const setUserProperty = (
    channelId: Guid,
    userId: Guid,
    action: (user: IRealtimeChannelUser) => void
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.warn("Realtime channel not found", channelId);
      return;
    }

    const user = channel.Users.get(userId);
    if (!user) {
      logger.warn("User not found in realtime channel", channelId, userId);
      return;
    }

    action(user);
  };

  /**
   * Set property for all users matching predicate
   */
  const setUserPropertyQuery = (
    channelId: Guid,
    predicate: (user: IRealtimeChannelUser) => boolean,
    action: (user: IRealtimeChannelUser) => void
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.warn("Realtime channel not found", channelId);
      return;
    }

    for (const user of channel.Users.values()) {
      try {
        if (predicate(user)) {
          action(user);
        }
      } catch (err) {
        logger.error("Error during predicate/action execution", err);
      }
    }
  };

  /**
   * Set Speaking status for user
   */
  const setUserSpeaking = (
    channelId: Guid,
    userId: Guid,
    isSpeaking: boolean
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) return;
    const user = channel.Users.get(userId);
    if (user) user.isSpeaking = isSpeaking;
  };

  /**
   * Set Muted status for user
   */
  const setUserMuted = (channelId: Guid, userId: Guid, isMuted: boolean) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) return;
    const user = channel.Users.get(userId);
    if (user) user.isMuted = isMuted;
  };

  /**
   * Set ScreenShare status for user
   */
  const setUserScreenShare = (
    channelId: Guid,
    userId: Guid,
    isScreenShare: boolean
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) return;
    const user = channel.Users.get(userId);
    if (user) user.isScreenShare = isScreenShare;
  };

  /**
   * Set volume for user
   */
  const setUserVolume = (channelId: Guid, userId: Guid, volume: number[]) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) return;
    const user = channel.Users.get(userId);
    if (user) user.volume = volume;
  };

  /**
   * Start recording in channel
   */
  const startRecording = (channelId: Guid, byUserId: Guid) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    channel.isRecordingActive = true;

    setUserProperty(channelId, byUserId, (user) => {
      user.isRecording = true;
    });

    logger.warn(`User '${byUserId}' has initiated recording`);
  };

  /**
   * Stop recording in channel
   */
  const stopRecording = (channelId: Guid) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    channel.isRecordingActive = false;

    setUserPropertyQuery(
      channelId,
      (user) => user.isRecording,
      (user) => {
        user.isRecording = false;
      }
    );
  };

  return {
    realtimeChannels,
    initRealtimeChannel,
    updateRealtimeChannel,
    removeRealtimeChannel,
    getRealtimeChannel,
    addUserToChannel,
    removeUserFromChannel,
    setUserVoiceState,
    setUserServerVoiceState,
    updateUserData,
    setUserProperty,
    setUserPropertyQuery,
    setUserSpeaking,
    setUserMuted,
    setUserScreenShare,
    setUserVolume,
    startRecording,
    stopRecording,
  };
});
