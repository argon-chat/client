/**
 * Argon PlayFrame Types
 * 
 * Core type definitions for users, spaces, layout, and permissions.
 */

// ============================================================================
// User Types
// ============================================================================

/**
 * Ephemeral user identity.
 * IDs are session-scoped and do not expose real user IDs to games.
 */
export interface EphemeralUser {
  /** Ephemeral user ID (session-scoped, not the real user ID) */
  ephemeralId: string;
  /** Display name (may be anonymized based on privacy settings) */
  displayName: string;
  /** Avatar URL (proxied through Argon CDN for privacy) */
  avatarUrl: string | null;
  /** User's role in the current session */
  role: ParticipantRole;
  /** User's current state */
  state: ParticipantState;
  /** Custom game-specific data set by the game */
  gameData?: Record<string, unknown>;
}

export type ParticipantRole = 
  | 'host'      // Session creator/owner
  | 'player'    // Active participant
  | 'spectator' // View-only participant
  | 'pending';  // Waiting to join

export type ParticipantState =
  | 'active'
  | 'idle'
  | 'disconnected';

// ============================================================================
// Space/Room Types
// ============================================================================

/**
 * Ephemeral space identity.
 * Represents the room/channel where the game is running.
 */
export interface EphemeralSpace {
  /** Ephemeral space ID (session-scoped) */
  ephemeralId: string;
  /** Space display name */
  name: string;
  /** Type of space (voice channel, text channel, DM, etc.) */
  type: SpaceType;
  /** Maximum number of participants allowed */
  maxParticipants: number;
  /** Current participant count */
  participantCount: number;
  /** Whether the space is private */
  isPrivate: boolean;
}

export type SpaceType =
  | 'voice-channel'
  | 'text-channel'
  | 'dm'
  | 'group-dm';

// ============================================================================
// Game Session Context
// ============================================================================

/**
 * Full context provided to the game on initialization.
 */
export interface GameContext {
  /** Current protocol version */
  protocolVersion: number;
  /** Game manifest information */
  game: GameInfo;
  /** Current user (the local player) */
  user: EphemeralUser;
  /** Space where the game is running */
  space: EphemeralSpace;
  /** Session-specific information */
  session: SessionInfo;
  /** Granted permissions */
  permissions: GrantedPermissions;
  /** Host capabilities */
  capabilities: HostCapabilities;
}

export interface GameInfo {
  /** Game ID as registered in Argon */
  id: string;
  /** Game version */
  version: string;
  /** Game title */
  title: string;
  /** Game description */
  description?: string;
  /** Game developer name */
  developer?: string;
  /** Game icon URL */
  icon?: string;
}

export interface SessionInfo {
  /** Unique session ID */
  sessionId: string;
  /** When the session started */
  startedAt: number;
  /** Session state */
  state: SessionState;
}

export type SessionState =
  | 'initializing'
  | 'lobby'
  | 'playing'
  | 'paused'
  | 'ended';

// ============================================================================ 
// Layout Types
// ============================================================================

export interface LayoutConfig {
  /** Layout mode */
  mode: LayoutMode;
  /** Aspect ratio for fixed mode */
  aspectRatio?: AspectRatio;
  /** Minimum dimensions */
  minSize?: Dimensions;
  /** Maximum dimensions */
  maxSize?: Dimensions;
  /** Preferred dimensions (for responsive mode) */
  preferredSize?: Dimensions;
  /** Whether to maintain pixel-perfect scaling */
  pixelPerfect?: boolean;
  /** Background color outside the game area */
  backgroundColor?: string;
}

export type LayoutMode =
  | 'fixed-aspect'   // Host maintains aspect ratio (letterboxing)
  | 'responsive'     // Game adapts to any size
  | 'fixed-size';    // Game requests specific size

export interface AspectRatio {
  width: number;   // e.g., 16
  height: number;  // e.g., 9
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface LayoutState {
  /** Current viewport dimensions */
  viewport: Dimensions;
  /** Actual game area dimensions */
  gameArea: Dimensions;
  /** Device pixel ratio */
  devicePixelRatio: number;
  /** Safe area insets (for notched devices) */
  safeAreaInsets: Insets;
  /** Whether the game is in fullscreen */
  isFullscreen: boolean;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Permissions that a game can request.
 * The host decides what to grant based on user preferences and security policy.
 */
export type Permission =
  | 'pointer-lock'      // Pointer lock API
  | 'gamepad'           // Gamepad API
  | 'keyboard'          // Full keyboard input
  | 'audio'             // Audio output
  | 'microphone'        // Microphone input (rare, needs user consent)
  | 'clipboard-read'    // Read clipboard
  | 'clipboard-write'   // Write clipboard
  | 'storage'           // Local storage access
  | 'fullscreen'        // Fullscreen API
  | 'networking';       // WebRTC P2P networking

export interface GrantedPermissions {
  /** List of granted permissions */
  granted: Permission[];
  /** List of denied permissions */
  denied: Permission[];
  /** Whether the game can request more permissions later */
  canRequestMore: boolean;
}

export interface PermissionRequest {
  /** Permission being requested */
  permission: Permission;
  /** Why the game needs this permission */
  reason?: string;
}

// ============================================================================
// Host Capabilities
// ============================================================================

/**
 * Capabilities that the host provides.
 * Games should adapt their behavior based on these.
 */
export interface HostCapabilities {
  /** Supported input types */
  inputTypes: InputType[];
  /** Whether audio is available */
  audioAvailable: boolean;
  /** Whether fullscreen is available */
  fullscreenAvailable: boolean;
  /** Whether pointer lock is available */
  pointerLockAvailable: boolean;
  /** Whether gamepad is available */
  gamepadAvailable: boolean;
  /** Maximum FPS allowed */
  maxFps: number;
  /** Whether the host is in dev mode */
  devMode: boolean;
}

export type InputType =
  | 'mouse'
  | 'touch'
  | 'keyboard'
  | 'gamepad';

// ============================================================================
// Audio Types
// ============================================================================

export interface AudioState {
  /** Whether audio is enabled */
  enabled: boolean;
  /** Master volume (0-1) */
  masterVolume: number;
  /** Whether the game is muted */
  muted: boolean;
  /** Whether the tab/window is visible */
  visible: boolean;
}

export interface AudioContextRequest {
  /** Requested sample rate */
  sampleRate?: number;
  /** Requested latency hint */
  latencyHint?: 'interactive' | 'balanced' | 'playback';
}

// ============================================================================
// Input Types
// ============================================================================

export interface InputCapabilities {
  /** Available input types */
  available: InputType[];
  /** Currently active input types */
  active: InputType[];
  /** Connected gamepads */
  gamepads: GamepadInfo[];
}

export interface GamepadInfo {
  /** Gamepad index */
  index: number;
  /** Gamepad ID string */
  id: string;
  /** Number of buttons */
  buttons: number;
  /** Number of axes */
  axes: number;
}

/**
 * Keyboard keys that are blocked by the host.
 * Games will not receive events for these keys.
 */
export const BLOCKED_KEYS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PrintScreen', 'ScrollLock', 'Pause',
] as const;

/**
 * Key combinations blocked by the host.
 */
export const BLOCKED_COMBINATIONS = [
  { key: 'w', ctrl: true },  // Close tab
  { key: 't', ctrl: true },  // New tab
  { key: 'n', ctrl: true },  // New window
  { key: 'Tab', alt: true }, // Switch window
  { key: 'F4', alt: true },  // Close window
] as const;

// ============================================================================
// Heartbeat & Diagnostics
// ============================================================================

export interface HeartbeatData {
  /** Client timestamp */
  clientTime: number;
  /** Current FPS */
  fps?: number;
  /** Memory usage in MB */
  memoryUsage?: number;
  /** Custom metrics */
  metrics?: Record<string, number>;
}

export interface DiagnosticLog {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Log message */
  message: string;
  /** Additional data */
  data?: Record<string, unknown>;
  /** Stack trace for errors */
  stack?: string;
}

// ============================================================================
// WebRTC / P2P Networking
// ============================================================================

/**
 * ICE server configuration for WebRTC.
 * Provided by the host with TURN credentials.
 */
export interface IceServer {
  /** Server URLs (stun: or turn:) */
  urls: string | string[];
  /** Username for TURN authentication */
  username?: string;
  /** Credential for TURN authentication */
  credential?: string;
  /** Credential type */
  credentialType?: 'password' | 'oauth';
}

/**
 * ICE servers response with TTL.
 */
export interface IceServersConfig {
  /** List of ICE servers */
  iceServers: IceServer[];
  /** Time-to-live in seconds (credentials expire after this) */
  ttl: number;
  /** Timestamp when credentials were issued */
  issuedAt: number;
}

/**
 * WebRTC signaling message types.
 */
export type RtcSignalType = 'offer' | 'answer' | 'ice-candidate';

/**
 * WebRTC signaling message.
 * Used to exchange SDP offers/answers and ICE candidates.
 */
export interface RtcSignalMessage {
  /** Signal type */
  type: RtcSignalType;
  /** Target peer ephemeral ID */
  targetPeerId: string;
  /** Source peer ephemeral ID (filled by host) */
  sourcePeerId?: string;
  /** SDP offer or answer */
  sdp?: string;
  /** ICE candidate */
  candidate?: RtcIceCandidate;
}

/**
 * ICE candidate for WebRTC.
 */
export interface RtcIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string;
}

/**
 * Peer connection state.
 */
export type RtcPeerConnectionState = 
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/**
 * Peer state update from host.
 */
export interface RtcPeerState {
  /** Peer ephemeral ID */
  peerId: string;
  /** Connection state */
  state: RtcPeerConnectionState;
  /** Whether the peer is available for P2P */
  available: boolean;
}

/**
 * Data channel configuration.
 */
export interface RtcDataChannelConfig {
  /** Channel label */
  label: string;
  /** Ordered delivery */
  ordered?: boolean;
  /** Max retransmits (for unreliable) */
  maxRetransmits?: number;
  /** Max packet lifetime in ms (for unreliable) */
  maxPacketLifeTime?: number;
  /** Protocol */
  protocol?: string;
}

/**
 * Default data channel configurations for common use cases.
 */
export const RTC_CHANNEL_PRESETS = {
  /** Reliable ordered channel for game state */
  reliable: {
    label: 'reliable',
    ordered: true,
  } as RtcDataChannelConfig,
  /** Unreliable channel for fast updates (positions, etc.) */
  unreliable: {
    label: 'unreliable',
    ordered: false,
    maxRetransmits: 0,
  } as RtcDataChannelConfig,
  /** Semi-reliable for important but time-sensitive data */
  semiReliable: {
    label: 'semi-reliable',
    ordered: true,
    maxRetransmits: 3,
  } as RtcDataChannelConfig,
} as const;
