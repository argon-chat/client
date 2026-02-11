/**
 * Argon PlayFrame Messages
 * 
 * Concrete message payload definitions for the protocol.
 * Uses pull model - game initiates all requests.
 */

import type { MessageEnvelope, ResponseEnvelope, ProtocolError } from './protocol';
import type {
  EphemeralUser,
  EphemeralSpace,
  GameContext,
  LayoutConfig,
  LayoutState,
  GrantedPermissions,
  Permission,
  AudioState,
  AudioContextRequest,
  InputCapabilities,
  HeartbeatData,
  DiagnosticLog,
  HostCapabilities,
  GameInfo,
  IceServersConfig,
  RtcSignalMessage,
  RtcPeerState,
} from './types';

// ============================================================================
// Lifecycle Messages
// ============================================================================

/**
 * Handshake message sent by the game on load.
 * This is the first message in any session.
 */
export interface HandshakePayload {
  /** Game's expected protocol version */
  protocolVersion: number;
  /** Game information */
  game: GameInfo;
  /** Requested permissions */
  requestedPermissions: Permission[];
  /** Preferred layout configuration */
  preferredLayout: LayoutConfig;
  /** Client user agent */
  userAgent: string;
}

export interface HandshakeAckPayload {
  /** Protocol version to use (negotiated) */
  protocolVersion: number;
  /** Full game context */
  context: GameContext;
  /** Initial layout state */
  layout: LayoutState;
  /** Initial audio state */
  audio: AudioState;
  /** Heartbeat interval in ms (0 = disabled) */
  heartbeatInterval: number;
}

export interface ReadyPayload {
  /** Game is ready to receive input */
  ready: true;
}

export interface PausePayload {
  /** Reason for pause */
  reason: PauseReason;
}

export type PauseReason =
  | 'background'      // Window/tab lost focus
  | 'user-requested'  // User pressed pause
  | 'host-requested'  // Host app requested pause
  | 'error';          // Error occurred

export interface ResumePayload {
  /** Reason for resume */
  reason: 'foreground' | 'user-requested' | 'host-requested';
}

export interface TerminatePayload {
  /** Reason for termination */
  reason: TerminateReason;
  /** Optional message */
  message?: string;
}

export type TerminateReason =
  | 'user-closed'      // User closed the game
  | 'host-closed'      // Host app closed
  | 'timeout'          // Watchdog timeout
  | 'error'            // Fatal error
  | 'kicked'           // User was kicked
  | 'session-ended';   // Game session ended

// ============================================================================
// Context Messages (Pull Model - Game Requests)
// ============================================================================

/**
 * Request the full game context.
 */
export interface GetContextPayload {
  /** Request fields (empty = all) */
  fields?: ('user' | 'space' | 'session' | 'permissions' | 'capabilities')[];
}

export interface GetContextResponse {
  context: Partial<GameContext>;
}

/**
 * Request current user information.
 */
export interface GetUserPayload {
  /** No parameters needed */
}

export interface GetUserResponse {
  user: EphemeralUser;
}

/**
 * Request all participants in the session.
 */
export interface GetParticipantsPayload {
  /** Filter by role */
  role?: 'host' | 'player' | 'spectator' | 'all';
  /** Include disconnected participants */
  includeDisconnected?: boolean;
}

export interface GetParticipantsResponse {
  participants: EphemeralUser[];
  /** Total count (may differ if paginated) */
  totalCount: number;
}

// ============================================================================
// Layout Messages
// ============================================================================

/**
 * Request layout change.
 */
export interface LayoutRequestPayload {
  /** New layout configuration */
  layout: LayoutConfig;
}

export interface LayoutRequestResponse {
  /** Whether the request was accepted */
  accepted: boolean;
  /** Actual layout state after change */
  layout: LayoutState;
}

/**
 * Layout update notification from host (push from host).
 * This is an exception to the pull model - host notifies on resize.
 */
export interface LayoutUpdatePayload {
  /** New layout state */
  layout: LayoutState;
  /** Reason for update */
  reason: 'resize' | 'fullscreen-change' | 'orientation-change' | 'safe-area-change';
}

/**
 * Request fullscreen toggle.
 */
export interface ResizeRequestPayload {
  /** Request fullscreen */
  fullscreen?: boolean;
  /** Request specific size (for fixed-size mode) */
  size?: { width: number; height: number };
}

export interface ResizeRequestResponse {
  /** Whether the request was accepted */
  accepted: boolean;
  /** Actual layout state */
  layout: LayoutState;
}

// ============================================================================
// Input Messages
// ============================================================================

/**
 * Request input capabilities.
 */
export interface InputCapabilitiesPayload {
  /** No parameters */
}

export interface InputCapabilitiesResponse {
  capabilities: InputCapabilities;
}

/**
 * Request pointer lock.
 */
export interface PointerLockRequestPayload {
  /** Request to enable/disable pointer lock */
  enable: boolean;
}

export interface PointerLockResponse {
  /** Whether pointer lock was granted/released */
  success: boolean;
  /** Current state */
  locked: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Request keyboard focus.
 */
export interface KeyboardFocusRequestPayload {
  /** Request to capture keyboard */
  capture: boolean;
  /** Keys to intercept (empty = all non-blocked) */
  interceptKeys?: string[];
}

export interface KeyboardFocusResponse {
  /** Whether keyboard capture was granted */
  success: boolean;
  /** Blocked keys that won't be forwarded */
  blockedKeys: string[];
}

/**
 * Request gamepad access.
 */
export interface GamepadRequestPayload {
  /** Request to enable gamepad */
  enable: boolean;
  /** Gamepad indices to listen to (empty = all) */
  indices?: number[];
}

export interface GamepadResponse {
  /** Whether gamepad access was granted */
  success: boolean;
  /** Connected gamepads */
  gamepads: InputCapabilities['gamepads'];
}

// ============================================================================
// Audio Messages
// ============================================================================

/**
 * Request audio context.
 */
export interface AudioContextRequestPayload extends AudioContextRequest {
  /** Request audio playback permission */
}

export interface AudioContextResponse {
  /** Whether audio is available */
  available: boolean;
  /** Actual sample rate */
  sampleRate: number;
  /** Current audio state */
  state: AudioState;
}

/**
 * Audio state update from host.
 */
export interface AudioStatePayload {
  state: AudioState;
}

// ============================================================================
// WebRTC / P2P Networking Messages
// ============================================================================

/**
 * Request ICE servers (TURN/STUN credentials) from host.
 */
export interface RtcGetIceServersPayload {
  /** No parameters needed */
}

export interface RtcGetIceServersResponse {
  /** ICE servers configuration */
  config: IceServersConfig;
  /** Whether P2P is available in this session */
  p2pAvailable: boolean;
  /** List of peers available for connection */
  availablePeers: string[];
}

/**
 * Send a signaling message to another peer.
 * The host relays this to the target peer.
 */
export interface RtcSignalPayload {
  /** The signaling message */
  signal: RtcSignalMessage;
}

export interface RtcSignalResponse {
  /** Whether the signal was delivered */
  delivered: boolean;
  /** Error if delivery failed */
  error?: string;
}

/**
 * Peer state update from host (push message).
 * Notifies when peers connect/disconnect or become available.
 */
export interface RtcPeerStatePayload {
  /** Peer state update */
  peer: RtcPeerState;
  /** Event type */
  event: 'joined' | 'left' | 'state-changed';
}

// ============================================================================
// Heartbeat Messages
// ============================================================================

/**
 * Ping from host to game.
 */
export interface PingPayload {
  /** Host timestamp */
  hostTime: number;
  /** Sequence number */
  seq: number;
}

/**
 * Pong response from game to host.
 */
export interface PongPayload {
  /** Echo host timestamp */
  hostTime: number;
  /** Game timestamp */
  gameTime: number;
  /** Sequence number */
  seq: number;
  /** Optional heartbeat data */
  heartbeat?: HeartbeatData;
}

// ============================================================================
// Error & Diagnostic Messages
// ============================================================================

/**
 * Error notification.
 */
export interface ErrorPayload {
  error: ProtocolError;
  /** Whether the error is fatal */
  fatal: boolean;
}

/**
 * Log message from game to host (for debugging).
 */
export interface LogPayload {
  log: DiagnosticLog;
}

// ============================================================================
// Message Type Mapping
// ============================================================================

export interface MessagePayloadMap {
  // Lifecycle
  'handshake': HandshakePayload;
  'handshake-ack': HandshakeAckPayload;
  'ready': ReadyPayload;
  'pause': PausePayload;
  'resume': ResumePayload;
  'terminate': TerminatePayload;
  // Context
  'get-context': GetContextPayload;
  'get-user': GetUserPayload;
  'get-participants': GetParticipantsPayload;
  // Layout
  'layout-request': LayoutRequestPayload;
  'layout-update': LayoutUpdatePayload;
  'resize-request': ResizeRequestPayload;
  // Input
  'input-capabilities': InputCapabilitiesPayload;
  'pointer-lock-request': PointerLockRequestPayload;
  'pointer-lock-response': PointerLockResponse;
  'keyboard-focus-request': KeyboardFocusRequestPayload;
  'gamepad-request': GamepadRequestPayload;
  // Audio
  'audio-context-request': AudioContextRequestPayload;
  'audio-state': AudioStatePayload;
  // Networking
  'rtc-get-ice-servers': RtcGetIceServersPayload;
  'rtc-signal': RtcSignalPayload;
  'rtc-peer-state': RtcPeerStatePayload;
  // Heartbeat
  'ping': PingPayload;
  'pong': PongPayload;
  // Error
  'error': ErrorPayload;
  'log': LogPayload;
}

export interface ResponsePayloadMap {
  'get-context': GetContextResponse;
  'get-user': GetUserResponse;
  'get-participants': GetParticipantsResponse;
  'layout-request': LayoutRequestResponse;
  'resize-request': ResizeRequestResponse;
  'input-capabilities': InputCapabilitiesResponse;
  'pointer-lock-request': PointerLockResponse;
  'keyboard-focus-request': KeyboardFocusResponse;
  'gamepad-request': GamepadResponse;
  'audio-context-request': AudioContextResponse;
  'rtc-get-ice-servers': RtcGetIceServersResponse;
  'rtc-signal': RtcSignalResponse;
}

// ============================================================================
// Typed Message Helpers
// ============================================================================

export type TypedMessage<T extends keyof MessagePayloadMap> = MessageEnvelope<MessagePayloadMap[T]>;
export type TypedResponse<T extends keyof ResponsePayloadMap> = ResponseEnvelope<ResponsePayloadMap[T]>;
