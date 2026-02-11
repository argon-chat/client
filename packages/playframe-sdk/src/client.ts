/**
 * Argon PlayFrame SDK Client
 * 
 * Main client class for games to communicate with the PlayFrame host.
 * Uses a pull-model where the game initiates all requests.
 */

import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
  type ResponseEnvelope,
  type MessageType,
  type ProtocolError,
  createMessage,
  isValidMessage,
  isResponse,
  isVersionCompatible,
  type GameContext,
  type EphemeralUser,
  type EphemeralSpace,
  type LayoutConfig,
  type LayoutState,
  type AudioState,
  type InputCapabilities,
  type HostCapabilities,
  type Permission,
  type GrantedPermissions,
  type GameInfo,
  type HeartbeatData,
  type DiagnosticLog,
  type HandshakePayload,
  type HandshakeAckPayload,
  type GetContextResponse,
  type GetUserResponse,
  type GetParticipantsResponse,
  type LayoutRequestResponse,
  type ResizeRequestResponse,
  type InputCapabilitiesResponse,
  type PointerLockResponse,
  type KeyboardFocusResponse,
  type GamepadResponse,
  type AudioContextResponse,
  type PingPayload,
  type PauseReason,
  type TerminateReason,
  type LayoutUpdatePayload,
  type AudioStatePayload,
  // WebRTC
  type IceServersConfig,
  type RtcSignalMessage,
  type RtcPeerState,
  type RtcGetIceServersResponse,
  type RtcSignalResponse,
  RequestTracker,
  EventEmitter,
  PLAYFRAME_PROTOCOL_ID,
  REQUEST_TIMEOUT,
  HANDSHAKE_TIMEOUT,
} from '@argon/playframe';

// ============================================================================
// SDK Events
// ============================================================================

export interface PlayFrameClientEvents {
  /** Connection established with host */
  connected: GameContext;
  /** Connection lost */
  disconnected: { reason: string };
  /** Game paused */
  pause: { reason: PauseReason };
  /** Game resumed */
  resume: void;
  /** Game terminated */
  terminate: { reason: TerminateReason; message?: string };
  /** Layout changed */
  layoutUpdate: LayoutUpdatePayload;
  /** Audio state changed */
  audioStateUpdate: AudioState;
  /** Participant joined */
  participantJoin: EphemeralUser;
  /** Participant left */
  participantLeave: { ephemeralId: string };
  /** Participant updated */
  participantUpdate: EphemeralUser;
  /** WebRTC signal received from peer */
  rtcSignal: { from: string; signal: RtcSignalMessage };
  /** Peer connection state changed */
  rtcPeerState: RtcPeerState;
  /** Error occurred */
  error: { error: ProtocolError; fatal: boolean };
  /** Ping received (for latency measurement) */
  ping: { hostTime: number; seq: number };
}

// ============================================================================
// SDK Configuration
// ============================================================================

export interface PlayFrameClientConfig {
  /** Game information */
  game: GameInfo;
  /** Requested permissions */
  permissions?: Permission[];
  /** Preferred layout configuration */
  layout?: LayoutConfig;
  /** Request timeout in ms */
  requestTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// SDK State
// ============================================================================

export type ClientState = 
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'paused'
  | 'terminated';

// ============================================================================
// PlayFrame Client
// ============================================================================

/**
 * Main SDK client for PlayFrame games.
 * 
 * @example
 * ```typescript
 * const client = new PlayFrameClient({
 *   game: { id: 'my-game', version: '1.0.0', title: 'My Game' },
 *   permissions: ['keyboard', 'audio'],
 *   layout: { mode: 'fixed-aspect', aspectRatio: { width: 16, height: 9 } },
 * });
 * 
 * await client.connect();
 * 
 * // Get user info
 * const user = await client.getUser();
 * 
 * // Request pointer lock
 * await client.requestPointerLock(true);
 * 
 * // Listen for events
 * client.on('pause', () => {
 *   // Handle pause
 * });
 * ```
 */
export class PlayFrameClient extends EventEmitter<PlayFrameClientEvents> {
  private config: Required<PlayFrameClientConfig>;
  private state: ClientState = 'disconnected';
  private context: GameContext | null = null;
  private requests: RequestTracker;
  private hostOrigin: string | null = null;
  private heartbeatInterval: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor(config: PlayFrameClientConfig) {
    super();

    this.config = {
      game: config.game,
      permissions: config.permissions ?? [],
      layout: config.layout ?? { mode: 'responsive' },
      requestTimeout: config.requestTimeout ?? REQUEST_TIMEOUT,
      debug: config.debug ?? false,
    };

    this.requests = new RequestTracker(this.config.requestTimeout);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to the PlayFrame host.
   * This initiates the handshake process.
   */
  async connect(): Promise<GameContext> {
    if (this.state !== 'disconnected') {
      throw new Error(`Cannot connect: client is ${this.state}`);
    }

    this.state = 'connecting';
    this.setupMessageListener();

    // Wait for host to be ready (it may take a moment to set up)
    await this.waitForHost();

    this.state = 'handshaking';

    // Send handshake
    const handshakePayload: HandshakePayload = {
      protocolVersion: PROTOCOL_VERSION,
      game: this.config.game,
      requestedPermissions: this.config.permissions,
      preferredLayout: this.config.layout,
      userAgent: navigator.userAgent,
    };

    const response = await this.request<HandshakeAckPayload>(
      'handshake',
      handshakePayload,
      HANDSHAKE_TIMEOUT
    );

    // Validate protocol version
    if (!isVersionCompatible(response.protocolVersion)) {
      throw new Error(`Incompatible protocol version: ${response.protocolVersion}`);
    }

    this.context = response.context;
    this.heartbeatInterval = response.heartbeatInterval;

    // Start heartbeat if enabled
    if (this.heartbeatInterval && this.heartbeatInterval > 0) {
      this.startHeartbeat();
    }

    this.state = 'connected';
    this.emit('connected', this.context);

    // Signal ready
    this.send('ready', { ready: true });

    return this.context;
  }

  /**
   * Disconnect from the PlayFrame host.
   */
  disconnect(): void {
    if (this.state === 'disconnected' || this.state === 'terminated') {
      return;
    }

    this.cleanup();
    this.state = 'disconnected';
    this.emit('disconnected', { reason: 'client-disconnected' });
  }

  /**
   * Get the current client state.
   */
  getState(): ClientState {
    return this.state;
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.state === 'connected' || this.state === 'paused';
  }

  // ==========================================================================
  // Context API
  // ==========================================================================

  /**
   * Get the cached game context.
   */
  getContext(): GameContext | null {
    return this.context;
  }

  /**
   * Refresh the full game context from the host.
   */
  async refreshContext(): Promise<GameContext> {
    this.ensureConnected();
    const response = await this.request<GetContextResponse>('get-context', {});
    this.context = { ...this.context, ...response.context } as GameContext;
    return this.context;
  }

  /**
   * Get current user information.
   */
  async getUser(): Promise<EphemeralUser> {
    this.ensureConnected();
    const response = await this.request<GetUserResponse>('get-user', {});
    return response.user;
  }

  /**
   * Get all participants in the session.
   */
  async getParticipants(options?: {
    role?: 'host' | 'player' | 'spectator' | 'all';
    includeDisconnected?: boolean;
  }): Promise<{ participants: EphemeralUser[]; totalCount: number }> {
    this.ensureConnected();
    const response = await this.request<GetParticipantsResponse>('get-participants', {
      role: options?.role,
      includeDisconnected: options?.includeDisconnected,
    });
    return response;
  }

  /**
   * Get the ephemeral space (room) information.
   */
  getSpace(): EphemeralSpace | null {
    return this.context?.space ?? null;
  }

  /**
   * Get granted permissions.
   */
  getPermissions(): GrantedPermissions | null {
    return this.context?.permissions ?? null;
  }

  /**
   * Get host capabilities.
   */
  getCapabilities(): HostCapabilities | null {
    return this.context?.capabilities ?? null;
  }

  // ==========================================================================
  // Layout API
  // ==========================================================================

  /**
   * Request a layout change.
   */
  async requestLayout(layout: LayoutConfig): Promise<LayoutState> {
    this.ensureConnected();
    const response = await this.request<LayoutRequestResponse>('layout-request', { layout });
    
    if (!response.accepted) {
      this.log('warn', 'Layout request not accepted');
    }
    
    return response.layout;
  }

  /**
   * Request fullscreen mode.
   */
  async requestFullscreen(enable: boolean): Promise<LayoutState> {
    this.ensureConnected();
    const response = await this.request<ResizeRequestResponse>('resize-request', {
      fullscreen: enable,
    });
    
    if (!response.accepted) {
      this.log('warn', 'Fullscreen request not accepted');
    }
    
    return response.layout;
  }

  /**
   * Request a specific size (for fixed-size mode).
   */
  async requestSize(width: number, height: number): Promise<LayoutState> {
    this.ensureConnected();
    const response = await this.request<ResizeRequestResponse>('resize-request', {
      size: { width, height },
    });
    
    if (!response.accepted) {
      this.log('warn', 'Size request not accepted');
    }
    
    return response.layout;
  }

  /**
   * Get current layout state.
   */
  getCurrentLayout(): LayoutState | null {
    // Would need to be tracked from layout-update events
    return null;
  }

  // ==========================================================================
  // Input API
  // ==========================================================================

  /**
   * Get input capabilities.
   */
  async getInputCapabilities(): Promise<InputCapabilities> {
    this.ensureConnected();
    const response = await this.request<InputCapabilitiesResponse>('input-capabilities', {});
    return response.capabilities;
  }

  /**
   * Request pointer lock.
   */
  async requestPointerLock(enable: boolean): Promise<boolean> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('pointer-lock')) {
      this.log('warn', 'Pointer lock permission not granted');
      return false;
    }
    
    const response = await this.request<PointerLockResponse>('pointer-lock-request', { enable });
    return response.success;
  }

  /**
   * Request keyboard focus/capture.
   */
  async requestKeyboardFocus(
    capture: boolean,
    interceptKeys?: string[]
  ): Promise<{ success: boolean; blockedKeys: string[] }> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('keyboard')) {
      this.log('warn', 'Keyboard permission not granted');
      return { success: false, blockedKeys: [] };
    }
    
    const response = await this.request<KeyboardFocusResponse>('keyboard-focus-request', {
      capture,
      interceptKeys,
    });
    return response;
  }

  /**
   * Request gamepad access.
   */
  async requestGamepad(enable: boolean, indices?: number[]): Promise<boolean> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('gamepad')) {
      this.log('warn', 'Gamepad permission not granted');
      return false;
    }
    
    const response = await this.request<GamepadResponse>('gamepad-request', {
      enable,
      indices,
    });
    return response.success;
  }

  // ==========================================================================
  // Audio API
  // ==========================================================================

  /**
   * Request audio context.
   */
  async requestAudioContext(options?: {
    sampleRate?: number;
    latencyHint?: 'interactive' | 'balanced' | 'playback';
  }): Promise<AudioContextResponse> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('audio')) {
      this.log('warn', 'Audio permission not granted');
      return {
        available: false,
        sampleRate: 0,
        state: { enabled: false, masterVolume: 0, muted: true, visible: false },
      };
    }
    
    return this.request<AudioContextResponse>('audio-context-request', {
      sampleRate: options?.sampleRate,
      latencyHint: options?.latencyHint,
    });
  }

  // ==========================================================================
  // WebRTC P2P API
  // ==========================================================================

  /**
   * Get ICE servers configuration for WebRTC.
   * Host provides TURN/STUN credentials for NAT traversal.
   */
  async getIceServers(): Promise<IceServersConfig> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('networking')) {
      this.log('warn', 'Networking permission not granted');
      return { iceServers: [], ttl: 0, issuedAt: Date.now() };
    }
    
    const response = await this.request<RtcGetIceServersResponse>('rtc-get-ice-servers', {});
    return response.config;
  }

  /**
   * Send a WebRTC signaling message to a peer.
   * The host relays the message to the target peer's game instance.
   * 
   * @param to Target peer's ephemeral ID
   * @param signal SDP offer/answer or ICE candidate (without targetPeerId)
   */
  async sendSignal(to: string, signal: Omit<RtcSignalMessage, 'targetPeerId'>): Promise<boolean> {
    this.ensureConnected();
    
    if (!this.context?.permissions.granted.includes('networking')) {
      this.log('warn', 'Networking permission not granted');
      return false;
    }
    
    const fullSignal: RtcSignalMessage = {
      ...signal,
      targetPeerId: to,
    };
    
    const response = await this.request<RtcSignalResponse>('rtc-signal', {
      signal: fullSignal,
    });
    
    return response.delivered;
  }

  /**
   * Broadcast peer connection state to the host.
   * Host may use this to track connection quality.
   */
  reportPeerState(peerId: string, state: RtcPeerState, event: 'joined' | 'left' | 'state-changed' = 'state-changed'): void {
    if (!this.isConnected()) return;
    
    this.send('rtc-peer-state', { peer: state, event });
  }

  // ==========================================================================
  // Diagnostics API
  // ==========================================================================

  /**
   * Send a log message to the host (for debugging).
   */
  log(level: DiagnosticLog['level'], message: string, data?: Record<string, unknown>): void {
    if (!this.isConnected()) return;
    
    const log: DiagnosticLog = {
      level,
      message,
      data,
    };
    
    this.send('log', { log });
    
    if (this.config.debug) {
      const logFn = console[level as keyof Pick<Console, 'debug' | 'info' | 'warn' | 'error'>];
      logFn(`[PlayFrame] ${message}`, data ?? '');
    }
  }

  /**
   * Send custom heartbeat metrics.
   */
  sendMetrics(metrics: Record<string, number>): void {
    // Metrics will be sent with the next heartbeat
    // This is a simplified implementation
    this.log('debug', 'Metrics', metrics);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      // Validate origin (will be set during handshake)
      if (this.hostOrigin && event.origin !== this.hostOrigin) {
        return;
      }

      if (!isValidMessage(event.data)) {
        return;
      }

      const message = event.data;
      
      // Set host origin on first valid message
      if (!this.hostOrigin) {
        this.hostOrigin = event.origin;
      }

      this.handleMessage(message);
    };

    window.addEventListener('message', this.messageHandler);
  }

  private handleMessage(message: MessageEnvelope): void {
    if (this.config.debug) {
      console.debug('[PlayFrame] Received:', message.type, message);
    }

    // Handle responses
    if (isResponse(message)) {
      this.requests.resolve(message.requestId, message);
      return;
    }

    // Handle push messages from host
    switch (message.type) {
      case 'pause':
        this.state = 'paused';
        this.emit('pause', message.payload as { reason: PauseReason });
        break;

      case 'resume':
        this.state = 'connected';
        this.emit('resume', undefined);
        break;

      case 'terminate':
        this.state = 'terminated';
        this.cleanup();
        this.emit('terminate', message.payload as { reason: TerminateReason; message?: string });
        break;

      case 'layout-update':
        this.emit('layoutUpdate', message.payload as LayoutUpdatePayload);
        break;

      case 'audio-state':
        this.emit('audioStateUpdate', (message.payload as AudioStatePayload).state);
        break;

      case 'rtc-signal':
        // Incoming signal from another peer (relayed by host)
        const signalPayload = message.payload as { from: string; signal: RtcSignalMessage };
        this.emit('rtcSignal', signalPayload);
        break;

      case 'rtc-peer-state':
        // Peer state update from host
        const peerStatePayload = message.payload as { state: RtcPeerState };
        this.emit('rtcPeerState', peerStatePayload.state);
        break;

      case 'ping':
        this.handlePing(message.payload as PingPayload);
        break;

      case 'error':
        const errorPayload = message.payload as { error: ProtocolError; fatal: boolean };
        this.emit('error', errorPayload);
        if (errorPayload.fatal) {
          this.state = 'terminated';
          this.cleanup();
        }
        break;

      default:
        if (this.config.debug) {
          console.warn('[PlayFrame] Unknown message type:', message.type);
        }
    }
  }

  private handlePing(payload: PingPayload): void {
    this.emit('ping', payload);
    
    // Send pong response
    this.send('pong', {
      hostTime: payload.hostTime,
      gameTime: Date.now(),
      seq: payload.seq,
    });
  }

  private async waitForHost(): Promise<void> {
    // The host should be ready since we're in an iframe it created
    // But we add a small delay to ensure postMessage is ready
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  private startHeartbeat(): void {
    if (!this.heartbeatInterval || this.heartbeatTimer) return;

    let seq = 0;
    this.heartbeatTimer = setInterval(() => {
      // Heartbeat is initiated by host in this protocol
      // But game can send metrics proactively
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send<T>(type: MessageType, payload: T): void {
    if (!window.parent || window.parent === window) {
      throw new Error('Not running in an iframe');
    }

    const message = createMessage(type, payload);
    
    if (this.config.debug) {
      console.debug('[PlayFrame] Sending:', type, message);
    }

    window.parent.postMessage(message, this.hostOrigin || '*');
  }

  private async request<T>(type: MessageType, payload: unknown, timeout?: number): Promise<T> {
    if (!window.parent || window.parent === window) {
      throw new Error('Not running in an iframe');
    }

    const message = createMessage(type, payload);
    
    if (this.config.debug) {
      console.debug('[PlayFrame] Request:', type, message);
    }

    const promise = this.requests.create<T>(message.id, type, timeout);
    window.parent.postMessage(message, this.hostOrigin || '*');
    
    return promise;
  }

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error(`Client is not connected (state: ${this.state})`);
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.requests.cancelAll('Client disconnected');
    
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    
    this.hostOrigin = null;
    this.context = null;
  }
}
