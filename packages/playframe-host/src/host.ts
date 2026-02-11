/**
 * Argon PlayFrame Host Controller
 * 
 * Main class for hosting PlayFrame games.
 * Manages iframe lifecycle, security, input, and communication.
 */

import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
  type ResponseEnvelope,
  type MessageType,
  type ProtocolError,
  type GameContext,
  type EphemeralUser,
  type EphemeralSpace,
  type Permission,
  type GrantedPermissions,
  type HostCapabilities,
  type LayoutConfig,
  type LayoutState,
  type LayoutMode,
  type AspectRatio,
  type Dimensions,
  type AudioState,
  type InputCapabilities,
  type GameInfo,
  type SessionInfo,
  type HandshakePayload,
  type HandshakeAckPayload,
  type PongPayload,
  type PauseReason,
  type TerminateReason,
  // WebRTC
  type IceServer,
  type IceServersConfig,
  type RtcSignalMessage,
  type RtcPeerState,
  type RtcSignalPayload,
  type RtcPeerStatePayload,
  createMessage,
  createResponse,
  isValidMessage,
  isResponse,
  isVersionCompatible,
  EventEmitter,
  calculateAspectFitDimensions,
  clampDimensions,
  shouldBlockKey,
  HANDSHAKE_TIMEOUT,
  DEFAULT_HEARTBEAT_INTERVAL,
  MIN_GAME_SIZE,
  MAX_GAME_SIZE,
  BACKGROUND_FPS_LIMIT,
  DEFAULT_FPS_LIMIT,
} from '@argon/playframe';

import { createGameIframe, type SandboxConfig, type CspConfig } from './sandbox';
import { Watchdog, type WatchdogConfig, type HealthReport } from './watchdog';
import {
  type DevModeConfig,
  DEFAULT_DEV_CONFIG,
  generateMockContext,
  createDebugOverlay,
  createMessageLogger,
  type DebugOverlayData,
} from './devtools';

// ============================================================================
// Host Events
// ============================================================================

export interface PlayFrameHostEvents {
  /** Game finished loading */
  load: void;
  /** Handshake completed */
  ready: GameContext;
  /** Game paused */
  pause: { reason: PauseReason };
  /** Game resumed */
  resume: void;
  /** Game terminated */
  terminate: { reason: TerminateReason; message?: string };
  /** Layout changed */
  layoutChange: LayoutState;
  /** Health report from watchdog */
  healthReport: HealthReport;
  /** Error occurred */
  error: { error: ProtocolError; fatal: boolean };
  /** Participant joined */
  participantJoin: EphemeralUser;
  /** Participant left */
  participantLeave: { ephemeralId: string };
  /** Message received (for debugging) */
  message: { direction: 'in' | 'out'; type: MessageType; payload: unknown };
}

// ============================================================================
// Host Configuration
// ============================================================================

export interface PlayFrameHostConfig {
  /** Game URL to load */
  gameUrl: string;
  /** Container element */
  container: HTMLElement;
  /** Game information (from manifest) */
  game: GameInfo;
  /** Current user */
  user: EphemeralUser;
  /** Current space */
  space: EphemeralSpace;
  /** Session information */
  session: SessionInfo;
  /** Permissions that can be granted */
  availablePermissions?: Permission[];
  /** Permissions to auto-grant on handshake */
  autoGrantPermissions?: Permission[];
  /** Sandbox configuration */
  sandboxConfig?: SandboxConfig;
  /** CSP configuration */
  cspConfig?: CspConfig;
  /** Watchdog configuration */
  watchdogConfig?: Partial<WatchdogConfig>;
  /** Dev mode configuration */
  devConfig?: DevModeConfig;
  /** Layout constraints */
  layoutConstraints?: {
    minSize?: Dimensions;
    maxSize?: Dimensions;
    allowFullscreen?: boolean;
  };
  /** Audio configuration */
  audioConfig?: {
    enabled?: boolean;
    masterVolume?: number;
  };
  /** Heartbeat interval (0 to disable) */
  heartbeatInterval?: number;
  /** Input filtering options */
  inputConfig?: {
    /** Allow pointer lock */
    allowPointerLock?: boolean;
    /** Allow gamepad */
    allowGamepad?: boolean;
    /** Keys to always block (in addition to defaults) */
    blockedKeys?: string[];
    /** Intercept escape key for pause menu */
    interceptEscape?: boolean;
  };
  /** WebRTC P2P configuration */
  rtcConfig?: {
    /** Function to get ICE servers (TURN/STUN) */
    getIceServers?: () => Promise<IceServersConfig>;
    /** Function to relay signals to another peer */
    relaySignal?: (from: string, to: string, signal: RtcSignalMessage) => Promise<boolean>;
    /** Called when peer state changes */
    onPeerStateChange?: (userId: string, state: RtcPeerState) => void;
  };
  /** Callback to fetch participants */
  getParticipants?: () => Promise<EphemeralUser[]>;
  /** Callback to request additional permissions from user */
  requestPermission?: (permission: Permission, reason?: string) => Promise<boolean>;
}

// ============================================================================
// Host State
// ============================================================================

export type HostState =
  | 'idle'
  | 'loading'
  | 'handshaking'
  | 'ready'
  | 'paused'
  | 'terminated'
  | 'error';

// ============================================================================
// PlayFrame Host
// ============================================================================

export class PlayFrameHost extends EventEmitter<PlayFrameHostEvents> {
  private config: PlayFrameHostConfig;
  private state: HostState = 'idle';
  private iframe: HTMLIFrameElement | null = null;
  private gameOrigin: string | null = null;
  private context: GameContext | null = null;
  private layout: LayoutState | null = null;
  private audioState: AudioState;
  private grantedPermissions: Set<Permission> = new Set();
  private watchdog: Watchdog | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private handshakeResolve: ((context: GameContext) => void) | null = null;
  private handshakeReject: ((error: Error) => void) | null = null;
  private handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Dev mode
  private devOverlay: ReturnType<typeof createDebugOverlay> | null = null;
  private messageLogger: ReturnType<typeof createMessageLogger> | null = null;
  
  // Input state
  private pointerLocked = false;
  private keyboardCaptured = false;
  private gamepadEnabled = false;

  constructor(config: PlayFrameHostConfig) {
    super();
    this.config = config;
    
    this.audioState = {
      enabled: config.audioConfig?.enabled ?? true,
      masterVolume: config.audioConfig?.masterVolume ?? 1.0,
      muted: false,
      visible: !document.hidden,
    };
    
    // Initialize granted permissions from auto-grant list
    if (config.autoGrantPermissions) {
      for (const perm of config.autoGrantPermissions) {
        this.grantedPermissions.add(perm);
      }
    }
    
    // Dev mode setup
    if (config.devConfig?.enabled) {
      this.setupDevMode();
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the game.
   */
  async start(): Promise<GameContext> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start: host is ${this.state}`);
    }

    this.state = 'loading';
    
    // Parse game origin
    this.gameOrigin = new URL(this.config.gameUrl).origin;
    
    // Create iframe
    this.iframe = createGameIframe({
      src: this.config.gameUrl,
      container: this.config.container,
      permissions: Array.from(this.grantedPermissions),
      sandboxConfig: this.config.sandboxConfig,
      cspConfig: this.config.devConfig?.disableCsp ? undefined : this.config.cspConfig,
      styles: {
        width: '100%',
        height: '100%',
      },
    });
    
    // Setup message listener
    this.setupMessageListener();
    
    // Setup visibility listener
    this.setupVisibilityListener();
    
    // Setup input listeners
    this.setupInputListeners();
    
    // Wait for iframe to load
    await this.waitForLoad();
    this.emit('load', undefined);
    
    // Wait for handshake
    this.state = 'handshaking';
    const context = await this.waitForHandshake();
    
    // Setup watchdog
    if (!this.config.devConfig?.disableWatchdog) {
      this.setupWatchdog();
    }
    
    this.state = 'ready';
    this.emit('ready', context);
    
    this.updateDevOverlay({ state: 'ready' });
    
    return context;
  }

  /**
   * Pause the game.
   */
  pause(reason: PauseReason = 'host-requested'): void {
    if (this.state !== 'ready') return;
    
    this.state = 'paused';
    this.send('pause', { reason });
    this.emit('pause', { reason });
    
    this.updateDevOverlay({ state: 'paused' });
  }

  /**
   * Resume the game.
   */
  resume(): void {
    if (this.state !== 'paused') return;
    
    this.state = 'ready';
    this.send('resume', { reason: 'host-requested' });
    this.emit('resume', undefined);
    
    this.updateDevOverlay({ state: 'ready' });
  }

  /**
   * Terminate the game.
   */
  terminate(reason: TerminateReason = 'host-closed', message?: string): void {
    if (this.state === 'terminated' || this.state === 'idle') return;
    
    this.send('terminate', { reason, message });
    this.cleanup();
    
    this.state = 'terminated';
    this.emit('terminate', { reason, message });
  }

  /**
   * Get the current host state.
   */
  getState(): HostState {
    return this.state;
  }

  /**
   * Get the game context.
   */
  getContext(): GameContext | null {
    return this.context;
  }

  /**
   * Get the current layout state.
   */
  getLayout(): LayoutState | null {
    return this.layout;
  }

  // ==========================================================================
  // Layout Management
  // ==========================================================================

  /**
   * Update container size and notify the game.
   */
  updateContainerSize(): void {
    if (!this.iframe || !this.context) return;
    
    const container = this.config.container;
    const viewport: Dimensions = {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    
    this.layout = this.calculateLayout(viewport, this.context.permissions.granted.includes('fullscreen'));
    
    // Update iframe size
    this.iframe.style.width = `${this.layout.gameArea.width}px`;
    this.iframe.style.height = `${this.layout.gameArea.height}px`;
    
    // Center the iframe
    const left = (viewport.width - this.layout.gameArea.width) / 2;
    const top = (viewport.height - this.layout.gameArea.height) / 2;
    this.iframe.style.position = 'absolute';
    this.iframe.style.left = `${left}px`;
    this.iframe.style.top = `${top}px`;
    
    // Notify game
    this.send('layout-update', { layout: this.layout, reason: 'resize' });
    this.emit('layoutChange', this.layout);
  }

  /**
   * Toggle fullscreen mode.
   */
  async toggleFullscreen(): Promise<boolean> {
    if (!document.fullscreenEnabled) return false;
    
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await this.config.container.requestFullscreen();
      }
      return true;
    } catch {
      return false;
    }
  }

  private calculateLayout(viewport: Dimensions, isFullscreen: boolean): LayoutState {
    // TODO: Use actual game layout config from handshake
    const preferredLayout: LayoutConfig = { mode: 'responsive' };
    
    let gameArea: Dimensions;
    
    switch (preferredLayout.mode) {
      case 'fixed-aspect':
        const aspectRatio = preferredLayout.aspectRatio ?? { width: 16, height: 9 };
        gameArea = calculateAspectFitDimensions(viewport, aspectRatio);
        break;
      
      case 'fixed-size':
        gameArea = clampDimensions(
          preferredLayout.preferredSize ?? viewport,
          this.config.layoutConstraints?.minSize ?? MIN_GAME_SIZE,
          this.config.layoutConstraints?.maxSize ?? MAX_GAME_SIZE
        );
        break;
      
      case 'responsive':
      default:
        gameArea = viewport;
    }
    
    return {
      viewport,
      gameArea,
      devicePixelRatio: window.devicePixelRatio,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      isFullscreen,
    };
  }

  // ==========================================================================
  // Audio Management
  // ==========================================================================

  /**
   * Set master volume.
   */
  setVolume(volume: number): void {
    this.audioState.masterVolume = Math.max(0, Math.min(1, volume));
    this.sendAudioState();
  }

  /**
   * Mute/unmute audio.
   */
  setMuted(muted: boolean): void {
    this.audioState.muted = muted;
    this.sendAudioState();
  }

  private sendAudioState(): void {
    this.send('audio-state', { state: this.audioState });
  }

  // ==========================================================================
  // Participant Management
  // ==========================================================================

  /**
   * Notify of a new participant.
   */
  notifyParticipantJoin(user: EphemeralUser): void {
    this.emit('participantJoin', user);
    // The game will request participants via get-participants
  }

  /**
   * Notify of a participant leaving.
   */
  notifyParticipantLeave(ephemeralId: string): void {
    this.emit('participantLeave', { ephemeralId });
    // The game will request participants via get-participants
  }

  // ==========================================================================
  // Private: Message Handling
  // ==========================================================================

  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      // Validate origin
      if (event.origin !== this.gameOrigin) return;
      
      if (!isValidMessage(event.data)) return;
      
      const message = event.data as MessageEnvelope;
      
      this.messageLogger?.logIncoming(message.type, message.payload);
      this.emit('message', { direction: 'in', type: message.type, payload: message.payload });
      
      this.handleMessage(message);
    };
    
    window.addEventListener('message', this.messageHandler);
  }

  private handleMessage(message: MessageEnvelope): void {
    switch (message.type) {
      case 'handshake':
        this.handleHandshake(message as MessageEnvelope<HandshakePayload>);
        break;
      
      case 'ready':
        // Game is ready to receive input
        break;
      
      case 'get-context':
        this.handleGetContext(message);
        break;
      
      case 'get-user':
        this.handleGetUser(message);
        break;
      
      case 'get-participants':
        this.handleGetParticipants(message);
        break;
      
      case 'layout-request':
        this.handleLayoutRequest(message);
        break;
      
      case 'resize-request':
        this.handleResizeRequest(message);
        break;
      
      case 'input-capabilities':
        this.handleInputCapabilities(message);
        break;
      
      case 'pointer-lock-request':
        this.handlePointerLockRequest(message);
        break;
      
      case 'keyboard-focus-request':
        this.handleKeyboardFocusRequest(message);
        break;
      
      case 'gamepad-request':
        this.handleGamepadRequest(message);
        break;
      
      case 'audio-context-request':
        this.handleAudioContextRequest(message);
        break;
      
      case 'rtc-get-ice-servers':
        this.handleRtcGetIceServers(message);
        break;
      
      case 'rtc-signal':
        this.handleRtcSignal(message);
        break;
      
      case 'rtc-peer-state':
        this.handleRtcPeerState(message);
        break;
      
      case 'pong':
        this.handlePong(message.payload as PongPayload);
        break;
      
      case 'log':
        // Game diagnostic log
        if (this.config.devConfig?.logMessages) {
          const log = (message.payload as { log: { level: string; message: string; data?: unknown } }).log;
          console.log(`[Game:${log.level}]`, log.message, log.data ?? '');
        }
        break;
      
      case 'error':
        const errorPayload = message.payload as { error: ProtocolError; fatal: boolean };
        this.emit('error', errorPayload);
        break;
    }
  }

  private handleHandshake(message: MessageEnvelope<HandshakePayload>): void {
    const payload = message.payload;
    
    // Validate protocol version
    if (!isVersionCompatible(payload.protocolVersion)) {
      this.sendError(message.id, 'UNSUPPORTED_VERSION', `Unsupported protocol version: ${payload.protocolVersion}`);
      return;
    }
    
    // Process permission requests
    const granted: Permission[] = [];
    const denied: Permission[] = [];
    
    for (const permission of payload.requestedPermissions) {
      if (this.grantedPermissions.has(permission)) {
        granted.push(permission);
      } else if (this.config.availablePermissions?.includes(permission)) {
        // Could request user permission here
        granted.push(permission);
        this.grantedPermissions.add(permission);
      } else {
        denied.push(permission);
      }
    }
    
    // Build context
    this.context = {
      protocolVersion: PROTOCOL_VERSION,
      game: this.config.game,
      user: this.config.user,
      space: this.config.space,
      session: this.config.session,
      permissions: {
        granted,
        denied,
        canRequestMore: (this.config.availablePermissions?.length ?? 0) > 0,
      },
      capabilities: this.getCapabilities(),
    };
    
    // Calculate initial layout
    const viewport: Dimensions = {
      width: this.config.container.clientWidth,
      height: this.config.container.clientHeight,
    };
    this.layout = this.calculateLayout(viewport, false);
    
    // Send acknowledgment
    const ack: HandshakeAckPayload = {
      protocolVersion: PROTOCOL_VERSION,
      context: this.context,
      layout: this.layout,
      audio: this.audioState,
      heartbeatInterval: this.config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
    };
    
    this.sendResponse(message.id, 'handshake-ack', ack);
    
    // Resolve handshake promise
    if (this.handshakeResolve) {
      this.handshakeResolve(this.context);
      this.handshakeResolve = null;
      this.handshakeReject = null;
      
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = null;
      }
    }
  }

  private handleGetContext(message: MessageEnvelope): void {
    if (!this.context) {
      this.sendError(message.id, 'NOT_READY', 'Context not available');
      return;
    }
    
    this.sendResponse(message.id, 'get-context', { context: this.context });
  }

  private handleGetUser(message: MessageEnvelope): void {
    if (!this.config.user) {
      this.sendError(message.id, 'NOT_READY', 'User not available');
      return;
    }
    
    this.sendResponse(message.id, 'get-user', { user: this.config.user });
  }

  private async handleGetParticipants(message: MessageEnvelope): Promise<void> {
    try {
      const participants = this.config.getParticipants
        ? await this.config.getParticipants()
        : [this.config.user];
      
      this.sendResponse(message.id, 'get-participants', {
        participants,
        totalCount: participants.length,
      });
    } catch (error) {
      this.sendError(message.id, 'UNKNOWN_ERROR', 'Failed to get participants');
    }
  }

  private handleLayoutRequest(message: MessageEnvelope): void {
    // For now, accept all layout requests
    const payload = message.payload as { layout: LayoutConfig };
    
    // Recalculate layout with new config
    const viewport: Dimensions = {
      width: this.config.container.clientWidth,
      height: this.config.container.clientHeight,
    };
    
    // TODO: Store and use the requested layout
    this.layout = this.calculateLayout(viewport, this.layout?.isFullscreen ?? false);
    
    this.sendResponse(message.id, 'layout-request', {
      accepted: true,
      layout: this.layout,
    });
  }

  private handleResizeRequest(message: MessageEnvelope): void {
    const payload = message.payload as { fullscreen?: boolean; size?: Dimensions };
    
    if (payload.fullscreen !== undefined) {
      this.toggleFullscreen();
    }
    
    // Recalculate layout
    if (this.layout) {
      this.sendResponse(message.id, 'resize-request', {
        accepted: true,
        layout: this.layout,
      });
    } else {
      this.sendError(message.id, 'NOT_READY', 'Layout not initialized');
    }
  }

  private handleInputCapabilities(message: MessageEnvelope): void {
    const capabilities: InputCapabilities = {
      available: ['mouse', 'keyboard'],
      active: ['mouse', 'keyboard'],
      gamepads: [],
    };
    
    // Check for touch
    if ('ontouchstart' in window) {
      capabilities.available.push('touch');
    }
    
    // Check for gamepads
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp) {
          capabilities.available.push('gamepad');
          capabilities.gamepads.push({
            index: gp.index,
            id: gp.id,
            buttons: gp.buttons.length,
            axes: gp.axes.length,
          });
        }
      }
    }
    
    this.sendResponse(message.id, 'input-capabilities', { capabilities });
  }

  private handlePointerLockRequest(message: MessageEnvelope): void {
    const payload = message.payload as { enable: boolean };
    
    if (!this.grantedPermissions.has('pointer-lock')) {
      this.sendResponse(message.id, 'pointer-lock-request', {
        success: false,
        locked: false,
        error: 'Permission not granted',
      });
      return;
    }
    
    if (payload.enable) {
      this.iframe?.requestPointerLock?.();
      this.pointerLocked = true;
    } else {
      document.exitPointerLock?.();
      this.pointerLocked = false;
    }
    
    this.sendResponse(message.id, 'pointer-lock-request', {
      success: true,
      locked: this.pointerLocked,
    });
  }

  private handleKeyboardFocusRequest(message: MessageEnvelope): void {
    const payload = message.payload as { capture: boolean; interceptKeys?: string[] };
    
    if (!this.grantedPermissions.has('keyboard')) {
      this.sendResponse(message.id, 'keyboard-focus-request', {
        success: false,
        blockedKeys: [],
      });
      return;
    }
    
    this.keyboardCaptured = payload.capture;
    
    // Return list of keys that are always blocked
    const blockedKeys = ['F5', 'F11', 'F12', ...this.config.inputConfig?.blockedKeys ?? []];
    
    this.sendResponse(message.id, 'keyboard-focus-request', {
      success: true,
      blockedKeys,
    });
  }

  private handleGamepadRequest(message: MessageEnvelope): void {
    const payload = message.payload as { enable: boolean; indices?: number[] };
    
    if (!this.grantedPermissions.has('gamepad')) {
      this.sendResponse(message.id, 'gamepad-request', {
        success: false,
        gamepads: [],
      });
      return;
    }
    
    this.gamepadEnabled = payload.enable;
    
    const gamepads: InputCapabilities['gamepads'] = [];
    if (navigator.getGamepads) {
      const gps = navigator.getGamepads();
      for (let i = 0; i < gps.length; i++) {
        const gp = gps[i];
        if (gp && (!payload.indices || payload.indices.includes(gp.index))) {
          gamepads.push({
            index: gp.index,
            id: gp.id,
            buttons: gp.buttons.length,
            axes: gp.axes.length,
          });
        }
      }
    }
    
    this.sendResponse(message.id, 'gamepad-request', {
      success: true,
      gamepads,
    });
  }

  private handleAudioContextRequest(message: MessageEnvelope): void {
    if (!this.grantedPermissions.has('audio')) {
      this.sendResponse(message.id, 'audio-context-request', {
        available: false,
        sampleRate: 0,
        state: this.audioState,
      });
      return;
    }
    
    this.sendResponse(message.id, 'audio-context-request', {
      available: true,
      sampleRate: 48000,
      state: this.audioState,
    });
  }

  private handlePong(payload: PongPayload): void {
    this.watchdog?.recordPong(payload.seq, payload.gameTime);
    
    // Update latency in dev overlay
    const latency = Date.now() - payload.hostTime;
    this.updateDevOverlay({ latency });
  }

  // ==========================================================================
  // Private: WebRTC Handlers
  // ==========================================================================

  private async handleRtcGetIceServers(message: MessageEnvelope): Promise<void> {
    if (!this.grantedPermissions.has('networking')) {
      this.sendResponse(message.id, 'rtc-get-ice-servers', {
        config: { iceServers: [], ttl: 0, issuedAt: Date.now() },
      });
      return;
    }
    
    if (!this.config.rtcConfig?.getIceServers) {
      // Return empty config if no TURN provider configured
      this.sendResponse(message.id, 'rtc-get-ice-servers', {
        config: {
          iceServers: [
            // Default public STUN servers as fallback
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun:stun1.l.google.com:19302'] },
          ],
          ttl: 3600,
          issuedAt: Date.now(),
        },
      });
      return;
    }
    
    try {
      const config = await this.config.rtcConfig.getIceServers();
      this.sendResponse(message.id, 'rtc-get-ice-servers', { config });
    } catch (error) {
      this.sendError(message.id, 'PERMISSION_DENIED', 'Failed to get ICE servers');
    }
  }

  private async handleRtcSignal(message: MessageEnvelope): Promise<void> {
    const payload = message.payload as RtcSignalPayload;
    
    if (!this.grantedPermissions.has('networking')) {
      this.sendResponse(message.id, 'rtc-signal', { delivered: false });
      return;
    }
    
    if (!this.config.rtcConfig?.relaySignal) {
      // No relay function configured
      this.sendResponse(message.id, 'rtc-signal', { delivered: false });
      return;
    }
    
    try {
      const delivered = await this.config.rtcConfig.relaySignal(
        this.config.user.ephemeralId,
        payload.signal.targetPeerId,
        payload.signal
      );
      this.sendResponse(message.id, 'rtc-signal', { delivered });
    } catch (error) {
      this.sendResponse(message.id, 'rtc-signal', { delivered: false });
    }
  }

  private handleRtcPeerState(message: MessageEnvelope): void {
    const payload = message.payload as RtcPeerStatePayload;
    
    // Notify host about peer state change
    this.config.rtcConfig?.onPeerStateChange?.(this.config.user.ephemeralId, payload.peer);
  }

  /**
   * Relay an incoming RTC signal from another peer to this game instance.
   * Called by the host application when it receives a signal destined for this user.
   */
  relaySignalToGame(from: string, signal: RtcSignalMessage): void {
    if (this.state !== 'ready' && this.state !== 'paused') return;
    
    this.send('rtc-signal', { from, signal });
  }

  // ==========================================================================
  // Private: Sending Messages
  // ==========================================================================

  private send<T>(type: MessageType, payload: T): void {
    if (!this.iframe?.contentWindow) return;
    
    const message = createMessage(type, payload);
    
    this.messageLogger?.logOutgoing(type, payload);
    this.emit('message', { direction: 'out', type, payload });
    
    this.iframe.contentWindow.postMessage(message, this.gameOrigin!);
  }

  private sendResponse<T>(requestId: string, type: MessageType, payload: T): void {
    if (!this.iframe?.contentWindow) return;
    
    const response = createResponse(requestId, type, payload, true);
    
    this.messageLogger?.logOutgoing(type, payload);
    this.emit('message', { direction: 'out', type, payload });
    
    this.iframe.contentWindow.postMessage(response, this.gameOrigin!);
  }

  private sendError(requestId: string, code: ProtocolError['code'], message: string): void {
    if (!this.iframe?.contentWindow) return;
    
    const error: ProtocolError = { code, message };
    const response = createResponse(requestId, 'error', { error, fatal: false }, false, error);
    
    this.iframe.contentWindow.postMessage(response, this.gameOrigin!);
  }

  // ==========================================================================
  // Private: Setup Methods
  // ==========================================================================

  private async waitForLoad(): Promise<void> {
    if (!this.iframe) throw new Error('No iframe');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Game load timeout'));
      }, 30000);
      
      this.iframe!.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      this.iframe!.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Game load failed'));
      };
    });
  }

  private waitForHandshake(): Promise<GameContext> {
    return new Promise((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;
      
      this.handshakeTimeout = setTimeout(() => {
        this.handshakeReject?.(new Error('Handshake timeout'));
        this.handshakeResolve = null;
        this.handshakeReject = null;
      }, HANDSHAKE_TIMEOUT);
    });
  }

  private setupWatchdog(): void {
    this.watchdog = new Watchdog({
      ...this.config.watchdogConfig,
      heartbeatInterval: this.config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      onTimeout: () => {
        console.warn('[PlayFrame] Watchdog timeout - game unresponsive');
        this.terminate('timeout', 'Game became unresponsive');
      },
      onHealthReport: (health) => {
        this.emit('healthReport', health);
        this.updateDevOverlay({ health });
      },
    });
    
    this.watchdog.setPingSender((seq, time) => {
      this.send('ping', { hostTime: time, seq });
    });
    
    this.watchdog.start();
  }

  private setupVisibilityListener(): void {
    document.addEventListener('visibilitychange', () => {
      this.audioState.visible = !document.hidden;
      this.sendAudioState();
      
      if (document.hidden) {
        this.pause('background');
      } else {
        this.resume();
      }
    });
  }

  private setupInputListeners(): void {
    // Handle Escape key for pause
    if (this.config.inputConfig?.interceptEscape !== false) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.state === 'ready') {
          this.pause('user-requested');
        }
      });
    }
    
    // Handle pointer lock change
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.iframe;
    });
    
    // Handle fullscreen change
    document.addEventListener('fullscreenchange', () => {
      this.updateContainerSize();
      this.send('layout-update', {
        layout: this.layout,
        reason: 'fullscreen-change',
      });
    });
    
    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      this.updateContainerSize();
    });
    resizeObserver.observe(this.config.container);
  }

  private getCapabilities(): HostCapabilities {
    return {
      inputTypes: ['mouse', 'keyboard'],
      audioAvailable: true,
      fullscreenAvailable: document.fullscreenEnabled,
      pointerLockAvailable: 'pointerLockElement' in document,
      gamepadAvailable: 'getGamepads' in navigator,
      maxFps: DEFAULT_FPS_LIMIT,
      devMode: this.config.devConfig?.enabled ?? false,
    };
  }

  // ==========================================================================
  // Private: Dev Mode
  // ==========================================================================

  private setupDevMode(): void {
    const devConfig = this.config.devConfig!;
    
    if (devConfig.showOverlay) {
      this.devOverlay = createDebugOverlay(this.config.container);
    }
    
    if (devConfig.logMessages) {
      this.messageLogger = createMessageLogger();
    }
  }

  private updateDevOverlay(data: Partial<DebugOverlayData>): void {
    if (!this.devOverlay) return;
    
    const updates: Partial<DebugOverlayData> = { ...data };
    
    if (this.context) {
      updates.protocolVersion = this.context.protocolVersion;
      updates.sessionId = this.context.session.sessionId;
    }
    
    this.devOverlay.update(updates);
  }

  // ==========================================================================
  // Private: Cleanup
  // ==========================================================================

  private cleanup(): void {
    // Stop watchdog
    this.watchdog?.stop();
    this.watchdog = null;
    
    // Remove message listener
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    
    // Release pointer lock
    if (this.pointerLocked) {
      document.exitPointerLock?.();
      this.pointerLocked = false;
    }
    
    // Destroy iframe
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    
    // Cleanup dev overlay
    this.devOverlay?.destroy();
    this.devOverlay = null;
    
    // Clear state
    this.context = null;
    this.layout = null;
    this.gameOrigin = null;
  }
}
