/**
 * Overlay Bridge API Types
 * Protocol for streaming overlay data to native WebView host
 */

// ==================== Tile Data ====================

/**
 * A single dirty tile with pixel data as base64
 */
export interface BridgeDirtyTile {
  /** Tile index X */
  tx: number
  /** Tile index Y */
  ty: number
  /** Pixel X position on screen */
  x: number
  /** Pixel Y position on screen */
  y: number
  /** Tile width in pixels */
  w: number
  /** Tile height in pixels */
  h: number
  /** RGBA pixel data as base64 string */
  data: string
}

// ==================== Messages ====================

/**
 * Initialize overlay with screen dimensions
 */
export interface BridgeInitMessage {
  type: 'init'
  /** Screen/canvas width */
  width: number
  /** Screen/canvas height */
  height: number
  /** Tile size in pixels */
  tileSize: number
  /** Grid columns */
  tilesX: number
  /** Grid rows */
  tilesY: number
}

/**
 * Full frame update (first frame or resize)
 */
export interface BridgeFullFrameMessage {
  type: 'full'
  /** Timestamp */
  ts: number
  /** Screen width */
  width: number
  /** Screen height */
  height: number
  /** All visible tiles */
  tiles: BridgeDirtyTile[]
}

/**
 * Delta/dirty update - only changed tiles
 */
export interface BridgeDeltaMessage {
  type: 'delta'
  /** Timestamp */
  ts: number
  /** Changed tiles only */
  tiles: BridgeDirtyTile[]
  /** Number of tiles that were dirty but skipped (transparent) */
  skipped: number
}

/**
 * Clear overlay (all transparent)
 */
export interface BridgeClearMessage {
  type: 'clear'
  /** Timestamp */
  ts: number
}

/**
 * Resize notification
 */
export interface BridgeResizeMessage {
  type: 'resize'
  /** New screen width */
  width: number
  /** New screen height */
  height: number
  /** Tile size */
  tileSize: number
  /** New grid columns */
  tilesX: number
  /** New grid rows */
  tilesY: number
}

/**
 * Diagnostics/stats message (optional, for debugging)
 */
export interface BridgeStatsMessage {
  type: 'stats'
  /** Frames per second */
  fps: number
  /** Dirty capture time in ms */
  captureTime: number
  /** Bytes sent this frame */
  bytes: number
  /** Tiles sent this frame */
  tileCount: number
  /** Transparent tiles skipped */
  transparentSkipped: number
}

/**
 * Union of all message types
 */
export type BridgeMessage = 
  | BridgeInitMessage
  | BridgeFullFrameMessage
  | BridgeDeltaMessage
  | BridgeClearMessage
  | BridgeResizeMessage
  | BridgeStatsMessage

// ==================== Utility Types ====================

/**
 * Callback for sending messages to native host
 */
export type BridgeSendFn = (message: BridgeMessage) => void

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  /** Target FPS for streaming */
  fps: number
  /** Tile size in pixels */
  tileSize: number
  /** Skip transparent tiles */
  skipTransparent: boolean
  /** Send stats messages */
  sendStats: boolean
  /** Stats interval in ms (if sendStats=true) */
  statsInterval: number
}

/**
 * Default bridge configuration
 */
export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  fps: 30,
  tileSize: 32,
  skipTransparent: true,
  sendStats: false,
  statsInterval: 1000,
}

// ==================== Bridge Interface ====================

/**
 * Overlay Bridge - interface for native host to implement
 * WebView calls these methods, native side handles rendering
 */
export interface IOverlayBridge {
  /**
   * Initialize overlay system
   * Called once when overlay starts
   */
  init(config: {
    width: number
    height: number
    tileSize: number
    tilesX: number
    tilesY: number
  }): Promise<void>

  /**
   * Send full frame (first frame or after resize)
   * All visible tiles included
   */
  sendFullFrame(frame: {
    timestamp: number
    width: number
    height: number
    tiles: BridgeDirtyTile[]
  }): Promise<void>

  /**
   * Send delta update - only changed non-transparent tiles
   */
  sendDelta(delta: {
    timestamp: number
    tiles: BridgeDirtyTile[]
    skippedTransparent: number
  }): Promise<void>

  /**
   * Clear overlay (make fully transparent)
   */
  clear(): Promise<void>

  /**
   * Notify about resize
   */
  resize(size: {
    width: number
    height: number
    tileSize: number
    tilesX: number
    tilesY: number
  }): Promise<void>

  /**
   * Send diagnostic stats (optional)
   */
  sendStats?(stats: {
    fps: number
    captureTimeMs: number
    bytesThisFrame: number
    tileCount: number
    transparentSkipped: number
  }): Promise<void>

  /**
   * Dispose/cleanup
   */
  dispose(): Promise<void>
}

/**
 * Overlay Controller - interface for WebView side
 * Native host may call these to control the overlay
 */
export interface IOverlayController {
  /**
   * Start streaming overlay updates
   */
  start(): Promise<void>

  /**
   * Stop streaming
   */
  stop(): Promise<void>

  /**
   * Check if streaming is active
   */
  isRunning(): boolean

  /**
   * Force full refresh on next frame
   */
  invalidate(): Promise<void>

  /**
   * Update configuration
   */
  configure(config: Partial<BridgeConfig>): Promise<void>

  /**
   * Get current configuration
   */
  getConfig(): BridgeConfig

  /**
   * Set visibility of a specific widget
   */
  setWidgetVisible(widgetId: string, visible: boolean): Promise<void>

  /**
   * Move widget position
   */
  setWidgetPosition(widgetId: string, x: number, y: number): Promise<void>

  /**
   * Get current diagnostics
   */
  getDiagnostics(): {
    fps: number
    frameTime: number
    captureTime: number
    dirtyPercent: number
    bytesPerSecond: number
  }
}

/**
 * Combined interface for full bridge implementation
 */
export interface IOverlayBridgeService extends IOverlayController {
  /**
   * Set the bridge implementation (native handler)
   */
  setBridge(bridge: IOverlayBridge): Promise<void>

  /**
   * Get current bridge
   */
  getBridge(): IOverlayBridge | null
}
