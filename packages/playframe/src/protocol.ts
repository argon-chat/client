/**
 * Argon PlayFrame Protocol
 * 
 * Versioned protocol for communication between host and embedded games.
 * Uses a pull-model where the game always initiates requests to the host.
 */

// ============================================================================
// Protocol Versioning
// ============================================================================

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MIN_VERSION = 1;
export const PROTOCOL_MAX_VERSION = 1;

export interface ProtocolVersion {
  major: number;
  minor: number;
  patch: number;
}

export const CURRENT_PROTOCOL: ProtocolVersion = {
  major: 1,
  minor: 0,
  patch: 0,
};

// ============================================================================
// Message Envelope
// ============================================================================

/**
 * Base message envelope for all protocol messages.
 * All messages are wrapped in this envelope for routing and versioning.
 */
export interface MessageEnvelope<T = unknown> {
  /** Protocol identifier */
  protocol: 'argon-playframe';
  /** Protocol version */
  version: number;
  /** Unique message ID for request/response correlation */
  id: string;
  /** Message type discriminator */
  type: MessageType;
  /** Timestamp when message was created */
  timestamp: number;
  /** Actual message payload */
  payload: T;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageType =
  // Lifecycle
  | 'handshake'
  | 'handshake-ack'
  | 'ready'
  | 'pause'
  | 'resume'
  | 'terminate'
  // Identity & Context
  | 'get-context'
  | 'get-user'
  | 'get-participants'
  // Layout
  | 'layout-request'
  | 'layout-update'
  | 'resize-request'
  // Input
  | 'input-capabilities'
  | 'pointer-lock-request'
  | 'pointer-lock-response'
  | 'keyboard-focus-request'
  | 'gamepad-request'
  // Audio
  | 'audio-context-request'
  | 'audio-state'
  // Networking (WebRTC P2P)
  | 'rtc-get-ice-servers'
  | 'rtc-signal'
  | 'rtc-peer-state'
  // Heartbeat & Diagnostics
  | 'ping'
  | 'pong'
  | 'error'
  | 'log';

// ============================================================================
// Response Types
// ============================================================================

export interface ResponseEnvelope<T = unknown> extends MessageEnvelope<T> {
  /** ID of the request this response is for */
  requestId: string;
  /** Whether the request was successful */
  success: boolean;
  /** Error details if success is false */
  error?: ProtocolError;
}

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ErrorCode =
  | 'UNKNOWN_ERROR'
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_VERSION'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NOT_READY'
  | 'INVALID_STATE';

// ============================================================================
// Message ID Generation
// ============================================================================

let messageIdCounter = 0;

export function generateMessageId(): string {
  return `${Date.now().toString(36)}-${(messageIdCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Message Factories
// ============================================================================

export function createMessage<T>(type: MessageType, payload: T): MessageEnvelope<T> {
  return {
    protocol: 'argon-playframe',
    version: PROTOCOL_VERSION,
    id: generateMessageId(),
    type,
    timestamp: Date.now(),
    payload,
  };
}

export function createResponse<T>(
  requestId: string,
  type: MessageType,
  payload: T,
  success = true,
  error?: ProtocolError
): ResponseEnvelope<T> {
  return {
    protocol: 'argon-playframe',
    version: PROTOCOL_VERSION,
    id: generateMessageId(),
    requestId,
    type,
    timestamp: Date.now(),
    payload,
    success,
    error,
  };
}

// ============================================================================
// Message Validation
// ============================================================================

export function isValidMessage(data: unknown): data is MessageEnvelope {
  if (typeof data !== 'object' || data === null) return false;
  
  const msg = data as Record<string, unknown>;
  return (
    msg.protocol === 'argon-playframe' &&
    typeof msg.version === 'number' &&
    typeof msg.id === 'string' &&
    typeof msg.type === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

export function isResponse(msg: MessageEnvelope): msg is ResponseEnvelope {
  return 'requestId' in msg && 'success' in msg;
}

export function isVersionCompatible(version: number): boolean {
  return version >= PROTOCOL_MIN_VERSION && version <= PROTOCOL_MAX_VERSION;
}
