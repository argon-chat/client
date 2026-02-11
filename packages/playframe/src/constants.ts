/**
 * Argon PlayFrame Constants
 * 
 * Shared constants for both host and SDK.
 */

// ============================================================================
// Protocol Constants
// ============================================================================

export const PLAYFRAME_PROTOCOL_ID = 'argon-playframe';

/** Message channel name for postMessage communication */
export const MESSAGE_CHANNEL = 'argon-playframe';

/** Default heartbeat interval in ms */
export const DEFAULT_HEARTBEAT_INTERVAL = 5000;

/** Heartbeat timeout before watchdog triggers (2 missed heartbeats) */
export const HEARTBEAT_TIMEOUT = 12000;

/** Maximum time to wait for handshake */
export const HANDSHAKE_TIMEOUT = 10000;

/** Maximum time to wait for a response */
export const REQUEST_TIMEOUT = 5000;

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * Default iframe sandbox attributes.
 * These provide maximum security while allowing games to function.
 */
export const DEFAULT_SANDBOX_FLAGS = [
  'allow-scripts',           // Required for game logic
  'allow-same-origin',       // Required for some APIs (careful with this)
  // 'allow-popups',         // Disabled - no popups
  // 'allow-forms',          // Disabled - no form submission
  // 'allow-top-navigation', // Disabled - no navigation
] as const;

/**
 * Optional sandbox flags that can be enabled based on permissions.
 */
export const OPTIONAL_SANDBOX_FLAGS = {
  'pointer-lock': 'allow-pointer-lock',
  'gamepad': 'allow-gamepad', // Note: Not all browsers support this
  'fullscreen': 'allow-fullscreen',
  // 'allow-modals' intentionally not exposed
} as const;

// ============================================================================
// CSP Configuration
// ============================================================================

/**
 * Base Content Security Policy for game iframes.
 */
export const BASE_CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Games may need eval for wasm
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"], // Will be extended with game-specific domains
  'worker-src': ["'self'", 'blob:'],
  'child-src': ["'none'"],    // No nested iframes
  'frame-src': ["'none'"],    // No nested frames
  'object-src': ["'none'"],   // No plugins
  'base-uri': ["'self'"],
  'form-action': ["'none'"],  // No form submissions
} as const;

// ============================================================================
// Layout Constants
// ============================================================================

/** Common aspect ratios */
export const ASPECT_RATIOS = {
  '16:9': { width: 16, height: 9 },
  '4:3': { width: 4, height: 3 },
  '1:1': { width: 1, height: 1 },
  '21:9': { width: 21, height: 9 },
  '9:16': { width: 9, height: 16 }, // Portrait
} as const;

/** Default minimum game dimensions */
export const MIN_GAME_SIZE = {
  width: 320,
  height: 240,
} as const;

/** Default maximum game dimensions */
export const MAX_GAME_SIZE = {
  width: 3840,
  height: 2160,
} as const;

// ============================================================================
// Input Constants
// ============================================================================

/** Keys that are always blocked and never forwarded to games */
export const ALWAYS_BLOCKED_KEYS = new Set([
  'F1',   // Help
  'F5',   // Refresh
  'F11',  // Fullscreen (handled by host)
  'F12',  // DevTools
  'PrintScreen',
]);

/** Key combinations that are always blocked */
export const ALWAYS_BLOCKED_COMBOS = [
  { key: 'w', ctrl: true, meta: false },      // Close tab
  { key: 'W', ctrl: true, meta: false },
  { key: 't', ctrl: true, meta: false },      // New tab
  { key: 'T', ctrl: true, meta: false },
  { key: 'n', ctrl: true, meta: false },      // New window
  { key: 'N', ctrl: true, meta: false },
  { key: 'Tab', alt: true },                  // Switch window
  { key: 'F4', alt: true },                   // Close window
  { key: 'r', ctrl: true, meta: false },      // Refresh
  { key: 'R', ctrl: true, meta: false },
  { key: 'l', ctrl: true, meta: false },      // Address bar
  { key: 'L', ctrl: true, meta: false },
] as const;

/** Special keys that games commonly want */
export const GAME_RELEVANT_KEYS = new Set([
  'Escape',     // Pause menu
  'Enter',      // Confirm
  'Space',      // Jump/Action
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',  // WASD
  'Shift', 'Control', 'Alt',
  'Tab',        // Inventory/Menu (when not with Alt)
]);

// ============================================================================
// Audio Constants
// ============================================================================

/** Default audio sample rate */
export const DEFAULT_SAMPLE_RATE = 48000;

/** Default audio latency hint */
export const DEFAULT_LATENCY_HINT = 'interactive' as const;

// ============================================================================
// Performance Constants
// ============================================================================

/** Default FPS limit when in background */
export const BACKGROUND_FPS_LIMIT = 1;

/** Default FPS limit when active */
export const DEFAULT_FPS_LIMIT = 60;

/** Maximum allowed FPS */
export const MAX_FPS_LIMIT = 144;

/** Minimum time between frames in ms for throttling */
export const MIN_FRAME_TIME = 1000 / MAX_FPS_LIMIT;
