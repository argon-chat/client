// @argon/calls - WebRTC call management with LiveKit

export { createCallManager, type CallManager } from "./CallManager";
export { createSpeakingDetector, type SpeakingDetectorOptions } from "./speakingDetector";
export { parseRtcStats, type ParsedRtcStats } from "./rtcStats";

export type {
  ICallAudioManager,
  ICallApiClient,
  ICallUserPool,
  ICallEventBus,
  ICallTonePlayer,
  ICallSystemState,
  ICallUserVolumeStore,
  ICallCurrentUser,
  CallParticipant,
  RtcDiagnostics,
  ConnectionQuality,
  CallMode,
  CallManagerConfig,
} from "./types";
