/**
 * Text Renderer for WebGPU Overlay
 * Uses 2D canvas to render text to texture, then draws in WebGPU
 */

import type { Color } from './types'

interface TextCacheEntry {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
  timestamp: number
}

export interface TextStyle {
  fontSize: number
  fontFamily: string
  fontWeight: string
  color: Color
  maxWidth?: number
}

const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 14,
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontWeight: '500',
  color: { r: 1, g: 1, b: 1, a: 1 },
}

export class TextRenderer {
  private device: GPUDevice
  private textCache: Map<string, TextCacheEntry> = new Map()
  private canvas2d: HTMLCanvasElement
  private ctx2d: CanvasRenderingContext2D
  
  // Texture pipeline components
  private pipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler | null = null
  private uniformBuffer: GPUBuffer | null = null
  
  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device
    
    // Create 2D canvas for text rendering
    this.canvas2d = document.createElement('canvas')
    this.ctx2d = this.canvas2d.getContext('2d', { willReadFrequently: true })!
    
    this.createPipeline(format)
  }
  
  private createPipeline(format: GPUTextureFormat): void {
    const shaderCode = /* wgsl */ `
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
      }
      
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(1) @binding(0) var textureSampler: sampler;
      @group(1) @binding(1) var textureData: texture_2d<f32>;
      
      @vertex
      fn vs_main(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        
        let clipX = (input.position.x / uniforms.resolution.x) * 2.0 - 1.0;
        let clipY = 1.0 - (input.position.y / uniforms.resolution.y) * 2.0;
        
        output.position = vec4f(clipX, clipY, 0.0, 1.0);
        output.uv = input.uv;
        output.color = input.color;
        
        return output;
      }
      
      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4f {
        let texColor = textureSample(textureData, textureSampler, input.uv);
        return texColor * input.color;
      }
    `
    
    const shaderModule = this.device.createShaderModule({
      label: 'Text Shader',
      code: shaderCode,
    })
    
    // Uniform bind group layout
    const uniformBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Text Uniform Layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    })
    
    // Texture bind group layout
    const textureBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Text Texture Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    })
    
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Text Pipeline Layout',
      bindGroupLayouts: [uniformBindGroupLayout, textureBindGroupLayout],
    })
    
    this.pipeline = this.device.createRenderPipeline({
      label: 'Text Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x4' },
            { shaderLocation: 3, offset: 32, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
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
    
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })
    
    this.uniformBuffer = this.device.createBuffer({
      label: 'Text Uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }
  
  /**
   * Measure text dimensions without creating texture
   */
  measureText(text: string, style: Partial<TextStyle> = {}): { width: number; height: number } {
    const fullStyle = { ...DEFAULT_TEXT_STYLE, ...style }
    
    this.ctx2d.font = `${fullStyle.fontWeight} ${fullStyle.fontSize}px ${fullStyle.fontFamily}`
    const metrics = this.ctx2d.measureText(text)
    
    return {
      width: Math.ceil(metrics.width),
      height: Math.ceil(fullStyle.fontSize * 1.2),
    }
  }
  
  /**
   * Get or create text texture (with caching)
   */
  getTextTexture(text: string, style: Partial<TextStyle> = {}): TextCacheEntry {
    const fullStyle = { ...DEFAULT_TEXT_STYLE, ...style }
    const cacheKey = `${text}_${fullStyle.fontSize}_${fullStyle.fontWeight}_${fullStyle.fontFamily}`
    
    const cached = this.textCache.get(cacheKey)
    if (cached) {
      cached.timestamp = Date.now()
      return cached
    }
    
    // Measure and render text
    const dpr = window.devicePixelRatio || 1
    this.ctx2d.font = `${fullStyle.fontWeight} ${fullStyle.fontSize * dpr}px ${fullStyle.fontFamily}`
    const metrics = this.ctx2d.measureText(text)
    
    const width = Math.ceil(metrics.width / dpr) + 4 // padding
    const height = Math.ceil(fullStyle.fontSize * 1.4)
    
    // Resize canvas
    this.canvas2d.width = width * dpr
    this.canvas2d.height = height * dpr
    
    // Clear and draw text
    this.ctx2d.clearRect(0, 0, this.canvas2d.width, this.canvas2d.height)
    this.ctx2d.font = `${fullStyle.fontWeight} ${fullStyle.fontSize * dpr}px ${fullStyle.fontFamily}`
    this.ctx2d.fillStyle = 'white' // We'll multiply by color in shader
    this.ctx2d.textBaseline = 'middle'
    this.ctx2d.fillText(text, 2 * dpr, (height * dpr) / 2)
    
    // Create texture from canvas
    const imageData = this.ctx2d.getImageData(0, 0, this.canvas2d.width, this.canvas2d.height)
    
    const texture = this.device.createTexture({
      label: `Text: ${text.substring(0, 20)}`,
      size: [this.canvas2d.width, this.canvas2d.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    
    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: this.canvas2d.width * 4 },
      { width: this.canvas2d.width, height: this.canvas2d.height }
    )
    
    const entry: TextCacheEntry = {
      texture,
      view: texture.createView(),
      width,
      height,
      timestamp: Date.now(),
    }
    
    this.textCache.set(cacheKey, entry)
    
    return entry
  }
  
  /**
   * Create bind group for text texture
   */
  createTextureBindGroup(textureView: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Text Texture Bind Group',
      layout: this.pipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: textureView },
      ],
    })
  }
  
  /**
   * Clear old cache entries (older than maxAge ms)
   */
  clearOldCache(maxAge: number = 60000): void {
    const now = Date.now()
    for (const [key, entry] of this.textCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        entry.texture.destroy()
        this.textCache.delete(key)
      }
    }
  }
  
  dispose(): void {
    for (const entry of this.textCache.values()) {
      entry.texture.destroy()
    }
    this.textCache.clear()
    this.uniformBuffer?.destroy()
  }
}
