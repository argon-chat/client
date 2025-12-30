import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { type Reactive, reactive, ref } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import type { ArgonChannel, RealtimeChannelUser } from "@/lib/glue/argonChat";
import type { RealtimeUser } from "./db/dexie";

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
   * Remove realtime channel
   */
  const removeRealtimeChannel = (channelId: Guid) => {
    realtimeChannels.delete(channelId);
  };

  /**
   * Get realtime channel
   */
  const getRealtimeChannel = (channelId: Guid) => {
    return realtimeChannels.get(channelId);
  };

  /**
   * Add user to realtime channel
   */
  const addUserToChannel = (
    channelId: Guid,
    userId: Guid,
    user: RealtimeUser
  ) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    channel.Users.set(userId, {
      state: 0,
      userId,
      User: user,
      isSpeaking: false,
      isMuted: false,
      isScreenShare: false,
      volume: [100],
      isRecording: false,
    });
  };

  /**
   * Remove user from realtime channel
   */
  const removeUserFromChannel = (channelId: Guid, userId: Guid) => {
    const channel = realtimeChannels.get(channelId);
    if (!channel) {
      logger.error("Realtime channel not found", channelId);
      return;
    }

    channel.Users.delete(userId);
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
    setUserProperty(channelId, userId, (user) => {
      user.isSpeaking = isSpeaking;
    });
  };

  /**
   * Set Muted status for user
   */
  const setUserMuted = (channelId: Guid, userId: Guid, isMuted: boolean) => {
    setUserProperty(channelId, userId, (user) => {
      user.isMuted = isMuted;
    });
  };

  /**
   * Set ScreenShare status for user
   */
  const setUserScreenShare = (
    channelId: Guid,
    userId: Guid,
    isScreenShare: boolean
  ) => {
    setUserProperty(channelId, userId, (user) => {
      user.isScreenShare = isScreenShare;
    });
  };

  /**
   * Set volume for user
   */
  const setUserVolume = (channelId: Guid, userId: Guid, volume: number[]) => {
    setUserProperty(channelId, userId, (user) => {
      user.volume = volume;
    });
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
    removeRealtimeChannel,
    getRealtimeChannel,
    addUserToChannel,
    removeUserFromChannel,
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
