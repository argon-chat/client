// @argon/calls - WebRTC call management with LiveKit
// Types for dependency injection

import type { Ref } from "vue";
import type { Subscription } from "rxjs";
import type { RtcEndpoint, CallIncoming, CallFinished, CallAccepted } from "@argon/glue";

/**
 * Audio manager interface - must be provided by the app
 */
export interface ICallAudioManager {
  getCurrentAudioContext(): AudioContext;
  getInputDevice(): Ref<string | null>;
  getOutputDevice(): Ref<string | null>;
  onInputDeviceChanged(cb: (deviceId: string) => void): Subscription;
  createRtcProcessor(): AudioWorkletNode | null;
}

/**
 * API client interface - must be provided by the app
 */
export interface ICallApiClient {
  /** Start a direct call to another user */
  startDirectCall(targetUserId: string): Promise<{
    callId: string;
    token: string;
    rtc: RtcEndpoint;
  } | null>;
  
  /** Accept an incoming call */
  acceptCall(callId: string): Promise<{
    token: string;
    rtc: RtcEndpoint;
  } | null>;
  
  /** Reject an incoming call */
  rejectCall(callId: string): Promise<void>;
  
  /** Join a voice channel */
  joinVoiceChannel(channelId: string): Promise<{
    callId: string;
    token: string;
    rtc: RtcEndpoint;
  } | null>;
  
  /** Leave the current call */
  leaveCall(callId: string): Promise<void>;
}

/**
 * User pool interface for looking up user info
 */
export interface ICallUserPool {
  getUser(userId: string): Promise<{ displayName: string } | null>;
}

/**
 * Event bus interface for server events
 */
export interface ICallEventBus {
  onServerEvent<T>(event: string, handler: (data: T) => void): Subscription;
}

/**
 * Tone player for call sounds
 */
export interface ICallTonePlayer {
  playRingSound(): void;
  stopPlayRingSound(): void;
  playSoftEnterSound(): void;
  playSoftLeaveSound(): void;
}

/**
 * System state interface
 */
export interface ICallSystemState {
  readonly microphoneMuted: boolean;
  readonly headphoneMuted: boolean;
  readonly muteEvent: { subscribe(handler: (muted: boolean) => void): Subscription };
  readonly muteHeadphoneEvent: { subscribe(handler: (muted: boolean) => void): Subscription };
}

/**
 * User volume persistence
 */
export interface ICallUserVolumeStore {
  getUserVolume(userId: string): number;
  setUserVolume(userId: string, volume: number): void;
}

/**
 * Current user info
 */
export interface ICallCurrentUser {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Participant data in a call
 */
export interface CallParticipant {
  userId: string;
  displayName: string;
  muted: boolean;
  mutedAll: boolean;
  screencast: boolean;
  volume: number[];
  gain: GainNode | null;
}

/**
 * RTC diagnostics data
 */
export interface RtcDiagnostics {
  audioPacketsLost: number | null;
  audioJitter: number | null;
  audioBytesReceived: number | null;
  audioLevel: number | null;
  videoPacketsLost: number | null;
  videoJitter: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  rtt: number | null;
  bitrateKbps: number | null;
  transportPacketsSent: number | null;
  transportPacketsReceived: number | null;
  playoutDelay: number | null;
}

/**
 * Connection quality level
 */
export type ConnectionQuality = "excellent" | "good" | "fair" | "poor";

/**
 * Call mode
 */
export type CallMode = "none" | "dm" | "channel";

/**
 * Configuration for creating a call manager
 */
export interface CallManagerConfig {
  audio: ICallAudioManager;
  api: ICallApiClient;
  userPool: ICallUserPool;
  eventBus: ICallEventBus;
  tones: ICallTonePlayer;
  system: ICallSystemState;
  userVolume: ICallUserVolumeStore;
  currentUser: ICallCurrentUser;
  
  /** Optional callback when realtime channel state should be updated */
  onRealtimeUpdate?: (channelId: string, userId: string, update: Partial<{ volume: number[] }>) => void;
}
