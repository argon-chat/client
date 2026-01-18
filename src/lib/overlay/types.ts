/**
 * Overlay Widget System Types
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Color {
  r: number
  g: number
  b: number
  a: number
}

export const Colors = {
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  speakingGreen: { r: 0.52, g: 1, b: 0.35, a: 1 }, // lime-400
  mutedRed: { r: 0.96, g: 0.26, b: 0.21, a: 1 },
  background: { r: 0.1, g: 0.1, b: 0.12, a: 0.85 },
  cardBackground: { r: 0.15, g: 0.15, b: 0.18, a: 0.95 },
} as const

/**
 * Voice member data for overlay
 */
export interface VoiceMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  avatarColor: string // Fallback color for avatar
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
}

/**
 * Widget configuration
 */
export interface WidgetConfig {
  id: string
  position: Vec2
  size: Vec2
  visible: boolean
  opacity: number
}

/**
 * Base widget interface
 */
export interface IWidget {
  readonly id: string
  config: WidgetConfig
  
  update(deltaTime: number): void
  render(ctx: OverlayRenderContext): void
  dispose(): void
}

/**
 * Render context passed to widgets
 */
export interface OverlayRenderContext {
  device: GPUDevice
  encoder: GPUCommandEncoder
  passEncoder: GPURenderPassEncoder
  format: GPUTextureFormat
  canvasSize: Vec2
  time: number
  deltaTime: number
  
  /**
   * Track a draw call for diagnostics
   * @param vertexCount Number of vertices drawn
   * @param spriteCount Number of sprites/quads drawn (default 1)
   */
  trackDraw(vertexCount: number, spriteCount?: number): void
}

/**
 * Texture atlas entry
 */
export interface TextureEntry {
  texture: GPUTexture
  view: GPUTextureView
  sampler: GPUSampler
  width: number
  height: number
}

/**
 * Captured region for fragment-based overlay
 */
export interface CapturedRegion {
  /** X position on screen */
  x: number
  /** Y position on screen */
  y: number
  /** Region width */
  width: number
  /** Region height */
  height: number
  /** RGBA pixel data */
  data: Uint8Array
  /** Widget ID that owns this region */
  widgetId: string
  /** Is this region dirty (changed since last capture) */
  dirty: boolean
}

/**
 * Fragment capture result - only changed regions
 */
export interface FragmentCapture {
  /** Timestamp of capture */
  timestamp: number
  /** Screen dimensions (for positioning) */
  screenWidth: number
  screenHeight: number
  /** Changed regions only */
  regions: CapturedRegion[]
  /** Total bytes across all regions */
  totalBytes: number
}

/**
 * A single dirty tile that has changed
 */
export interface DirtyTile {
  /** Tile X index */
  tileX: number
  /** Tile Y index */
  tileY: number
  /** Pixel X position on screen */
  x: number
  /** Pixel Y position on screen */
  y: number
  /** Tile width in pixels */
  width: number
  /** Tile height in pixels */
  height: number
  /** RGBA pixel data for this tile */
  data: Uint8Array
}

/**
 * Dirty render capture result - minimal changed tiles only
 */
export interface DirtyCapture {
  /** Timestamp of capture */
  timestamp: number
  /** Full screen width */
  screenWidth: number
  /** Full screen height */
  screenHeight: number
  /** Tile size used for comparison */
  tileSize: number
  /** Grid dimensions */
  tilesX: number
  tilesY: number
  /** Only the tiles that changed (non-transparent) */
  dirtyTiles: DirtyTile[]
  /** Number of dirty tiles */
  dirtyCount: number
  /** Total tiles in grid */
  totalTiles: number
  /** Percentage of screen that changed */
  dirtyPercent: number
  /** Total bytes in dirty tiles */
  totalBytes: number
  /** Is this a full refresh (first frame or resize) */
  fullRefresh: boolean
  /** Number of tiles skipped because they are fully transparent */
  transparentSkipped: number
  /** Number of tiles that were dirty but transparent (saved bandwidth) */
  transparentSaved: number
}

/**
 * Sprite batch vertex format
 * Position (2) + UV (2) + Color (4) + Extra (2) = 10 floats per vertex
 */
export interface SpriteVertex {
  x: number
  y: number
  u: number
  v: number
  r: number
  g: number
  b: number
  a: number
  extra1: number // For effects like glow intensity
  extra2: number // Reserved
}

export const SPRITE_VERTEX_SIZE = 10 * 4 // 10 floats * 4 bytes
export const VERTICES_PER_SPRITE = 6 // 2 triangles
