/**
 * Voice Members Widget
 * Displays list of voice channel members with speaking indicators
 */

import { BaseWidget } from './BaseWidget'
import type { OverlayRenderContext, VoiceMember, Vec2, Color } from './types'
import { Colors } from './types'

interface MemberAnimation {
  speakingGlow: number // 0-1, current glow intensity
  targetGlow: number   // target glow intensity
}

// Layout constants
const LAYOUT = {
  padding: 12,
  itemHeight: 44,
  itemSpacing: 6,
  avatarSize: 32,
  avatarMarginRight: 10,
  borderRadius: 12,
  itemBorderRadius: 8,
  statusIconSize: 16,
  statusIconMargin: 6,
} as const

export class VoiceMembersWidget extends BaseWidget {
  private members: VoiceMember[] = []
  private animations: Map<string, MemberAnimation> = new Map()
  
  // WebGPU resources
  private vertexBuffer: GPUBuffer | null = null
  private vertices: Float32Array
  private maxVertices: number = 2000 // Should handle ~50 members easily
  
  // Avatar textures cache
  private avatarTextures: Map<string, {
    texture: GPUTexture
    view: GPUTextureView
    bindGroup: GPUBindGroup
  }> = new Map()
  
  // Text rendering (using 2D canvas overlay for simplicity)
  private textCanvas: HTMLCanvasElement
  private textCtx: CanvasRenderingContext2D
  private textTexture: GPUTexture | null = null
  private textTextureView: GPUTextureView | null = null
  private textBindGroup: GPUBindGroup | null = null
  private textDirty: boolean = true
  
  // SVG Icons cache
  private mutedIconImage: HTMLImageElement | null = null
  private deafenedIconImage: HTMLImageElement | null = null
  private iconsLoaded: boolean = false
  
  // Pipeline for textured rendering
  private texturePipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler | null = null
  
  constructor(
    id: string = 'voice-members',
    position: Vec2 = { x: 20, y: 20 },
    size: Vec2 = { x: 240, y: 300 }
  ) {
    super(id, position, size)
    
    this.vertices = new Float32Array(this.maxVertices * 10)
    
    // Create text canvas for text rendering with willReadFrequently for better perf
    this.textCanvas = document.createElement('canvas')
    this.textCtx = this.textCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!
    
    // Load SVG icons
    this.loadIcons()
  }
  
  private async loadIcons(): Promise<void> {
    // Muted microphone SVG (Lucide mic-off style)
    const mutedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`
    
    // Deafened headphone SVG (Lucide headphone-off style) 
    const deafenedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M16.5 12.5V16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2v-1"/><path d="M4.59 5.59A9.96 9.96 0 0 0 2 12v2a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H4.5"/><path d="M21.95 10.06A10 10 0 0 0 12 2c-1.36 0-2.66.27-3.84.77"/><path d="M12 2a10 10 0 0 1 10 10v2a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 1.72-1.98"/></svg>`
    
    this.mutedIconImage = await this.svgToImage(mutedSvg)
    this.deafenedIconImage = await this.svgToImage(deafenedSvg)
    this.iconsLoaded = true
    this.textDirty = true
  }
  
  private svgToImage(svg: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = reject
      img.src = url
    })
  }
  
  /**
   * Initialize GPU resources
   */
  initGPU(device: GPUDevice, format: GPUTextureFormat, uniformBindGroupLayout: GPUBindGroupLayout): void {
    // Create vertex buffer
    this.vertexBuffer = device.createBuffer({
      label: 'VoiceMembers Vertex Buffer',
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    
    // Create sampler
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    
    // Create texture pipeline
    this.createTexturePipeline(device, format, uniformBindGroupLayout)
    
    // Initialize text texture
    this.updateTextTexture(device)
  }
  
  private createTexturePipeline(
    device: GPUDevice, 
    format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout
  ): void {
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
        @location(2) extra: vec2f,
      }
      
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(1) @binding(0) var texSampler: sampler;
      @group(1) @binding(1) var texData: texture_2d<f32>;
      
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
        var texColor = textureSample(texData, texSampler, input.uv);
        var color = texColor * input.color;
        
        // Avatar circle mask
        if (input.extra.y > 0.5) {
          let center = vec2f(0.5, 0.5);
          let dist = distance(input.uv, center);
          let radius = 0.48;
          let smoothEdge = 0.02;
          let circleMask = 1.0 - smoothstep(radius - smoothEdge, radius, dist);
          color = vec4f(color.rgb, color.a * circleMask);
          
          // Speaking glow ring
          if (input.extra.x > 0.0) {
            let glowIntensity = input.extra.x;
            let pulse = sin(uniforms.time * 4.0) * 0.15 + 0.85;
            
            // Ring glow outside avatar
            let ringWidth = 0.06;
            let outerRadius = 0.5;
            let ringCenter = outerRadius - ringWidth * 0.5;
            let ringDist = abs(dist - ringCenter);
            let ringGlow = (1.0 - smoothstep(0.0, ringWidth, ringDist)) * glowIntensity * pulse;
            
            let glowColor = vec3f(0.52, 1.0, 0.35);
            let newRgb = mix(color.rgb, glowColor, ringGlow * 0.6);
            
            // Outer glow halo
            let outerGlow = (1.0 - smoothstep(radius, radius + 0.2, dist)) * glowIntensity * pulse * 0.3;
            color = vec4f(
              newRgb + glowColor * outerGlow,
              max(color.a, outerGlow * 0.5)
            );
          }
        }
        
        return color;
      }
    `
    
    const shaderModule = device.createShaderModule({
      label: 'VoiceMembers Texture Shader',
      code: shaderCode,
    })
    
    const textureBindGroupLayout = device.createBindGroupLayout({
      label: 'VoiceMembers Texture Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    
    const pipelineLayout = device.createPipelineLayout({
      label: 'VoiceMembers Pipeline Layout',
      bindGroupLayouts: [uniformBindGroupLayout, textureBindGroupLayout],
    })
    
    this.texturePipeline = device.createRenderPipeline({
      label: 'VoiceMembers Texture Pipeline',
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
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }
  
  /**
   * Update text texture when members change
   */
  private updateTextTexture(device: GPUDevice): void {
    const dpr = window.devicePixelRatio || 1
    const width = Math.ceil(this.config.size.x * dpr)
    const height = Math.ceil(this.config.size.y * dpr)
    
    this.textCanvas.width = width
    this.textCanvas.height = height
    
    // Clear canvas
    this.textCtx.clearRect(0, 0, width, height)
    
    // Draw widget background with rounded corners
    this.textCtx.save()
    this.roundedRect(
      this.textCtx, 
      0, 0, 
      width, height, 
      LAYOUT.borderRadius * dpr
    )
    this.textCtx.fillStyle = 'rgba(20, 20, 24, 0.92)'
    this.textCtx.fill()
    this.textCtx.restore()
    
    // Draw each member
    const startY = LAYOUT.padding * dpr
    const itemHeight = LAYOUT.itemHeight * dpr
    const itemSpacing = LAYOUT.itemSpacing * dpr
    const avatarSize = LAYOUT.avatarSize * dpr
    const padding = LAYOUT.padding * dpr
    
    this.members.forEach((member, index) => {
      const y = startY + index * (itemHeight + itemSpacing)
      const itemWidth = width - padding * 2
      
      // Item background
      this.textCtx.save()
      this.roundedRect(
        this.textCtx,
        padding, y,
        itemWidth, itemHeight,
        LAYOUT.itemBorderRadius * dpr
      )
      this.textCtx.fillStyle = 'rgba(40, 40, 48, 0.7)'
      this.textCtx.fill()
      this.textCtx.restore()
      
      // Avatar placeholder (colored circle for fallback)
      const avatarX = padding + 6 * dpr
      const avatarY = y + (itemHeight - avatarSize) / 2
      const avatarCenterX = avatarX + avatarSize / 2
      const avatarCenterY = avatarY + avatarSize / 2
      
      this.textCtx.save()
      this.textCtx.beginPath()
      this.textCtx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2)
      this.textCtx.fillStyle = member.avatarColor || '#4a4a5a'
      this.textCtx.fill()
      
      // Avatar fallback letter
      if (!member.avatarUrl) {
        this.textCtx.fillStyle = 'white'
        this.textCtx.font = `bold ${avatarSize * 0.5}px Inter, system-ui, sans-serif`
        this.textCtx.textAlign = 'center'
        this.textCtx.textBaseline = 'middle'
        this.textCtx.fillText(
          member.displayName.charAt(0).toUpperCase(),
          avatarCenterX,
          avatarCenterY
        )
      }
      this.textCtx.restore()
      
      // Speaking glow (drawn around avatar)
      const anim = this.animations.get(member.userId)
      if (anim && anim.speakingGlow > 0.05) {
        this.textCtx.save()
        this.textCtx.beginPath()
        this.textCtx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 3 * dpr, 0, Math.PI * 2)
        this.textCtx.strokeStyle = `rgba(132, 255, 90, ${anim.speakingGlow * 0.8})`
        this.textCtx.lineWidth = 3 * dpr
        this.textCtx.stroke()
        
        // Outer glow
        const gradient = this.textCtx.createRadialGradient(
          avatarCenterX, avatarCenterY, avatarSize / 2,
          avatarCenterX, avatarCenterY, avatarSize / 2 + 12 * dpr
        )
        gradient.addColorStop(0, `rgba(132, 255, 90, ${anim.speakingGlow * 0.4})`)
        gradient.addColorStop(1, 'rgba(132, 255, 90, 0)')
        this.textCtx.beginPath()
        this.textCtx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 12 * dpr, 0, Math.PI * 2)
        this.textCtx.fillStyle = gradient
        this.textCtx.fill()
        this.textCtx.restore()
      }
      
      // Display name
      const textX = avatarX + avatarSize + LAYOUT.avatarMarginRight * dpr
      const textY = y + itemHeight / 2
      
      this.textCtx.save()
      this.textCtx.fillStyle = 'white'
      this.textCtx.font = `500 ${13 * dpr}px Inter, system-ui, sans-serif`
      this.textCtx.textBaseline = 'middle'
      
      // Truncate if needed
      const maxTextWidth = itemWidth - avatarSize - LAYOUT.avatarMarginRight * dpr - 50 * dpr
      let displayText = member.displayName
      while (this.textCtx.measureText(displayText).width > maxTextWidth && displayText.length > 3) {
        displayText = displayText.slice(0, -1)
      }
      if (displayText !== member.displayName) {
        displayText += '…'
      }
      
      this.textCtx.fillText(displayText, textX, textY)
      this.textCtx.restore()
      
      // Status icons (muted/deafened)
      const iconSize = LAYOUT.statusIconSize * dpr
      let iconX = width - padding - 8 * dpr - iconSize
      
      if (member.isDeafened) {
        this.drawDeafenedIcon(this.textCtx, iconX, y + (itemHeight - iconSize) / 2, iconSize)
        iconX -= iconSize + LAYOUT.statusIconMargin * dpr
      }
      
      if (member.isMuted) {
        this.drawMutedIcon(this.textCtx, iconX, y + (itemHeight - iconSize) / 2, iconSize)
      }
    })
    
    // Create or update GPU texture
    if (this.textTexture) {
      this.textTexture.destroy()
    }
    
    this.textTexture = device.createTexture({
      label: 'VoiceMembers Text Texture',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    
    const imageData = this.textCtx.getImageData(0, 0, width, height)
    device.queue.writeTexture(
      { texture: this.textTexture },
      imageData.data,
      { bytesPerRow: width * 4 },
      { width, height }
    )
    
    this.textTextureView = this.textTexture.createView()
    
    // Create bind group
    if (this.texturePipeline && this.sampler) {
      this.textBindGroup = device.createBindGroup({
        label: 'VoiceMembers Text Bind Group',
        layout: this.texturePipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.textTextureView },
        ],
      })
    }
    
    this.textDirty = false
  }
  
  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    width: number, height: number,
    radius: number
  ): void {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  }
  
  private drawMutedIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    if (this.mutedIconImage && this.iconsLoaded) {
      ctx.drawImage(this.mutedIconImage, x, y, size, size)
    } else {
      // Fallback: simple X
      ctx.save()
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = size * 0.12
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x + size * 0.2, y + size * 0.2)
      ctx.lineTo(x + size * 0.8, y + size * 0.8)
      ctx.moveTo(x + size * 0.8, y + size * 0.2)
      ctx.lineTo(x + size * 0.2, y + size * 0.8)
      ctx.stroke()
      ctx.restore()
    }
  }
  
  private drawDeafenedIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    if (this.deafenedIconImage && this.iconsLoaded) {
      ctx.drawImage(this.deafenedIconImage, x, y, size, size)
    } else {
      // Fallback: simple circle with X
      ctx.save()
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = size * 0.12
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, size * 0.35, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + size * 0.25, y + size * 0.25)
      ctx.lineTo(x + size * 0.75, y + size * 0.75)
      ctx.stroke()
      ctx.restore()
    }
  }
  
  // ==================== Public API ====================
  
  /**
   * Update the list of voice members
   */
  setMembers(members: VoiceMember[]): void {
    // Always update - deep copy to avoid reactivity issues
    this.members = members.map(m => ({ ...m }))
    
    // Update animation targets
    for (const member of this.members) {
      let anim = this.animations.get(member.userId)
      if (!anim) {
        anim = { speakingGlow: 0, targetGlow: 0 }
        this.animations.set(member.userId, anim)
      }
      anim.targetGlow = member.isSpeaking ? 1 : 0
    }
    
    // Clean up old animations
    const memberIds = new Set(this.members.map(m => m.userId))
    for (const userId of this.animations.keys()) {
      if (!memberIds.has(userId)) {
        this.animations.delete(userId)
      }
    }
    
    // Recalculate size based on member count
    const itemHeight = LAYOUT.itemHeight + LAYOUT.itemSpacing
    const contentHeight = LAYOUT.padding * 2 + this.members.length * itemHeight - LAYOUT.itemSpacing
    this.config.size.y = Math.max(100, Math.min(contentHeight, 500))
    
    this.textDirty = true
  }
  
  /**
   * Update speaking state for a specific member
   */
  setSpeaking(userId: string, isSpeaking: boolean): void {
    const member = this.members.find(m => m.userId === userId)
    if (member) {
      member.isSpeaking = isSpeaking
      
      let anim = this.animations.get(userId)
      if (!anim) {
        anim = { speakingGlow: 0, targetGlow: 0 }
        this.animations.set(userId, anim)
      }
      anim.targetGlow = isSpeaking ? 1 : 0
      
      this.textDirty = true
    }
  }
  
  // ==================== Widget Lifecycle ====================
  
  update(deltaTime: number): void {
    // Animate speaking glow
    const lerpSpeed = 8 // Speed of glow animation
    let needsRedraw = false
    
    for (const [userId, anim] of this.animations) {
      const diff = anim.targetGlow - anim.speakingGlow
      if (Math.abs(diff) > 0.01) {
        anim.speakingGlow += diff * Math.min(deltaTime * lerpSpeed, 1)
        needsRedraw = true
      } else if (anim.speakingGlow !== anim.targetGlow) {
        anim.speakingGlow = anim.targetGlow
        needsRedraw = true
      }
    }
    
    if (needsRedraw) {
      this.textDirty = true
    }
  }
  
  render(ctx: OverlayRenderContext): void {
    if (!this.texturePipeline || !this.vertexBuffer) return
    
    // Rebuild text texture if needed
    if (this.textDirty) {
      this.updateTextTexture(ctx.device)
    }
    
    if (!this.textBindGroup || !this.textTextureView) return
    
    // Draw the widget as a textured quad
    const { x, y } = this.config.position
    const { x: width, y: height } = this.config.size
    
    // Build vertex data for a simple quad
    const vertices = new Float32Array([
      // Triangle 1
      x, y, 0, 0, 1, 1, 1, this.config.opacity, 0, 0,
      x + width, y, 1, 0, 1, 1, 1, this.config.opacity, 0, 0,
      x, y + height, 0, 1, 1, 1, 1, this.config.opacity, 0, 0,
      // Triangle 2
      x + width, y, 1, 0, 1, 1, 1, this.config.opacity, 0, 0,
      x + width, y + height, 1, 1, 1, 1, 1, this.config.opacity, 0, 0,
      x, y + height, 0, 1, 1, 1, 1, this.config.opacity, 0, 0,
    ])
    
    ctx.device.queue.writeBuffer(this.vertexBuffer, 0, vertices)
    
    // Get uniform bind group from renderer (passed via passEncoder state)
    ctx.passEncoder.setPipeline(this.texturePipeline)
    
    // We need access to the uniform bind group - this is a bit of a hack
    // The renderer should pass this, but for now we'll need to get it from context
    // @ts-ignore - accessing internal state
    const uniformBindGroup = ctx.uniformBindGroup
    if (uniformBindGroup) {
      ctx.passEncoder.setBindGroup(0, uniformBindGroup)
    }
    
    ctx.passEncoder.setBindGroup(1, this.textBindGroup)
    ctx.passEncoder.setVertexBuffer(0, this.vertexBuffer)
    ctx.passEncoder.draw(6)
    
    // Track draw call for diagnostics (1 quad = 1 sprite, 6 vertices)
    ctx.trackDraw(6)
  }
  
  dispose(): void {
    this.vertexBuffer?.destroy()
    this.textTexture?.destroy()
    
    for (const { texture } of this.avatarTextures.values()) {
      texture.destroy()
    }
    this.avatarTextures.clear()
    this.animations.clear()
  }
}
