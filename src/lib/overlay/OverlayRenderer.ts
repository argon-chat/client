/**
 * WebGPU Overlay Renderer
 * Main canvas renderer for overlay widgets
 */

import type { Vec2, OverlayRenderContext, IWidget, CapturedRegion, FragmentCapture, DirtyTile, DirtyCapture } from './types'

// Shader for basic sprite rendering with glow support
const OVERLAY_SPRITE_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  _padding: f32,
}

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) extra: vec2f, // x: glow intensity, y: reserved
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) extra: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  // Convert from pixel coordinates to clip space (-1 to 1)
  let clipX = (input.position.x / uniforms.resolution.x) * 2.0 - 1.0;
  let clipY = 1.0 - (input.position.y / uniforms.resolution.y) * 2.0;
  
  output.position = vec4f(clipX, clipY, 0.0, 1.0);
  output.uv = input.uv;
  output.color = input.color;
  output.extra = input.extra;
  
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  var color = input.color;
  
  // Apply glow effect based on extra.x (glow intensity)
  if (input.extra.x > 0.0) {
    let glowIntensity = input.extra.x;
    let pulse = sin(uniforms.time * 3.0) * 0.15 + 0.85;
    let newRgb = mix(color.rgb, vec3f(0.52, 1.0, 0.35), glowIntensity * pulse * 0.5);
    let newA = min(color.a * (1.0 + glowIntensity * 0.3), 1.0);
    color = vec4f(newRgb, newA);
  }
  
  return color;
}
`

// Shader for textured sprites (avatars)
const OVERLAY_TEXTURE_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  _padding: f32,
}

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) extra: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) extra: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var textureData: texture_2d<f32>;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  let clipX = (input.position.x / uniforms.resolution.x) * 2.0 - 1.0;
  let clipY = 1.0 - (input.position.y / uniforms.resolution.y) * 2.0;
  
  output.position = vec4f(clipX, clipY, 0.0, 1.0);
  output.uv = input.uv;
  output.color = input.color;
  output.extra = input.extra;
  
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let texColor = textureSample(textureData, textureSampler, input.uv);
  var color = texColor * input.color;
  
  // Circle mask for avatars (centered at 0.5, 0.5)
  let center = vec2f(0.5, 0.5);
  let dist = distance(input.uv, center);
  let radius = 0.5;
  let smoothEdge = 0.02;
  let circleMask = 1.0 - smoothstep(radius - smoothEdge, radius, dist);
  
  color = vec4f(color.rgb, color.a * circleMask);
  
  // Glow ring effect for speaking
  if (input.extra.x > 0.0) {
    let glowIntensity = input.extra.x;
    let pulse = sin(uniforms.time * 4.0) * 0.2 + 0.8;
    
    // Ring glow
    let ringWidth = 0.08;
    let innerRadius = radius - ringWidth;
    let ringDist = abs(dist - (radius - ringWidth * 0.5));
    let ringGlow = (1.0 - smoothstep(0.0, ringWidth, ringDist)) * glowIntensity * pulse;
    
    let glowColor = vec3f(0.52, 1.0, 0.35);
    var newRgb = mix(color.rgb, glowColor, ringGlow * 0.7);
    
    // Outer glow
    let outerGlow = (1.0 - smoothstep(radius, radius + 0.15, dist)) * glowIntensity * pulse * 0.4;
    newRgb = newRgb + glowColor * outerGlow;
    let newA = max(color.a, outerGlow);
    color = vec4f(newRgb, newA);
  }
  
  return color;
}
`

// Shader for rounded rectangles
const OVERLAY_ROUNDED_RECT_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  _padding: f32,
}

struct RectParams {
  rect: vec4f,      // x, y, width, height
  color: vec4f,     // rgba
  borderRadius: f32,
  borderWidth: f32,
  borderColor: vec4f,
}

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) extra: vec2f, // x: borderRadius, y: reserved
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) extra: vec2f,
  @location(3) localPos: vec2f,
  @location(4) rectSize: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// SDF for rounded box
fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  let clipX = (input.position.x / uniforms.resolution.x) * 2.0 - 1.0;
  let clipY = 1.0 - (input.position.y / uniforms.resolution.y) * 2.0;
  
  output.position = vec4f(clipX, clipY, 0.0, 1.0);
  output.uv = input.uv;
  output.color = input.color;
  output.extra = input.extra;
  
  // Pass through rect info encoded in UV for SDF calculation
  // We need to reconstruct local position from UV
  output.localPos = input.uv;
  output.rectSize = vec2f(1.0, 1.0); // Normalized
  
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // Convert UV (0-1) to centered coordinates (-0.5 to 0.5)
  let p = input.uv - vec2f(0.5);
  let halfSize = vec2f(0.5);
  let radius = input.extra.x * 0.5; // Normalize radius
  
  let d = sdRoundedBox(p, halfSize, radius);
  
  // Anti-aliased edge
  let aa = 0.01;
  let alpha = 1.0 - smoothstep(-aa, aa, d);
  
  var color = input.color;
  color.a *= alpha;
  
  return color;
}
`

/**
 * Canvas size mode for overlay
 */
export type CanvasSizeMode = 
  | { type: 'container' }                          // Follow container size (default for debug)
  | { type: 'screen' }                             // Full screen size
  | { type: 'window' }                             // Window inner size
  | { type: 'fixed'; width: number; height: number } // Fixed resolution

/**
 * Diagnostics data for overlay renderer
 */
export interface OverlayDiagnostics {
  // FPS & Timing
  fps: number
  frameTime: number           // Total frame time (ms)
  cpuTime: number             // CPU time for frame prep (ms)
  gpuTime: number | null      // GPU time if available (ms)
  
  // Draw statistics
  drawCalls: number
  vertexCount: number
  triangleCount: number
  spriteCount: number
  
  // Memory usage (bytes)
  vramUsage: {
    buffers: number
    textures: number
    total: number
  }
  
  // Resources
  widgetCount: number
  visibleWidgetCount: number
  textureCount: number
  pipelineCount: number
  
  // GPU Info
  gpuInfo: {
    vendor: string
    architecture: string
    device: string
    description: string
    features: string[]
    limits: Record<string, number>
  } | null
  
  // Frame history for graphs
  frameTimeHistory: number[]
  fpsHistory: number[]
  
  // Dirty capture diagnostics
  dirtyCapture: {
    enabled: boolean
    tileSize: number
    tilesX: number
    tilesY: number
    totalTiles: number
    
    // Memory usage
    previousFrameMemory: number   // Bytes for previous frame storage
    
    // Last capture stats
    lastCaptureTime: number       // Time to perform last capture (ms)
    lastCompareTime: number       // Time for tile comparison (ms)
    lastExtractTime: number       // Time to extract dirty tiles (ms)
    lastDirtyCount: number
    lastDirtyPercent: number
    lastTotalBytes: number
    
    // Rolling averages
    avgCaptureTime: number
    avgDirtyPercent: number
    avgBytesPerCapture: number
    captureCount: number
    
    // Transparency optimization stats
    lastTransparentSkipped: number   // Tiles skipped in last capture
    lastTransparentSaved: number     // Bytes saved by skipping transparent
    totalTransparentSkipped: number  // Total tiles skipped ever
    totalTransparentSaved: number    // Total bytes saved ever
  }
}

export class OverlayRenderer {
  private canvas: HTMLCanvasElement
  private context: GPUCanvasContext | null = null
  private device: GPUDevice | null = null
  private adapter: GPUAdapter | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  
  private uniformBuffer: GPUBuffer | null = null
  private spritePipeline: GPURenderPipeline | null = null
  private texturePipeline: GPURenderPipeline | null = null
  private roundedRectPipeline: GPURenderPipeline | null = null
  
  private uniformBindGroup: GPUBindGroup | null = null
  
  private widgets: Map<string, IWidget> = new Map()
  
  private animationFrameId: number | null = null
  private lastTime: number = 0
  private isInitialized: boolean = false
  
  // Cached frame for capture (WebGPU clears buffer after present)
  private cachedFrameCanvas: HTMLCanvasElement | null = null
  private cachedFrameCtx: CanvasRenderingContext2D | null = null
  
  // Dirty tile rendering
  private previousFrameData: Uint8ClampedArray | null = null
  private previousFrameWidth: number = 0
  private previousFrameHeight: number = 0
  private dirtyTileSize: number = 32 // Default tile size
  
  // Dirty capture diagnostics
  private dirtyCaptureEnabled: boolean = false
  private lastDirtyCaptureTime: number = 0
  private lastDirtyCompareTime: number = 0
  private lastDirtyExtractTime: number = 0
  private lastDirtyCount: number = 0
  private lastDirtyPercent: number = 0
  private lastDirtyBytes: number = 0
  private dirtyCaptureHistory: { time: number; percent: number; bytes: number }[] = []
  private dirtyCaptureCount: number = 0
  
  // Transparency optimization tracking
  private lastTransparentSkipped: number = 0
  private lastTransparentSaved: number = 0
  private totalTransparentSkipped: number = 0
  private totalTransparentSaved: number = 0
  
  // Sprite batch data
  private spriteVertices: Float32Array
  private spriteVertexBuffer: GPUBuffer | null = null
  private spriteCount: number = 0
  private maxSprites: number = 1000
  
  // Size mode
  private sizeMode: CanvasSizeMode = { type: 'container' }
  private fixedWidth: number = 0
  private fixedHeight: number = 0
  
  // ==================== Diagnostics ====================
  private diagnosticsEnabled: boolean = true
  private frameStartTime: number = 0
  private cpuStartTime: number = 0
  private drawCallsThisFrame: number = 0
  private vertexCountThisFrame: number = 0
  
  // Saved values from last frame for diagnostics readout
  private lastDrawCalls: number = 0
  private lastVertexCount: number = 0
  private lastSpriteCount: number = 0
  private lastCpuTime: number = 0
  
  // FPS calculation
  private fpsFrameCount: number = 0
  private fpsLastUpdate: number = 0
  private currentFps: number = 0
  
  // Frame time history (for graphs)
  private frameTimeHistory: number[] = []
  private fpsHistory: number[] = []
  private readonly historyLength: number = 120 // 2 seconds at 60fps
  
  // GPU Timestamp not available without Chrome flag --enable-dawn-features=allow_unsafe_apis
  private supportsTimestamps: boolean = false
  private lastGpuTime: number | null = null
  
  // VRAM tracking
  private trackedBuffers: Map<string, { size: number; label: string }> = new Map()
  private trackedTextures: Map<string, { size: number; label: string; width: number; height: number }> = new Map()
  
  constructor(canvas: HTMLCanvasElement, sizeMode?: CanvasSizeMode) {
    this.canvas = canvas
    // 10 floats per vertex, 6 vertices per sprite
    this.spriteVertices = new Float32Array(this.maxSprites * 6 * 10)
    
    if (sizeMode) {
      this.setSizeMode(sizeMode)
    }
  }
  
  /**
   * Set canvas size mode
   */
  setSizeMode(mode: CanvasSizeMode): void {
    this.sizeMode = mode
    this.applySize()
  }
  
  /**
   * Get current size mode
   */
  getSizeMode(): CanvasSizeMode {
    return this.sizeMode
  }
  
  /**
   * Apply size based on current mode
   */
  private applySize(): void {
    let width: number
    let height: number
    const dpr = window.devicePixelRatio || 1
    
    switch (this.sizeMode.type) {
      case 'screen':
        // Full screen resolution
        width = screen.width * dpr
        height = screen.height * dpr
        break
        
      case 'window':
        // Browser window size
        width = window.innerWidth * dpr
        height = window.innerHeight * dpr
        break
        
      case 'fixed':
        // Fixed resolution (no DPR scaling - exact pixels)
        width = this.sizeMode.width
        height = this.sizeMode.height
        break
        
      case 'container':
      default:
        // Don't change - let external code handle it
        return
    }
    
    this.fixedWidth = width
    this.fixedHeight = height
    this.resize(width, height)
  }
  
  /**
   * Get the logical size (for widget positioning)
   */
  getLogicalSize(): { width: number; height: number } {
    return {
      width: this.canvas.width,
      height: this.canvas.height
    }
  }
  
  async initialize(): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.error('[Overlay] WebGPU not supported')
        return false
      }
      
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      })
      
      if (!this.adapter) {
        console.error('[Overlay] No WebGPU adapter found')
        return false
      }
      
      // Note: timestamp-query requires Chrome flag --enable-dawn-features=allow_unsafe_apis
      // We'll use CPU-based timing instead which is sufficient for diagnostics
      this.supportsTimestamps = false
      
      this.device = await this.adapter.requestDevice()
      
      this.context = this.canvas.getContext('webgpu')
      if (!this.context) {
        console.error('[Overlay] Failed to get WebGPU context')
        return false
      }
      
      this.format = navigator.gpu.getPreferredCanvasFormat()
      
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      })
      
      // Create uniform buffer
      this.uniformBuffer = this.device.createBuffer({
        label: 'Overlay Uniforms',
        size: 16, // vec2 resolution + float time + padding
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.trackBuffer('uniformBuffer', this.uniformBuffer, 16)
      
      // Create vertex buffer for sprite batching
      this.spriteVertexBuffer = this.device.createBuffer({
        label: 'Overlay Sprite Vertices',
        size: this.spriteVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
      this.trackBuffer('spriteVertexBuffer', this.spriteVertexBuffer, this.spriteVertices.byteLength)
      
      // Create pipelines
      await this.createPipelines()
      
      // Apply initial size mode
      if (this.sizeMode.type !== 'container') {
        this.applySize()
      }
      
      this.isInitialized = true
      console.log('[Overlay] Renderer initialized successfully')
      
      return true
    } catch (error) {
      console.error('[Overlay] Failed to initialize:', error)
      return false
    }
  }
  
  /**
   * Track buffer memory for diagnostics
   */
  private trackBuffer(id: string, buffer: GPUBuffer, size: number): void {
    this.trackedBuffers.set(id, { size, label: buffer.label || id })
  }
  
  /**
   * Track texture memory for diagnostics
   */
  trackTexture(id: string, texture: GPUTexture, width: number, height: number, bytesPerPixel: number = 4): void {
    const size = width * height * bytesPerPixel
    this.trackedTextures.set(id, { size, label: texture.label || id, width, height })
  }
  
  /**
   * Untrack texture (when destroyed)
   */
  untrackTexture(id: string): void {
    this.trackedTextures.delete(id)
  }
  
  private async createPipelines(): Promise<void> {
    if (!this.device) return
    
    const vertexBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 10 * 4, // 10 floats
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },    // position
        { shaderLocation: 1, offset: 8, format: 'float32x2' },    // uv
        { shaderLocation: 2, offset: 16, format: 'float32x4' },   // color
        { shaderLocation: 3, offset: 32, format: 'float32x2' },   // extra
      ],
    }
    
    // Sprite pipeline (no texture)
    const spriteShaderModule = this.device.createShaderModule({
      label: 'Overlay Sprite Shader',
      code: OVERLAY_SPRITE_SHADER,
    })
    
    const uniformBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Overlay Uniform Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    })
    
    this.uniformBindGroup = this.device.createBindGroup({
      label: 'Overlay Uniform Bind Group',
      layout: uniformBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
      ],
    })
    
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Overlay Pipeline Layout',
      bindGroupLayouts: [uniformBindGroupLayout],
    })
    
    this.spritePipeline = this.device.createRenderPipeline({
      label: 'Overlay Sprite Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: spriteShaderModule,
        entryPoint: 'vs_main',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: spriteShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })
    
    // Rounded rect pipeline (reuses sprite shader for now)
    const roundedRectShaderModule = this.device.createShaderModule({
      label: 'Overlay Rounded Rect Shader',
      code: OVERLAY_ROUNDED_RECT_SHADER,
    })
    
    this.roundedRectPipeline = this.device.createRenderPipeline({
      label: 'Overlay Rounded Rect Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: roundedRectShaderModule,
        entryPoint: 'vs_main',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: roundedRectShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })
    
    console.log('[Overlay] Pipelines created')
  }
  
  // ==================== Widget Management ====================
  
  /**
   * Get uniform bind group layout for widgets that need it
   */
  getUniformBindGroupLayout(): GPUBindGroupLayout | null {
    if (!this.device || !this.spritePipeline) return null
    return this.spritePipeline.getBindGroupLayout(0)
  }
  
  addWidget(widget: IWidget): void {
    this.widgets.set(widget.id, widget)
    console.log(`[Overlay] Widget added: ${widget.id}`)
  }
  
  removeWidget(id: string): void {
    const widget = this.widgets.get(id)
    if (widget) {
      widget.dispose()
      this.widgets.delete(id)
      console.log(`[Overlay] Widget removed: ${id}`)
    }
  }
  
  getWidget<T extends IWidget>(id: string): T | undefined {
    return this.widgets.get(id) as T | undefined
  }
  
  // ==================== Sprite Batching ====================
  
  beginBatch(): void {
    this.spriteCount = 0
  }
  
  addQuad(
    x: number, y: number, width: number, height: number,
    color: { r: number; g: number; b: number; a: number },
    glowIntensity: number = 0,
    u0: number = 0, v0: number = 0, u1: number = 1, v1: number = 1
  ): void {
    if (this.spriteCount >= this.maxSprites) {
      console.warn('[Overlay] Sprite batch overflow')
      return
    }
    
    const baseIndex = this.spriteCount * 6 * 10
    
    // Vertices: 2 triangles (6 vertices) per quad
    // Triangle 1: top-left, top-right, bottom-left
    // Triangle 2: top-right, bottom-right, bottom-left
    
    const vertices = [
      // Triangle 1
      { px: x, py: y, u: u0, v: v0 },                           // top-left
      { px: x + width, py: y, u: u1, v: v0 },                   // top-right
      { px: x, py: y + height, u: u0, v: v1 },                  // bottom-left
      // Triangle 2
      { px: x + width, py: y, u: u1, v: v0 },                   // top-right
      { px: x + width, py: y + height, u: u1, v: v1 },          // bottom-right
      { px: x, py: y + height, u: u0, v: v1 },                  // bottom-left
    ]
    
    for (let i = 0; i < 6; i++) {
      const vi = baseIndex + i * 10
      const v = vertices[i]
      this.spriteVertices[vi + 0] = v.px
      this.spriteVertices[vi + 1] = v.py
      this.spriteVertices[vi + 2] = v.u
      this.spriteVertices[vi + 3] = v.v
      this.spriteVertices[vi + 4] = color.r
      this.spriteVertices[vi + 5] = color.g
      this.spriteVertices[vi + 6] = color.b
      this.spriteVertices[vi + 7] = color.a
      this.spriteVertices[vi + 8] = glowIntensity
      this.spriteVertices[vi + 9] = 0
    }
    
    this.spriteCount++
  }
  
  addRoundedRect(
    x: number, y: number, width: number, height: number,
    color: { r: number; g: number; b: number; a: number },
    borderRadius: number = 8
  ): void {
    // Normalized border radius (relative to smaller dimension)
    const normalizedRadius = borderRadius / Math.min(width, height)
    this.addQuad(x, y, width, height, color, normalizedRadius)
  }
  
  endBatch(passEncoder: GPURenderPassEncoder, useRoundedRect: boolean = false): void {
    if (this.spriteCount === 0 || !this.device || !this.spriteVertexBuffer) return
    
    // Upload vertex data
    this.device.queue.writeBuffer(
      this.spriteVertexBuffer,
      0,
      this.spriteVertices.buffer,
      this.spriteVertices.byteOffset,
      this.spriteCount * 6 * 10 * 4
    )
    
    // Draw
    const pipeline = useRoundedRect ? this.roundedRectPipeline : this.spritePipeline
    if (!pipeline) return
    
    passEncoder.setPipeline(pipeline)
    passEncoder.setBindGroup(0, this.uniformBindGroup!)
    passEncoder.setVertexBuffer(0, this.spriteVertexBuffer)
    passEncoder.draw(this.spriteCount * 6)
    
    // Track draw call for diagnostics
    this.drawCallsThisFrame++
    this.vertexCountThisFrame += this.spriteCount * 6
  }
  
  // ==================== Render Loop ====================
  
  start(): void {
    if (!this.isInitialized) {
      console.error('[Overlay] Cannot start: not initialized')
      return
    }
    
    this.lastTime = performance.now()
    this.fpsLastUpdate = this.lastTime
    this.render()
  }
  
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }
  
  private render = (): void => {
    const currentTime = performance.now()
    const deltaTime = (currentTime - this.lastTime) / 1000
    this.lastTime = currentTime
    
    // Start frame timing
    this.frameStartTime = currentTime
    this.cpuStartTime = performance.now()
    
    // Reset per-frame counters
    this.drawCallsThisFrame = 0
    this.vertexCountThisFrame = 0
    this.spriteCount = 0
    
    if (!this.device || !this.context || !this.uniformBuffer) {
      this.animationFrameId = requestAnimationFrame(this.render)
      return
    }
    
    // Update uniform buffer
    const uniformData = new Float32Array([
      this.canvas.width,
      this.canvas.height,
      currentTime / 1000, // time in seconds
      0, // padding
    ])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData)
    
    // Get current texture
    const texture = this.context.getCurrentTexture()
    const textureView = texture.createView()
    
    // Create command encoder
    const encoder = this.device.createCommandEncoder({
      label: 'Overlay Render Encoder',
    })
    
    // Begin render pass
    const passEncoder = encoder.beginRenderPass({
      label: 'Overlay Render Pass',
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, // Transparent background
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    
    // Create render context for widgets
    const ctx: OverlayRenderContext = {
      device: this.device,
      encoder,
      passEncoder,
      format: this.format,
      canvasSize: { x: this.canvas.width, y: this.canvas.height },
      time: currentTime / 1000,
      deltaTime,
      trackDraw: (vertexCount: number, spriteCount: number = 1) => {
        this.drawCallsThisFrame++
        this.vertexCountThisFrame += vertexCount
        this.spriteCount += spriteCount
      },
      // @ts-ignore - internal extension for widgets
      uniformBindGroup: this.uniformBindGroup,
    }
    
    // Update and render widgets
    for (const widget of this.widgets.values()) {
      if (widget.config.visible) {
        widget.update(deltaTime)
        widget.render(ctx)
      }
    }
    
    // End render pass
    passEncoder.end()
    
    // Submit commands
    this.device.queue.submit([encoder.finish()])
    
    // Calculate CPU time (includes GPU submit, good approximation)
    const cpuEndTime = performance.now()
    const cpuTime = cpuEndTime - this.cpuStartTime
    
    // Update FPS counter
    this.fpsFrameCount++
    const fpsElapsed = currentTime - this.fpsLastUpdate
    if (fpsElapsed >= 1000) {
      this.currentFps = Math.round((this.fpsFrameCount * 1000) / fpsElapsed)
      this.fpsFrameCount = 0
      this.fpsLastUpdate = currentTime
      
      // Add to FPS history
      this.fpsHistory.push(this.currentFps)
      if (this.fpsHistory.length > this.historyLength) {
        this.fpsHistory.shift()
      }
    }
    
    // Add to frame time history
    const frameTime = currentTime - this.frameStartTime
    this.frameTimeHistory.push(frameTime)
    if (this.frameTimeHistory.length > this.historyLength) {
      this.frameTimeHistory.shift()
    }
    
    // Save diagnostics for this frame (so getDiagnostics returns accurate values)
    this.lastCpuTime = performance.now() - this.cpuStartTime
    this.lastDrawCalls = this.drawCallsThisFrame
    this.lastVertexCount = this.vertexCountThisFrame
    this.lastSpriteCount = this.spriteCount
    
    // Cache the frame immediately after render (before buffer is cleared)
    this.cacheCurrentFrame()
    
    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.render)
  }
  
  /**
   * Cache current frame for later capture
   * Must be called immediately after render, before WebGPU clears the buffer
   */
  private cacheCurrentFrame(): void {
    // Create cached canvas if needed or if size changed
    if (!this.cachedFrameCanvas || 
        this.cachedFrameCanvas.width !== this.canvas.width ||
        this.cachedFrameCanvas.height !== this.canvas.height) {
      this.cachedFrameCanvas = document.createElement('canvas')
      this.cachedFrameCanvas.width = this.canvas.width
      this.cachedFrameCanvas.height = this.canvas.height
      this.cachedFrameCtx = this.cachedFrameCanvas.getContext('2d', { willReadFrequently: true })
    }
    
    if (this.cachedFrameCtx) {
      this.cachedFrameCtx.drawImage(this.canvas, 0, 0)
    }
  }
  
  // ==================== Utility ====================
  
  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    
    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      })
    }
  }
  
  getDevice(): GPUDevice | null {
    return this.device
  }
  
  getFormat(): GPUTextureFormat {
    return this.format
  }
  
  getSpritePipeline(): GPURenderPipeline | null {
    return this.spritePipeline
  }
  
  getRoundedRectPipeline(): GPURenderPipeline | null {
    return this.roundedRectPipeline
  }
  
  getUniformBindGroup(): GPUBindGroup | null {
    return this.uniformBindGroup
  }
  
  // ==================== Diagnostics ====================
  
  /**
   * Enable or disable diagnostics collection
   */
  setDiagnosticsEnabled(enabled: boolean): void {
    this.diagnosticsEnabled = enabled
  }
  
  /**
   * Get comprehensive diagnostics data
   */
  getDiagnostics(): OverlayDiagnostics {
    // Calculate VRAM usage
    let bufferBytes = 0
    for (const buf of this.trackedBuffers.values()) {
      bufferBytes += buf.size
    }
    
    let textureBytes = 0
    for (const tex of this.trackedTextures.values()) {
      textureBytes += tex.size
    }
    
    // Count visible widgets
    let visibleCount = 0
    for (const widget of this.widgets.values()) {
      if (widget.config.visible) visibleCount++
    }
    
    // Get GPU info
    let gpuInfo: OverlayDiagnostics['gpuInfo'] = null
    if (this.adapter) {
      // Note: adapter.info might not be available in all browsers
      const info = (this.adapter as any).info
      gpuInfo = {
        vendor: info?.vendor || 'unknown',
        architecture: info?.architecture || 'unknown',
        device: info?.device || 'unknown',
        description: info?.description || 'unknown',
        features: Array.from(this.adapter.features),
        limits: this.getAdapterLimits(),
      }
    }
    
    // Calculate average frame time
    const avgFrameTime = this.frameTimeHistory.length > 0
      ? this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length
      : 0
    
    // Calculate dirty capture averages
    const avgCaptureTime = this.dirtyCaptureHistory.length > 0
      ? this.dirtyCaptureHistory.reduce((a, b) => a + b.time, 0) / this.dirtyCaptureHistory.length
      : 0
    const avgDirtyPercent = this.dirtyCaptureHistory.length > 0
      ? this.dirtyCaptureHistory.reduce((a, b) => a + b.percent, 0) / this.dirtyCaptureHistory.length
      : 0
    const avgBytesPerCapture = this.dirtyCaptureHistory.length > 0
      ? this.dirtyCaptureHistory.reduce((a, b) => a + b.bytes, 0) / this.dirtyCaptureHistory.length
      : 0
    
    // Calculate dirty tile grid info
    const tilesX = this.canvas.width > 0 ? Math.ceil(this.canvas.width / this.dirtyTileSize) : 0
    const tilesY = this.canvas.height > 0 ? Math.ceil(this.canvas.height / this.dirtyTileSize) : 0
    
    return {
      // FPS & Timing
      fps: this.currentFps,
      frameTime: avgFrameTime,
      cpuTime: this.lastCpuTime,
      gpuTime: this.lastGpuTime,
      
      // Draw statistics (use saved values from last completed frame)
      drawCalls: this.lastDrawCalls,
      vertexCount: this.lastVertexCount,
      triangleCount: Math.floor(this.lastVertexCount / 3),
      spriteCount: this.lastSpriteCount,
      
      // Memory usage
      vramUsage: {
        buffers: bufferBytes,
        textures: textureBytes,
        total: bufferBytes + textureBytes,
      },
      
      // Resources
      widgetCount: this.widgets.size,
      visibleWidgetCount: visibleCount,
      textureCount: this.trackedTextures.size,
      pipelineCount: [this.spritePipeline, this.texturePipeline, this.roundedRectPipeline].filter(Boolean).length,
      
      // GPU Info
      gpuInfo,
      
      // History
      frameTimeHistory: [...this.frameTimeHistory],
      fpsHistory: [...this.fpsHistory],
      
      // Dirty capture diagnostics
      dirtyCapture: {
        enabled: this.dirtyCaptureEnabled,
        tileSize: this.dirtyTileSize,
        tilesX,
        tilesY,
        totalTiles: tilesX * tilesY,
        
        // Memory: previous frame storage
        previousFrameMemory: this.previousFrameData?.byteLength ?? 0,
        
        // Last capture stats
        lastCaptureTime: this.lastDirtyCaptureTime,
        lastCompareTime: this.lastDirtyCompareTime,
        lastExtractTime: this.lastDirtyExtractTime,
        lastDirtyCount: this.lastDirtyCount,
        lastDirtyPercent: this.lastDirtyPercent,
        lastTotalBytes: this.lastDirtyBytes,
        
        // Rolling averages
        avgCaptureTime,
        avgDirtyPercent,
        avgBytesPerCapture,
        captureCount: this.dirtyCaptureCount,
        
        // Transparency optimization stats
        lastTransparentSkipped: this.lastTransparentSkipped,
        lastTransparentSaved: this.lastTransparentSaved,
        totalTransparentSkipped: this.totalTransparentSkipped,
        totalTransparentSaved: this.totalTransparentSaved,
      },
    }
  }
  
  /**
   * Get adapter limits as a record
   */
  private getAdapterLimits(): Record<string, number> {
    if (!this.adapter) return {}
    
    const limits = this.adapter.limits
    return {
      maxTextureDimension1D: limits.maxTextureDimension1D,
      maxTextureDimension2D: limits.maxTextureDimension2D,
      maxTextureDimension3D: limits.maxTextureDimension3D,
      maxTextureArrayLayers: limits.maxTextureArrayLayers,
      maxBindGroups: limits.maxBindGroups,
      maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
      maxBufferSize: limits.maxBufferSize,
      maxVertexBuffers: limits.maxVertexBuffers,
      maxVertexAttributes: limits.maxVertexAttributes,
      maxVertexBufferArrayStride: limits.maxVertexBufferArrayStride,
      maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
      maxComputeWorkgroupSizeZ: limits.maxComputeWorkgroupSizeZ,
    }
  }
  
  /**
   * Get tracked textures info
   */
  getTextureInfo(): Array<{ id: string; label: string; width: number; height: number; size: number }> {
    return Array.from(this.trackedTextures.entries()).map(([id, tex]) => ({
      id,
      label: tex.label,
      width: tex.width,
      height: tex.height,
      size: tex.size,
    }))
  }
  
  /**
   * Get tracked buffers info
   */
  getBufferInfo(): Array<{ id: string; label: string; size: number }> {
    return Array.from(this.trackedBuffers.entries()).map(([id, buf]) => ({
      id,
      label: buf.label,
      size: buf.size,
    }))
  }

  // ==================== Frame Capture ====================
  
  /**
   * Supported image formats for frame capture
   */
  static readonly CAPTURE_FORMATS = ['image/png', 'image/jpeg', 'image/webp'] as const
  
  /**
   * Get raw RGBA pixel data as ArrayBuffer
   * This is the fastest method for transferring to native code (GDI+, DirectX, etc.)
   * 
   * @returns Promise with RGBA ArrayBuffer and dimensions
   */
  async captureRawFrame(): Promise<{
    data: ArrayBuffer
    width: number
    height: number
    format: 'rgba8'
  }> {
    // Use cached frame for consistent results
    const { data, width, height } = this.captureFullCanvasData()
    
    // Copy to new ArrayBuffer to avoid SharedArrayBuffer issues
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    
    return {
      data: buffer,
      width,
      height,
      format: 'rgba8'
    }
  }
  
  /**
   * Get frame as Blob (PNG, JPEG, or WebP)
   * 
   * @param type - MIME type: 'image/png', 'image/jpeg', 'image/webp'
   * @param quality - Quality for JPEG/WebP (0-1), ignored for PNG
   */
  async captureBlob(
    type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
    quality: number = 0.92
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to capture frame as blob'))
          }
        },
        type,
        quality
      )
    })
  }
  
  /**
   * Get frame as base64 DataURL
   * Useful for embedding in HTML or sending as string
   * 
   * @param type - MIME type
   * @param quality - Quality for JPEG/WebP
   */
  captureDataURL(
    type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
    quality: number = 0.92
  ): string {
    return this.canvas.toDataURL(type, quality)
  }
  
  /**
   * Get frame as ImageBitmap (for fast transfer between canvases/workers)
   */
  async captureImageBitmap(): Promise<ImageBitmap> {
    return createImageBitmap(this.canvas)
  }
  
  /**
   * Get frame as Uint8Array (raw RGBA bytes)
   * Convenient for direct memory access
   */
  async captureBytes(): Promise<{
    bytes: Uint8Array
    width: number
    height: number
  }> {
    const { data, width, height } = await this.captureRawFrame()
    return {
      bytes: new Uint8Array(data),
      width,
      height
    }
  }
  
  /**
   * Get frame info without capturing
   */
  getFrameInfo(): {
    width: number
    height: number
    bytesPerPixel: number
    totalBytes: number
  } {
    const width = this.canvas.width
    const height = this.canvas.height
    return {
      width,
      height,
      bytesPerPixel: 4, // RGBA
      totalBytes: width * height * 4
    }
  }
  
  /**
   * Capture frame and invoke callback (for continuous streaming)
   * 
   * @param callback - Called with each frame
   * @param format - Output format
   * @param fps - Target FPS for capture (default: 30)
   * @returns Stop function
   */
  startFrameCapture(
    callback: (frame: { data: ArrayBuffer; width: number; height: number; timestamp: number }) => void,
    fps: number = 30
  ): () => void {
    let isCapturing = true
    const interval = 1000 / fps
    let lastCapture = 0
    
    const captureLoop = async () => {
      if (!isCapturing) return
      
      const now = performance.now()
      if (now - lastCapture >= interval) {
        lastCapture = now
        
        try {
          const { data, width, height } = await this.captureRawFrame()
          callback({ data, width, height, timestamp: now })
        } catch (e) {
          console.error('[Overlay] Frame capture error:', e)
        }
      }
      
      requestAnimationFrame(captureLoop)
    }
    
    captureLoop()
    
    return () => {
      isCapturing = false
    }
  }

  // ==================== Fragment Capture (Efficient) ====================
  
  /**
   * Helper: Get full canvas pixel data from cached frame
   * Uses cached frame that was captured right after render
   */
  private captureFullCanvasData(): { 
    data: Uint8ClampedArray
    width: number 
    height: number 
  } {
    // Use cached frame (captured immediately after render)
    if (this.cachedFrameCanvas && this.cachedFrameCtx) {
      const width = this.cachedFrameCanvas.width
      const height = this.cachedFrameCanvas.height
      const imageData = this.cachedFrameCtx.getImageData(0, 0, width, height)
      
      return { 
        data: imageData.data, 
        width, 
        height 
      }
    }
    
    // Fallback: try to read directly (may return empty data)
    const width = this.canvas.width
    const height = this.canvas.height
    
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = width
    tempCanvas.height = height
    const ctx = tempCanvas.getContext('2d', { willReadFrequently: true })!
    
    ctx.drawImage(this.canvas, 0, 0)
    const imageData = ctx.getImageData(0, 0, width, height)
    
    return { 
      data: imageData.data, 
      width, 
      height 
    }
  }
  
  /**
   * Extract a region from full canvas data (in memory, no additional canvas ops)
   */
  private extractRegion(
    fullData: Uint8ClampedArray,
    fullWidth: number,
    regionX: number,
    regionY: number,
    regionWidth: number,
    regionHeight: number
  ): Uint8Array {
    const result = new Uint8Array(regionWidth * regionHeight * 4)
    
    for (let y = 0; y < regionHeight; y++) {
      const srcOffset = ((regionY + y) * fullWidth + regionX) * 4
      const dstOffset = y * regionWidth * 4
      
      // Copy one row at a time
      for (let x = 0; x < regionWidth * 4; x++) {
        result[dstOffset + x] = fullData[srcOffset + x]
      }
    }
    
    return result
  }
  
  /**
   * Capture only widget regions instead of full frame
   * Much more efficient for overlay transfer to GDI+
   * 
   * For 4K screen with small widget: ~10KB vs ~33MB for full frame
   */
  async captureFragments(): Promise<FragmentCapture> {
    const timestamp = performance.now()
    const regions: CapturedRegion[] = []
    let totalBytes = 0
    
    // Read entire canvas once
    const { data: fullData, width: fullWidth, height: fullHeight } = this.captureFullCanvasData()
    
    for (const widget of this.widgets.values()) {
      if (!widget.config.visible) continue
      
      const { position, size } = widget.config
      
      // Add padding for glow effects
      const padding = 10
      const x = Math.max(0, Math.floor(position.x - padding))
      const y = Math.max(0, Math.floor(position.y - padding))
      const width = Math.min(fullWidth - x, Math.ceil(size.x + padding * 2))
      const height = Math.min(fullHeight - y, Math.ceil(size.y + padding * 2))
      
      if (width <= 0 || height <= 0) continue
      
      // Extract region from full canvas data (memory operation, fast)
      const data = this.extractRegion(fullData, fullWidth, x, y, width, height)
      
      regions.push({
        x,
        y,
        width,
        height,
        data,
        widgetId: widget.id,
        dirty: true
      })
      
      totalBytes += data.length
    }
    
    return {
      timestamp,
      screenWidth: fullWidth,
      screenHeight: fullHeight,
      regions,
      totalBytes
    }
  }
  
  /**
   * Capture single widget region
   */
  async captureWidgetRegion(widgetId: string): Promise<CapturedRegion | null> {
    const widget = this.widgets.get(widgetId)
    if (!widget || !widget.config.visible) return null
    
    const { position, size } = widget.config
    
    const padding = 10
    const x = Math.max(0, Math.floor(position.x - padding))
    const y = Math.max(0, Math.floor(position.y - padding))
    const width = Math.min(this.canvas.width - x, Math.ceil(size.x + padding * 2))
    const height = Math.min(this.canvas.height - y, Math.ceil(size.y + padding * 2))
    
    if (width <= 0 || height <= 0) return null
    
    // Read full canvas and extract region
    const { data: fullData, width: fullWidth } = this.captureFullCanvasData()
    const data = this.extractRegion(fullData, fullWidth, x, y, width, height)
    
    return {
      x,
      y,
      width,
      height,
      data,
      widgetId,
      dirty: true
    }
  }
  
  /**
   * Get combined bounding box of all visible widgets
   */
  getVisibleBounds(): { x: number; y: number; width: number; height: number } | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    
    for (const widget of this.widgets.values()) {
      if (!widget.config.visible) continue
      
      const { position, size } = widget.config
      minX = Math.min(minX, position.x)
      minY = Math.min(minY, position.y)
      maxX = Math.max(maxX, position.x + size.x)
      maxY = Math.max(maxY, position.y + size.y)
    }
    
    if (minX === Infinity) return null
    
    // Add padding
    const padding = 10
    return {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(this.canvas.width, maxX - minX + padding * 2),
      height: Math.min(this.canvas.height, maxY - minY + padding * 2)
    }
  }
  
  /**
   * Capture only the area containing all widgets (combined bounding box)
   * Even more efficient when widgets are close together
   */
  async captureCombinedRegion(): Promise<{
    x: number
    y: number
    width: number
    height: number
    data: Uint8Array
    timestamp: number
  } | null> {
    const bounds = this.getVisibleBounds()
    if (!bounds) return null
    
    const { x, y, width, height } = bounds
    
    // Read full canvas and extract region
    const { data: fullData, width: fullWidth } = this.captureFullCanvasData()
    const data = this.extractRegion(fullData, fullWidth, x, y, width, height)
    
    return {
      x,
      y,
      width,
      height,
      data,
      timestamp: performance.now()
    }
  }
  
  /**
   * Start continuous fragment capture (efficient streaming)
   * 
   * @param callback - Called with fragment data
   * @param fps - Target FPS
   * @returns Stop function
   */
  startFragmentCapture(
    callback: (capture: FragmentCapture) => void,
    fps: number = 30
  ): () => void {
    let isCapturing = true
    const interval = 1000 / fps
    let lastCapture = 0
    
    const captureLoop = async () => {
      if (!isCapturing) return
      
      const now = performance.now()
      if (now - lastCapture >= interval) {
        lastCapture = now
        
        try {
          const capture = await this.captureFragments()
          callback(capture)
        } catch (e) {
          console.error('[Overlay] Fragment capture error:', e)
        }
      }
      
      requestAnimationFrame(captureLoop)
    }
    
    captureLoop()
    
    return () => {
      isCapturing = false
    }
  }

  // ==================== Dirty Tile Rendering ====================

  /**
   * Set the tile size for dirty rendering
   * Smaller tiles = more granular updates but more overhead
   * Larger tiles = less granular but more efficient comparison
   * @param size Tile size in pixels (default 32)
   */
  setDirtyTileSize(size: number): void {
    this.dirtyTileSize = Math.max(8, Math.min(256, size))
    // Reset previous frame to force full refresh
    this.previousFrameData = null
  }

  /**
   * Get current dirty tile size
   */
  getDirtyTileSize(): number {
    return this.dirtyTileSize
  }

  /**
   * Force a full refresh on next dirty capture
   */
  invalidateFrame(): void {
    this.previousFrameData = null
  }

  /**
   * Capture only the tiles that have changed since the last frame
   * This is the most efficient method for streaming to an external overlay
   * 
   * @returns DirtyCapture with only changed tiles
   */
  captureDirtyTiles(): DirtyCapture {
    const captureStartTime = performance.now()
    this.dirtyCaptureEnabled = true
    
    const { data: currentData, width, height } = this.captureFullCanvasData()
    
    const tileSize = this.dirtyTileSize
    const tilesX = Math.ceil(width / tileSize)
    const tilesY = Math.ceil(height / tileSize)
    const totalTiles = tilesX * tilesY
    
    const dirtyTiles: DirtyTile[] = []
    let fullRefresh = false
    
    // Check if we need a full refresh (first frame or size changed)
    if (!this.previousFrameData || 
        this.previousFrameWidth !== width || 
        this.previousFrameHeight !== height) {
      fullRefresh = true
    }
    
    // Time comparison phase
    const compareStartTime = performance.now()
    
    // Compare each tile and mark dirty ones
    const dirtyFlags: boolean[][] = []
    for (let ty = 0; ty < tilesY; ty++) {
      dirtyFlags[ty] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileX = tx * tileSize
        const tileY = ty * tileSize
        const tileW = Math.min(tileSize, width - tileX)
        const tileH = Math.min(tileSize, height - tileY)
        
        dirtyFlags[ty][tx] = fullRefresh || this.isTileDirty(
          currentData, this.previousFrameData!,
          width, tileX, tileY, tileW, tileH
        )
      }
    }
    
    const compareEndTime = performance.now()
    this.lastDirtyCompareTime = compareEndTime - compareStartTime
    
    // Time extraction phase
    const extractStartTime = performance.now()
    
    // Determine tile types: 0 = clean (not dirty), 1 = content, 2 = transparent
    const tileTypes: number[][] = []
    for (let ty = 0; ty < tilesY; ty++) {
      tileTypes[ty] = []
      for (let tx = 0; tx < tilesX; tx++) {
        if (!dirtyFlags[ty][tx]) {
          tileTypes[ty][tx] = 0 // Not dirty
        } else {
          const tileX = tx * tileSize
          const tileY = ty * tileSize
          const tileW = Math.min(tileSize, width - tileX)
          const tileH = Math.min(tileSize, height - tileY)
          
          const isTransparent = this.isTileTransparent(currentData, width, tileX, tileY, tileW, tileH)
          tileTypes[ty][tx] = isTransparent ? 2 : 1
        }
      }
    }
    
    // Greedy meshing: merge adjacent tiles of the same type into larger rectangles
    const visited: boolean[][] = []
    for (let ty = 0; ty < tilesY; ty++) {
      visited[ty] = new Array(tilesX).fill(false)
    }
    
    // Extract dirty tile data with merging
    let transparentTiles = 0
    let transparentSaved = 0
    let mergedRects = 0
    let originalTileCount = 0
    
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileType = tileTypes[ty][tx]
        if (tileType === 0 || visited[ty][tx]) continue
        
        originalTileCount++
        
        // Find max width we can extend to (same type, not visited)
        let maxW = 1
        while (tx + maxW < tilesX && 
               tileTypes[ty][tx + maxW] === tileType && 
               !visited[ty][tx + maxW]) {
          maxW++
        }
        
        // Find max height we can extend to (all tiles in row must be same type)
        let maxH = 1
        outer: while (ty + maxH < tilesY) {
          for (let dx = 0; dx < maxW; dx++) {
            if (tileTypes[ty + maxH][tx + dx] !== tileType || visited[ty + maxH][tx + dx]) {
              break outer
            }
          }
          maxH++
        }
        
        // Mark all tiles in this rect as visited
        for (let dy = 0; dy < maxH; dy++) {
          for (let dx = 0; dx < maxW; dx++) {
            visited[ty + dy][tx + dx] = true
            if (dx > 0 || dy > 0) originalTileCount++ // Count merged tiles
          }
        }
        
        // Calculate pixel coordinates
        const rectX = tx * tileSize
        const rectY = ty * tileSize
        const rectW = Math.min(maxW * tileSize, width - rectX)
        const rectH = Math.min(maxH * tileSize, height - rectY)
        
        mergedRects++
        
        if (tileType === 2) {
          // Transparent - send empty data
          transparentTiles += maxW * maxH
          transparentSaved += rectW * rectH * 4
          
          dirtyTiles.push({
            tileX: tx,
            tileY: ty,
            x: rectX,
            y: rectY,
            width: rectW,
            height: rectH,
            data: new Uint8Array(0)
          })
        } else {
          // Content - extract merged region data
          const tileData = this.extractTileData(currentData, width, rectX, rectY, rectW, rectH)
          
          dirtyTiles.push({
            tileX: tx,
            tileY: ty,
            x: rectX,
            y: rectY,
            width: rectW,
            height: rectH,
            data: tileData
          })
        }
      }
    }
    
    // Log merge efficiency (debug)
    if (originalTileCount > mergedRects) {
      console.debug(`[Overlay] Tile merge: ${originalTileCount} -> ${mergedRects} (${Math.round((1 - mergedRects/originalTileCount) * 100)}% reduction)`)
    }
    
    const extractEndTime = performance.now()
    this.lastDirtyExtractTime = extractEndTime - extractStartTime
    
    // Store current frame for next comparison
    this.previousFrameData = currentData
    this.previousFrameWidth = width
    this.previousFrameHeight = height
    
    // Calculate total bytes
    let totalBytes = 0
    for (const tile of dirtyTiles) {
      totalBytes += tile.data.length
    }
    
    const dirtyPercent = totalTiles > 0 ? (dirtyTiles.length / totalTiles) * 100 : 0
    const totalCaptureTime = performance.now() - captureStartTime
    
    // Update diagnostics
    this.lastDirtyCaptureTime = totalCaptureTime
    this.lastDirtyCount = dirtyTiles.length
    this.lastDirtyPercent = dirtyPercent
    this.lastDirtyBytes = totalBytes
    this.dirtyCaptureCount++
    
    // Update transparency stats
    this.lastTransparentSkipped = transparentTiles
    this.lastTransparentSaved = transparentSaved
    this.totalTransparentSkipped += transparentTiles
    this.totalTransparentSaved += transparentSaved
    
    // Add to rolling history (keep last 60 samples)
    this.dirtyCaptureHistory.push({
      time: totalCaptureTime,
      percent: dirtyPercent,
      bytes: totalBytes
    })
    if (this.dirtyCaptureHistory.length > 60) {
      this.dirtyCaptureHistory.shift()
    }
    
    return {
      timestamp: captureStartTime,
      screenWidth: width,
      screenHeight: height,
      tileSize,
      tilesX,
      tilesY,
      dirtyTiles,
      dirtyCount: dirtyTiles.length,
      totalTiles,
      dirtyPercent,
      totalBytes,
      fullRefresh,
      transparentSkipped: transparentTiles,
      transparentSaved
    }
  }

  /**
   * Compare a tile between current and previous frame
   * Uses a fast early-exit comparison
   */
  private isTileDirty(
    current: Uint8ClampedArray,
    previous: Uint8ClampedArray,
    stride: number,
    tileX: number,
    tileY: number,
    tileW: number,
    tileH: number
  ): boolean {
    const bytesPerPixel = 4
    const rowBytes = stride * bytesPerPixel
    
    // Sample a few pixels first for fast rejection
    // Check corners and center
    const checkPoints = [
      [0, 0],
      [tileW - 1, 0],
      [0, tileH - 1],
      [tileW - 1, tileH - 1],
      [Math.floor(tileW / 2), Math.floor(tileH / 2)]
    ]
    
    for (const [dx, dy] of checkPoints) {
      const x = tileX + dx
      const y = tileY + dy
      if (x >= stride) continue
      
      const idx = y * rowBytes + x * bytesPerPixel
      if (idx + 3 >= current.length) continue
      
      if (current[idx] !== previous[idx] ||
          current[idx + 1] !== previous[idx + 1] ||
          current[idx + 2] !== previous[idx + 2] ||
          current[idx + 3] !== previous[idx + 3]) {
        return true
      }
    }
    
    // If sample points matched, do full comparison
    // (This catches gradual changes that might not hit sample points)
    for (let dy = 0; dy < tileH; dy++) {
      const y = tileY + dy
      const rowStart = y * rowBytes + tileX * bytesPerPixel
      const rowEnd = rowStart + tileW * bytesPerPixel
      
      for (let i = rowStart; i < rowEnd; i++) {
        if (current[i] !== previous[i]) {
          return true
        }
      }
    }
    
    return false
  }

  /**
   * Extract a tile's pixel data as Uint8Array
   */
  private extractTileData(
    source: Uint8ClampedArray,
    stride: number,
    tileX: number,
    tileY: number,
    tileW: number,
    tileH: number
  ): Uint8Array {
    const bytesPerPixel = 4
    const data = new Uint8Array(tileW * tileH * bytesPerPixel)
    const sourceRowBytes = stride * bytesPerPixel
    const destRowBytes = tileW * bytesPerPixel
    
    for (let dy = 0; dy < tileH; dy++) {
      const srcStart = (tileY + dy) * sourceRowBytes + tileX * bytesPerPixel
      const dstStart = dy * destRowBytes
      
      for (let i = 0; i < destRowBytes; i++) {
        data[dstStart + i] = source[srcStart + i]
      }
    }
    
    return data
  }

  /**
   * Fast check if a tile is fully transparent using sampling
   * Checks 16 strategic points (4x4 grid) - O(1) instead of O(n²)
   * 
   * @returns true if tile appears to be fully transparent
   */
  private isTileTransparent(
    data: Uint8ClampedArray,
    stride: number,
    tileX: number,
    tileY: number,
    tileW: number,
    tileH: number
  ): boolean {
    const bytesPerPixel = 4
    const rowBytes = stride * bytesPerPixel
    
    // Sample 16 points in a 4x4 grid pattern
    // This catches most non-transparent content while being very fast
    const stepX = Math.max(1, Math.floor(tileW / 4))
    const stepY = Math.max(1, Math.floor(tileH / 4))
    
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const dx = Math.min(gx * stepX, tileW - 1)
        const dy = Math.min(gy * stepY, tileH - 1)
        
        const x = tileX + dx
        const y = tileY + dy
        
        // Check alpha channel (offset +3 in RGBA)
        const idx = y * rowBytes + x * bytesPerPixel + 3
        if (idx < data.length && data[idx] > 0) {
          return false // Found non-transparent pixel
        }
      }
    }
    
    // All 16 sample points were transparent
    // For extra safety, also check the center point
    const centerX = tileX + Math.floor(tileW / 2)
    const centerY = tileY + Math.floor(tileH / 2)
    const centerIdx = centerY * rowBytes + centerX * bytesPerPixel + 3
    if (centerIdx < data.length && data[centerIdx] > 0) {
      return false
    }
    
    return true
  }

  /**
   * Start continuous dirty tile capture (most efficient streaming method)
   * Only sends changed tiles at the specified FPS
   * 
   * @param callback - Called with dirty capture data
   * @param fps - Target capture FPS (default 30)
   * @param skipUnchanged - Skip callback if no tiles changed (default true)
   * @returns Stop function
   */
  startDirtyCapture(
    callback: (capture: DirtyCapture) => void,
    fps: number = 30,
    skipUnchanged: boolean = true
  ): () => void {
    let isCapturing = true
    const interval = 1000 / fps
    let lastCapture = 0
    
    const captureLoop = () => {
      if (!isCapturing) return
      
      const now = performance.now()
      if (now - lastCapture >= interval) {
        lastCapture = now
        
        try {
          const capture = this.captureDirtyTiles()
          
          // Skip callback if no changes and skipUnchanged is true
          if (!skipUnchanged || capture.dirtyCount > 0) {
            callback(capture)
          }
        } catch (e) {
          console.error('[Overlay] Dirty capture error:', e)
        }
      }
      
      requestAnimationFrame(captureLoop)
    }
    
    captureLoop()
    
    return () => {
      isCapturing = false
    }
  }

  /**
   * Get statistics about dirty rendering efficiency
   * Useful for tuning tile size
   */
  getDirtyStats(): {
    tileSize: number
    averageDirtyPercent: number
    lastDirtyCount: number
    lastTotalTiles: number
    recommendation: string
  } {
    // Capture current state
    const capture = this.captureDirtyTiles()
    
    let recommendation = 'Current settings are optimal'
    if (capture.dirtyPercent > 50) {
      recommendation = 'High dirty percentage - consider larger tile size or lower FPS'
    } else if (capture.dirtyPercent < 5 && capture.dirtyCount > 0) {
      recommendation = 'Low dirty percentage - consider smaller tile size for finer updates'
    }
    
    return {
      tileSize: this.dirtyTileSize,
      averageDirtyPercent: capture.dirtyPercent,
      lastDirtyCount: capture.dirtyCount,
      lastTotalTiles: capture.totalTiles,
      recommendation
    }
  }

  /**
   * Get init config for native overlay controller
   */
  getInitConfig(): { width: number; height: number; tileSize: number; tilesX: number; tilesY: number } {
    const width = this.canvas.width
    const height = this.canvas.height
    const tileSize = this.dirtyTileSize
    const tilesX = Math.ceil(width / tileSize)
    const tilesY = Math.ceil(height / tileSize)
    
    return { width, height, tileSize, tilesX, tilesY }
  }

  dispose(): void {
    this.stop()
    
    for (const widget of this.widgets.values()) {
      widget.dispose()
    }
    this.widgets.clear()
    
    this.spriteVertexBuffer?.destroy()
    this.uniformBuffer?.destroy()
    
    // Clean up dirty rendering state
    this.previousFrameData = null
    
    this.device?.destroy()
    
    this.isInitialized = false
    console.log('[Overlay] Renderer disposed')
  }
}
