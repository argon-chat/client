// @argon/calls - WebRTC call management with LiveKit

export { createCallManager, type CallManager } from "./CallManager";
export { parseRtcStats, type ParsedRtcStats } from "./rtcStats";
// Also reachable as "@argon/calls/voice-state", without loading LiveKit.
export {
  VoiceStateBits,
  SELF_VOICE_STATE_MASK,
  decodeVoiceState,
  encodeSelfVoiceState,
  withServerVoiceState,
  type VoiceMemberFlags,
} from "./voiceState";

export type {
  CallManagerConfig,
  CallMode,
  CallNotice,
  ScreenShareOpts,
  RemoteAudioGraph,
  RemoteAudioGraphOptions,
  AudioDeviceError,
  AudioDeviceErrorType,
  ICallAudioManager,
  ICallApiClient,
  ICallUserPool,
  ICallRealtimeStore,
  ICallEventBus,
  ICallTonePlayer,
  ICallSystemState,
  ICallUserVolumeStore,
  ICallPermissions,
  ICallCurrentUser,
  ICallPreferences,
  ICallDrawingSession,
  ICallTelemetry,
  CallTelemetryAttributes,
} from "./types";
