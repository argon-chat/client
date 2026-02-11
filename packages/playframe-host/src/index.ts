/**
 * @argon/playframe-host
 * 
 * Host controller for Argon PlayFrame games.
 * This package is used by the Argon client to embed and manage games.
 * 
 * @example
 * ```typescript
 * import { PlayFrameHost } from '@argon/playframe-host';
 * 
 * const host = new PlayFrameHost({
 *   gameUrl: 'https://games.argon.io/my-game/',
 *   container: document.getElementById('game-container'),
 *   game: { id: 'my-game', version: '1.0.0', title: 'My Game' },
 *   user: { ephemeralId: '...', displayName: 'Player', ... },
 *   space: { ephemeralId: '...', name: 'Game Channel', ... },
 *   session: { sessionId: '...', startedAt: Date.now(), state: 'playing' },
 *   autoGrantPermissions: ['keyboard', 'audio', 'pointer-lock'],
 * });
 * 
 * // Start the game
 * const context = await host.start();
 * 
 * // Handle events
 * host.on('pause', () => {
 *   // Show pause UI
 * });
 * 
 * host.on('terminate', ({ reason }) => {
 *   // Clean up after game ends
 * });
 * ```
 */

// Host Controller
export {
  PlayFrameHost,
  type PlayFrameHostConfig,
  type PlayFrameHostEvents,
  type HostState,
} from './host';

// Sandbox Configuration
export {
  createGameIframe,
  buildSandboxAttribute,
  buildGameCsp,
  generateApiRestrictionScript,
  RESTRICTED_APIS,
  type SandboxConfig,
  type CspConfig,
  type CreateIframeOptions,
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_CSP_CONFIG,
} from './sandbox';

// Watchdog
export {
  Watchdog,
  FrameRateMonitor,
  getMemoryInfo,
  type WatchdogConfig,
  type HealthReport,
  type FrameRateMonitorConfig,
  type MemoryInfo,
} from './watchdog';

// Dev Tools
export {
  createStandaloneRunner,
  createDebugOverlay,
  createMessageLogger,
  generateMockUser,
  generateMockSpace,
  generateMockSession,
  generateMockCapabilities,
  generateMockContext,
  PerformanceProfiler,
  type DevModeConfig,
  type StandaloneRunnerConfig,
  type DebugOverlayData,
  type MessageLogger,
  type PerformanceMarker,
  DEFAULT_DEV_CONFIG,
} from './devtools';

// Re-export commonly used types from @argon/playframe
export type {
  // User/Space
  EphemeralUser,
  EphemeralSpace,
  ParticipantRole,
  ParticipantState,
  SpaceType,
  // Context
  GameContext,
  GameInfo,
  SessionInfo,
  SessionState,
  // Layout
  LayoutConfig,
  LayoutMode,
  LayoutState,
  AspectRatio,
  Dimensions,
  // Permissions
  Permission,
  GrantedPermissions,
  // Capabilities
  HostCapabilities,
  InputType,
  // Audio
  AudioState,
  // Protocol
  ProtocolError,
  ErrorCode,
  MessageType,
  PauseReason,
  TerminateReason,
} from '@argon/playframe';
