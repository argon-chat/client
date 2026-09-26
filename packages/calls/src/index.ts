// @argon/calls - WebRTC call management with LiveKit

export { createCallManager, type CallManager } from "./CallManager";
export { parseRtcStats, type ParsedRtcStats } from "./rtcStats";
export { createMicHold, type MicHold, type MicHoldOptions } from "./micHold";
export { connectRoom, probeTurn, type ConnectRoomOptions, type TurnProbeSummary } from "./connectRoom";
export { RadioSession, type RadioSessionDeps } from "./radio/RadioSession";
// Also reachable as "@argon/calls/voice-state", without loading LiveKit.
export {
  VoiceStateBits,
  SELF_VOICE_STATE_MASK,
  decodeVoiceState,
  encodeSelfVoiceState,
  withServerVoiceState,
  type VoiceMemberFlags,
} from "./voiceState";
// Also reachable as "@argon/calls/radio-identity", without loading LiveKit.
export {
  RADIO_IDENTITY_PREFIX,
  RADIO_ATTR,
  RADIO_KIND,
  RADIO_ON_AIR,
  isRadioIdentity,
  radioIdentity,
  radioUserId,
} from "./radio/identity";
export {
  initialRadioState,
  type RadioState,
  type RadioSpeaker,
  type RadioUnavailableReason,
} from "./radio/types";

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
