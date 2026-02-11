/**
 * @argon/playframe-sdk
 * 
 * SDK for developing games for Argon PlayFrame.
 * 
 * @example
 * ```typescript
 * import { PlayFrameClient, createFrameLoop, isInPlayFrame } from '@argon/playframe-sdk';
 * 
 * // Check if running in PlayFrame
 * if (!isInPlayFrame()) {
 *   console.log('Running in standalone mode');
 * }
 * 
 * // Create and connect client
 * const client = new PlayFrameClient({
 *   game: { id: 'my-game', version: '1.0.0', title: 'My Game' },
 *   permissions: ['keyboard', 'audio', 'pointer-lock'],
 *   layout: { mode: 'fixed-aspect', aspectRatio: { width: 16, height: 9 } },
 * });
 * 
 * await client.connect();
 * 
 * // Create game loop
 * const loop = createFrameLoop((delta, total) => {
 *   // Update game state
 *   // Render frame
 * }, { targetFps: 60 });
 * 
 * loop.start();
 * 
 * // Handle pause/resume
 * client.on('pause', () => loop.pause());
 * client.on('resume', () => loop.resume());
 * ```
 */

// Client
export { PlayFrameClient, type PlayFrameClientConfig, type PlayFrameClientEvents, type ClientState } from './client';

// Helpers
export {
  // Canvas
  configureCanvas,
  // Frame Loop
  createFrameLoop,
  type FrameLoopOptions,
  type FrameLoopControls,
  // Input
  createInputManager,
  type InputState,
  type InputManagerOptions,
  type InputManagerControls,
  // Storage
  createGameStorage,
  // Environment
  isInPlayFrame,
  isStandalone,
} from './helpers';

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
  Insets,
  // Permissions
  Permission,
  GrantedPermissions,
  // Capabilities
  HostCapabilities,
  InputType,
  // Audio
  AudioState,
  // Input
  InputCapabilities,
  GamepadInfo,
  // Protocol
  ProtocolError,
  ErrorCode,
} from '@argon/playframe';

// Re-export useful constants
export { ASPECT_RATIOS, GAME_RELEVANT_KEYS } from '@argon/playframe';
