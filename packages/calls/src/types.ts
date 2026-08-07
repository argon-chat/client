// @argon/calls - Injected dependency contracts
//
// Everything the call manager needs from the host application. The package never
// imports app stores directly: that is what keeps it a package rather than a second
// copy of the app's state layer, and it is what makes the call logic testable.

import type { Ref } from "vue";
import type { Subscription } from "rxjs";
import type { CallIncoming, RtcEndpoint } from "@argon/glue";

export type CallMode = "none" | "dm" | "channel";

export interface ScreenShareOpts {
  deviceId: string | null;
  systemAudio: "include" | "exclude";
  width?: number;
  height?: number;
  frameRate?: number;
  maxBitrate?: number;
}

export type AudioDeviceErrorType = "not-found" | "not-readable";

export interface AudioDeviceError {
  type: AudioDeviceErrorType;
  message: string;
}

/** A per-participant playback graph owned by the audio engine. */
export interface RemoteAudioGraph {
  setVolume(volume: number): void;
  dispose(): void;
}

export interface RemoteAudioGraphOptions {
  track: MediaStreamTrack;
  label?: string;
  initialVolume?: number;
  isMutedAll?: boolean;
  onSpeakingChange?: (isSpeaking: boolean) => void;
}

/** Audio engine. Satisfied by @argon/audio's AudioManagement. */
export interface ICallAudioManager {
  getCurrentAudioContext(): AudioContext;
  /** Reference-counted hold on the live microphone, released by releaseInput(). */
  acquireInput(): Promise<MediaStream>;
  releaseInput(): void;
  createRemoteAudioGraph(options: RemoteAudioGraphOptions): RemoteAudioGraph;
  createVirtualVUMeter(onLevel: (level: number) => void): Promise<{ dispose(): void }>;
  onAudioDeviceError(on: (error: AudioDeviceError) => void): Subscription;
}

export interface DingDongResult {
  isSuccessDingDong(): boolean;
  callId: string;
  token: string;
  rtc: RtcEndpoint;
}

export interface PickUpResult {
  isSuccessPickUp(): boolean;
  callId: string;
  token: string;
  rtc: RtcEndpoint;
}

export interface InterlinkResult {
  isSuccessJoinVoice(): boolean;
  token: string;
  rtc: RtcEndpoint;
}

export interface ICallApiClient {
  callInteraction: {
    DingDongCreep(peerUserId: string): Promise<DingDongResult | null>;
    PickUpCall(callId: string): Promise<PickUpResult | null>;
    RejectCall(callId: string): Promise<unknown>;
  };
  channelInteraction: {
    Interlink(spaceId: string, channelId: string): Promise<InterlinkResult | null>;
  };
  serverInteraction: {
    PrefetchUser(spaceId: string, userId: string): Promise<unknown>;
  };
}

export interface ICallUserPool {
  readonly selectedServer: string | null;
  getUser(userId: string): Promise<{ displayName?: string } | null | undefined>;
  trackUser(user: unknown): Promise<unknown>;
  readonly _realtimeStore: {
    addUserToChannel(channelId: string, userId: string, user: unknown): void;
    removeUserFromChannel(channelId: string, userId: string): void;
  };
}

export interface ICallRealtimeStore {
  getRealtimeChannel(channelId: string): { Channel: { spaceId: string }; Users: Map<string, unknown> } | null | undefined;
  addUserToChannel(channelId: string, userId: string, user: unknown): void;
  removeUserFromChannel(channelId: string, userId: string): void;
  setUserProperty(channelId: string, userId: string, mutate: (user: any) => void): void;
}

export interface ICallEventBus {
  // The handler is deliberately loose: hosts type their bus against their own event
  // union, and pinning it here would make every real implementation unassignable.
  // The return value must be unsubscribable so dispose() can let the bus go.
  onServerEvent<T = unknown>(event: string, handler: (data: any) => void): { unsubscribe(): void };
}

export interface ICallTonePlayer {
  playRingSound(): void;
  stopPlayRingSound(): void;
  playSoftEnterSound(): void;
  playSoftLeaveSound(): void;
}

/** Local mute state, owned by the app so the tray and hotkeys can drive it too. */
export interface ICallSystemState {
  readonly microphoneMuted: boolean;
  readonly headphoneMuted: boolean;
  muteEvent: { subscribe(next: (muted: boolean) => void): Subscription };
  muteHeadphoneEvent: { subscribe(next: (muted: boolean) => void): Subscription };
}

export interface ICallUserVolumeStore {
  getUserVolume(userId: string): number;
  setUserVolume(userId: string, volume: number): void;
}

export interface ICallPermissions {
  has(permission: string): boolean;
}

export interface ICallCurrentUser {
  readonly me: { userId: string } | null | undefined;
}

/** The slice of user preferences that affects a call. Written back on device switch. */
export interface ICallPreferences {
  adaptiveVideoQuality: boolean;
  defaultVideoDevice: string;
}

/** Screencast drawing sessions; a no-op implementation is fine. */
export interface ICallDrawingSession {
  beginStreamerSession(sourceId: string | null): void;
  endStreamerSession(): void;
}

export interface CallManagerConfig {
  audio: ICallAudioManager;
  api: ICallApiClient;
  pool: ICallUserPool;
  tone: ICallTonePlayer;
  me: ICallCurrentUser;
  bus: ICallEventBus;
  sys: ICallSystemState;
  userVolume: ICallUserVolumeStore;
  realtimeStore: ICallRealtimeStore;
  pex: ICallPermissions;
  preference: ICallPreferences;
  drawing: ICallDrawingSession;

  /**
   * Storage that survives a renderer reload; used to rejoin voice after a crash.
   * Narrowed to strings — that is all the manager stores, and a generic signature
   * cannot be satisfied by implementations that map the type per value kind.
   */
  persistedValue(key: string, initial: string): Ref<string>;
  /** Ask the OS for capture permission before touching a device (no-op on the web). */
  ensureMediaPermission(kind: "microphone" | "camera"): Promise<unknown>;
  /** True exactly once after a renderer crash, so voice can be rejoined automatically. */
  consumeCrashRecovery(): Promise<boolean>;
  /**
   * Pre-select the screen-share source for the next getDisplayMedia call. On the
   * desktop host this hands the id to the main process; elsewhere it does nothing and
   * the browser's own picker is used.
   */
  selectScreenSource(sourceId: string, includeAudio: boolean): Promise<void>;
}

export type { CallIncoming };
