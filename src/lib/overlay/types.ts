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
 * Widget anchor position
 */
export type WidgetAnchor = 
  | 'top-left' 
  | 'top-right' 
  | 'bottom-left' 
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'

/**
 * Widget configuration
 */
export interface WidgetConfig {
  id: string
  position: Vec2
  size: Vec2
  visible: boolean
  opacity: number
  /** Show widget card background (default true) */
  showWidgetBackground: boolean
  /** Show member card backgrounds (default true) */
  showMemberCards: boolean
  /** Widget internal padding in pixels (default 12) */
  padding: number
  /** Spacing between member cards in pixels (default 6) */
  memberSpacing: number
  /** Widget offset from screen edge in pixels (default 20) */
  screenPadding: number
  /** Anchor position for the widget (default 'top-left') */
  anchor: WidgetAnchor
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
  /** Global opacity multiplier for all rendering (0-1) */
  globalOpacity: number
  
  /**
   * Track a draw call for diagnostics
   * @param vertexCount Number of vertices drawn
   * @param spriteCount Number of sprites/quads drawn (default 1)
   */
  trackDraw(vertexCount: number, spriteCount?: number): void
  
  /**
   * Track texture memory for VRAM diagnostics
   */
  trackTexture(id: string, texture: GPUTexture, width: number, height: number, bytesPerPixel?: number): void
  
  /**
   * Untrack texture when destroyed
   */
  untrackTexture(id: string): void
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

/**
 * Public interface for OverlayRenderer
 * Used for typing in Vue components to avoid ref unwrap issues
 */
export interface IOverlayRenderer {
  // Lifecycle
  initialize(): Promise<boolean>
  start(): void
  stop(): void
  dispose(): void
  resize(width: number, height: number): void
  
  // Size management
  setSizeMode(mode: CanvasSizeMode): void
  getSizeMode(): CanvasSizeMode
  getLogicalSize(): { width: number; height: number }
  
  // Global opacity
  setGlobalOpacity(opacity: number): void
  getGlobalOpacity(): number
  
  // Canvas access
  getCanvas(): HTMLCanvasElement
  
  // GPU resources
  getDevice(): GPUDevice | null
  getFormat(): GPUTextureFormat
  getUniformBindGroupLayout(): GPUBindGroupLayout | null
  
  // Widgets
  addWidget(widget: IWidget): void
  removeWidget(id: string): void
  
  // Diagnostics
  getDiagnostics(): OverlayDiagnostics
  
  // Frame capture
  getFrameInfo(): { width: number; height: number; totalBytes: number }
  captureRawFrame(): Promise<{ data: ArrayBuffer; width: number; height: number }>
  captureBlob(type: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number): Promise<Blob>
  captureDataURL(type?: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number): string
  
  // Fragment capture
  getVisibleBounds(): { x: number; y: number; width: number; height: number } | null
  captureFragments(): Promise<FragmentCapture>
  captureCombinedRegion(): Promise<{ x: number; y: number; width: number; height: number; data: Uint8Array } | null>
  
  // Dirty tile capture
  setDirtyTileSize(size: number): void
  captureDirtyTiles(): DirtyCapture
  invalidateFrame(): void
  startDirtyCapture(
    callback: (capture: DirtyCapture) => void,
    targetFps?: number,
    skipUnchanged?: boolean,
    recoveryIntervalSec?: number  // Force full refresh every N seconds (0 = disabled)
  ): () => void
  
  // Native bridge config
  getInitConfig(): { width: number; height: number; tileSize: number; tilesX: number; tilesY: number }
}

/**
 * Canvas size mode for overlay renderer
 */
export type CanvasSizeMode = 
  | { type: 'container' }
  | { type: 'screen' }
  | { type: 'window' }
  | { type: 'fixed'; width: number; height: number }

/**
 * GPU diagnostics info
 */
export interface GPUInfo {
  vendor: string
  device: string
  architecture: string
  description: string
  features: string[]
}

/**
 * VRAM usage tracking
 */
export interface VRAMUsage {
  buffers: number
  textures: number
  total: number
}

/**
 * Dirty capture statistics
 */
export interface DirtyCaptureStats {
  tileSize: number
  tilesX: number
  tilesY: number
  totalTiles: number
  previousFrameMemory: number
  captureCount: number
  lastCaptureTime: number
  lastCompareTime: number
  lastExtractTime: number
  lastDirtyPercent: number
  avgCaptureTime: number
  avgDirtyPercent: number
  avgBytesPerCapture: number
  lastTransparentSkipped: number
  lastTransparentSaved: number
  totalTransparentSkipped: number
  totalTransparentSaved: number
}

/**
 * Full diagnostics from renderer
 */
export interface OverlayDiagnostics {
  fps: number
  frameTime: number
  cpuTime: number
  gpuTime: number | null
  drawCalls: number
  vertexCount: number
  triangleCount: number
  spriteCount: number
  widgetCount: number
  visibleWidgetCount: number
  textureCount: number
  pipelineCount: number
  vramUsage: VRAMUsage
  gpuInfo: GPUInfo | null
  frameTimeHistory: number[]
  cpuTimeHistory: number[]
  gpuTimeHistory: number[]
  dirtyCapture: DirtyCaptureStats
}
