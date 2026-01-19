/**
 * Voice Members Widget
 * Displays list of voice channel members with speaking indicators
 * Uses per-avatar GPU textures for efficient rendering and animation support
 */

import { BaseWidget } from "./BaseWidget";
import type { OverlayRenderContext, VoiceMember, Vec2 } from "./types";

interface MemberAnimation {
  speakingGlow: number; // 0-1, current glow intensity
  targetGlow: number; // target glow intensity
}

interface AvatarTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
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
} as const;

export class VoiceMembersWidget extends BaseWidget {
  private members: VoiceMember[] = [];
  private animations: Map<string, MemberAnimation> = new Map();

  // WebGPU resources
  private device: GPUDevice | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private vertices: Float32Array;
  private maxVertices: number = 4000; // More vertices for per-avatar rendering

  // Per-avatar GPU textures
  private avatarTextures: Map<string, AvatarTexture> = new Map();
  private avatarLoadingSet: Set<string> = new Set();

  // Fallback avatar texture (colored circle with letter)
  private fallbackCanvas: HTMLCanvasElement;
  private fallbackCtx: CanvasRenderingContext2D;

  // Background texture (widget bg + item bgs + text + icons, NO avatars)
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private bgTexture: GPUTexture | null = null;
  private bgTextureView: GPUTextureView | null = null;
  private bgBindGroup: GPUBindGroup | null = null;
  private bgDirty: boolean = true;

  // SVG Icons cache
  private mutedIconImage: HTMLImageElement | null = null;
  private deafenedIconImage: HTMLImageElement | null = null;
  private iconsLoaded: boolean = false;

  // Pipeline for textured rendering
  private texturePipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private uniformBindGroupLayout: GPUBindGroupLayout | null = null;

  // Texture tracking callbacks
  private trackTextureFn:
    | ((
        id: string,
        texture: GPUTexture,
        width: number,
        height: number,
        bytesPerPixel?: number,
      ) => void)
    | null = null;
  private untrackTextureFn: ((id: string) => void) | null = null;

  constructor(
    id: string = "voice-members",
    position: Vec2 = { x: 20, y: 20 },
    size: Vec2 = { x: 240, y: 300 },
  ) {
    super(id, position, size);

    this.vertices = new Float32Array(this.maxVertices * 10);

    // Create canvases
    this.bgCanvas = document.createElement("canvas");
    this.bgCtx = this.bgCanvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    })!;

    this.fallbackCanvas = document.createElement("canvas");
    this.fallbackCtx = this.fallbackCanvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    })!;

    // Load SVG icons
    this.loadIcons();
  }

  private async loadIcons(): Promise<void> {
    const mutedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
    const deafenedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M16.5 12.5V16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2v-1"/><path d="M4.59 5.59A9.96 9.96 0 0 0 2 12v2a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H4.5"/><path d="M21.95 10.06A10 10 0 0 0 12 2c-1.36 0-2.66.27-3.84.77"/><path d="M12 2a10 10 0 0 1 10 10v2a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 1.72-1.98"/></svg>`;

    this.mutedIconImage = await this.svgToImage(mutedSvg);
    this.deafenedIconImage = await this.svgToImage(deafenedSvg);
    this.iconsLoaded = true;
    this.bgDirty = true;
  }

  private svgToImage(svg: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Load avatar image and create GPU texture
   */
  private loadAvatarTexture(url: string, userId: string): void {
    if (this.avatarLoadingSet.has(url) || this.avatarTextures.has(url)) {
      return;
    }

    this.avatarLoadingSet.add(url);

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      this.avatarLoadingSet.delete(url);
      if (this.device) {
        this.createAvatarTexture(url, img);
      }
    };

    img.onerror = () => {
      console.warn(`[VoiceMembersWidget] Failed to load avatar: ${url}`);
      this.avatarLoadingSet.delete(url);
    };

    img.src = url;
  }

  /**
   * Create GPU texture from loaded image
   */
  private createAvatarTexture(url: string, img: HTMLImageElement): void {
    if (!this.device || !this.texturePipeline || !this.sampler) return;

    // Use fixed size for avatar textures
    const size = 64; // Good balance of quality and memory

    // Draw image to canvas for GPU upload
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);

    const texture = this.device.createTexture({
      label: `Avatar ${url}`,
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: size * 4 },
      { width: size, height: size },
    );

    const view = texture.createView();
    const bindGroup = this.device.createBindGroup({
      label: `Avatar BindGroup ${url}`,
      layout: this.texturePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });

    this.avatarTextures.set(url, {
      texture,
      view,
      bindGroup,
      width: size,
      height: size,
    });

    // Track texture
    this.trackTextureFn?.(`avatar-${url}`, texture, size, size, 4);
  }

  /**
   * Create fallback avatar texture (colored circle with letter)
   */
  private createFallbackTexture(
    userId: string,
    displayName: string,
    color: string,
  ): AvatarTexture | null {
    if (!this.device || !this.texturePipeline || !this.sampler) return null;

    const cacheKey = `fallback-${color}-${displayName.charAt(0).toUpperCase()}`;
    const existing = this.avatarTextures.get(cacheKey);
    if (existing) return existing;

    const size = 64;
    this.fallbackCanvas.width = size;
    this.fallbackCanvas.height = size;

    const ctx = this.fallbackCtx;
    ctx.clearRect(0, 0, size, size);

    // Draw colored circle
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = color || "#4a4a5a";
    ctx.fill();

    // Draw letter
    ctx.fillStyle = "white";
    ctx.font = `bold ${size * 0.5}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayName.charAt(0).toUpperCase(), size / 2, size / 2);

    const imageData = ctx.getImageData(0, 0, size, size);

    const texture = this.device.createTexture({
      label: `Fallback Avatar ${cacheKey}`,
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: size * 4 },
      { width: size, height: size },
    );

    const view = texture.createView();
    const bindGroup = this.device.createBindGroup({
      label: `Fallback BindGroup ${cacheKey}`,
      layout: this.texturePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });

    const avatarTex = { texture, view, bindGroup, width: size, height: size };
    this.avatarTextures.set(cacheKey, avatarTex);

    // Track texture
    this.trackTextureFn?.(`avatar-${cacheKey}`, texture, size, size, 4);

    return avatarTex;
  }

  /**
   * Initialize GPU resources
   */
  initGPU(
    device: GPUDevice,
    format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
  ): void {
    this.device = device;
    this.uniformBindGroupLayout = uniformBindGroupLayout;

    // Create vertex buffer
    this.vertexBuffer = device.createBuffer({
      label: "VoiceMembers Vertex Buffer",
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Create sampler
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    // Create texture pipeline
    this.createTexturePipeline(device, format, uniformBindGroupLayout);

    // Background texture will be created on first render when bgDirty is true
  }

  private createTexturePipeline(
    device: GPUDevice,
    format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
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
        @location(3) extra: vec2f, // x = glow intensity, y = isAvatar (>0.5 means circle mask)
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
        
        // Avatar circle mask + glow
        if (input.extra.y > 0.5) {
          let center = vec2f(0.5, 0.5);
          let dist = distance(input.uv, center);
          let radius = 0.46;
          let smoothEdge = 0.04;
          let circleMask = 1.0 - smoothstep(radius - smoothEdge, radius, dist);
          
          // Speaking glow ring
          let glowIntensity = input.extra.x;
          if (glowIntensity > 0.0) {
            let pulse = sin(uniforms.time * 4.0) * 0.15 + 0.85;
            let glowColor = vec3f(0.52, 1.0, 0.35);
            
            // Inner ring glow
            let ringWidth = 0.08;
            let ringCenter = radius + ringWidth * 0.5;
            let ringDist = abs(dist - ringCenter);
            let ringGlow = (1.0 - smoothstep(0.0, ringWidth, ringDist)) * glowIntensity * pulse;
            
            // Outer glow halo
            let outerGlow = (1.0 - smoothstep(radius, radius + 0.25, dist)) * glowIntensity * pulse * 0.4;
            
            // Combine
            let glowAlpha = max(ringGlow * 0.8, outerGlow * 0.5);
            color = vec4f(
              mix(color.rgb, glowColor, ringGlow * 0.5) + glowColor * outerGlow,
              max(color.a * circleMask, glowAlpha)
            );
          } else {
            color = vec4f(color.rgb, color.a * circleMask);
          }
        }
        
        return color;
      }
    `;

    const shaderModule = device.createShaderModule({
      label: "VoiceMembers Texture Shader",
      code: shaderCode,
    });

    const textureBindGroupLayout = device.createBindGroupLayout({
      label: "VoiceMembers Texture Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      label: "VoiceMembers Pipeline Layout",
      bindGroupLayouts: [uniformBindGroupLayout, textureBindGroupLayout],
    });

    this.texturePipeline = device.createRenderPipeline({
      label: "VoiceMembers Texture Pipeline",
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 40, // 10 floats * 4 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" }, // position
              { shaderLocation: 1, offset: 8, format: "float32x2" }, // uv
              { shaderLocation: 2, offset: 16, format: "float32x4" }, // color
              { shaderLocation: 3, offset: 32, format: "float32x2" }, // extra
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /**
   * Update background texture (widget bg + item bgs + text + icons, NO avatars)
   */
  private updateBackgroundTexture(): void {
    if (!this.device || !this.texturePipeline || !this.sampler) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.ceil(this.config.size.x * dpr);
    const height = Math.ceil(this.config.size.y * dpr);

    this.bgCanvas.width = width;
    this.bgCanvas.height = height;

    const ctx = this.bgCtx;
    ctx.clearRect(0, 0, width, height);

    // Draw widget background (if enabled)
    if (this.config.showWidgetBackground) {
      ctx.save();
      this.roundedRect(ctx, 0, 0, width, height, LAYOUT.borderRadius * dpr);
      ctx.fillStyle = "rgba(20, 20, 24, 0.92)";
      ctx.fill();
      ctx.restore();
    }

    // Draw each member (background + text + icons, NO avatar)
    const padding = this.config.padding * dpr;
    const startY = padding;
    const itemHeight = LAYOUT.itemHeight * dpr;
    const itemSpacing = this.config.memberSpacing * dpr;
    const avatarSize = LAYOUT.avatarSize * dpr;

    this.members.forEach((member, index) => {
      const y = startY + index * (itemHeight + itemSpacing);
      const itemWidth = width - padding * 2;

      // Item background (if enabled)
      if (this.config.showMemberCards) {
        ctx.save();
        this.roundedRect(
          ctx,
          padding,
          y,
          itemWidth,
          itemHeight,
          LAYOUT.itemBorderRadius * dpr,
        );
        ctx.fillStyle = "rgba(40, 40, 48, 0.7)";
        ctx.fill();
        ctx.restore();
      }

      // Avatar placeholder (transparent circle area - avatar drawn separately)
      // We leave a "hole" where the avatar will be rendered

      // Display name
      const avatarX = padding + 6 * dpr;
      const textX = avatarX + avatarSize + LAYOUT.avatarMarginRight * dpr;
      const textY = y + itemHeight / 2;

      ctx.save();
      ctx.fillStyle = "white";
      ctx.font = `500 ${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "middle";

      const maxTextWidth =
        itemWidth - avatarSize - LAYOUT.avatarMarginRight * dpr - 50 * dpr;
      let displayText = member.displayName;
      while (
        ctx.measureText(displayText).width > maxTextWidth &&
        displayText.length > 3
      ) {
        displayText = displayText.slice(0, -1);
      }
      if (displayText !== member.displayName) {
        displayText += "…";
      }

      ctx.fillText(displayText, textX, textY);
      ctx.restore();

      // Status icons
      const iconSize = LAYOUT.statusIconSize * dpr;
      let iconX = width - padding - 8 * dpr - iconSize;

      if (member.isDeafened) {
        this.drawDeafenedIcon(
          ctx,
          iconX,
          y + (itemHeight - iconSize) / 2,
          iconSize,
        );
        iconX -= iconSize + LAYOUT.statusIconMargin * dpr;
      }

      if (member.isMuted) {
        this.drawMutedIcon(
          ctx,
          iconX,
          y + (itemHeight - iconSize) / 2,
          iconSize,
        );
      }
    });

    // Create/update GPU texture
    if (this.bgTexture) {
      this.untrackTextureFn?.(`${this.config.id}-bg`);
      this.bgTexture.destroy();
    }

    this.bgTexture = this.device.createTexture({
      label: "VoiceMembers Background Texture",
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.trackTextureFn?.(
      `${this.config.id}-bg`,
      this.bgTexture,
      width,
      height,
      4,
    );

    const imageData = ctx.getImageData(0, 0, width, height);
    this.device.queue.writeTexture(
      { texture: this.bgTexture },
      imageData.data,
      { bytesPerRow: width * 4 },
      { width, height },
    );

    this.bgTextureView = this.bgTexture.createView();

    this.bgBindGroup = this.device.createBindGroup({
      label: "VoiceMembers BG Bind Group",
      layout: this.texturePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.bgTextureView },
      ],
    });

    this.bgDirty = false;
  }

  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private drawMutedIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ): void {
    if (this.mutedIconImage && this.iconsLoaded) {
      ctx.drawImage(this.mutedIconImage, x, y, size, size);
    } else {
      ctx.save();
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = size * 0.12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + size * 0.2, y + size * 0.2);
      ctx.lineTo(x + size * 0.8, y + size * 0.8);
      ctx.moveTo(x + size * 0.8, y + size * 0.2);
      ctx.lineTo(x + size * 0.2, y + size * 0.8);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawDeafenedIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ): void {
    if (this.deafenedIconImage && this.iconsLoaded) {
      ctx.drawImage(this.deafenedIconImage, x, y, size, size);
    } else {
      ctx.save();
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = size * 0.12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + size * 0.25, y + size * 0.25);
      ctx.lineTo(x + size * 0.75, y + size * 0.75);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ==================== Public API ====================

  setMembers(members: VoiceMember[]): void {
    this.members = members.map((m) => ({ ...m }));

    // Update animations
    for (const member of this.members) {
      let anim = this.animations.get(member.userId);
      if (!anim) {
        anim = { speakingGlow: 0, targetGlow: 0 };
        this.animations.set(member.userId, anim);
      }
      anim.targetGlow = member.isSpeaking ? 1 : 0;
    }

    // Clean up old animations
    const memberIds = new Set(this.members.map((m) => m.userId));
    for (const userId of this.animations.keys()) {
      if (!memberIds.has(userId)) {
        this.animations.delete(userId);
      }
    }

    // Recalculate size
    this.recalculateSize();

    // Start loading avatar textures
    for (const member of this.members) {
      if (
        member.avatarUrl &&
        !this.avatarTextures.has(member.avatarUrl) &&
        !this.avatarLoadingSet.has(member.avatarUrl)
      ) {
        this.loadAvatarTexture(member.avatarUrl, member.userId);
      }
    }

    this.bgDirty = true;
  }

  setSpeaking(userId: string, isSpeaking: boolean): void {
    const member = this.members.find((m) => m.userId === userId);
    if (member) {
      member.isSpeaking = isSpeaking;

      let anim = this.animations.get(userId);
      if (!anim) {
        anim = { speakingGlow: 0, targetGlow: 0 };
        this.animations.set(userId, anim);
      }
      anim.targetGlow = isSpeaking ? 1 : 0;
    }
  }

  /**
   * Show/hide widget background card
   */
  setShowWidgetBackground(show: boolean): void {
    if (this.config.showWidgetBackground !== show) {
      this.config.showWidgetBackground = show;
      this.bgDirty = true;
    }
  }

  /**
   * Show/hide member card backgrounds
   */
  setShowMemberCards(show: boolean): void {
    if (this.config.showMemberCards !== show) {
      this.config.showMemberCards = show;
      this.bgDirty = true;
    }
  }

  /**
   * Set widget padding
   */
  setPadding(padding: number): void {
    const newPadding = Math.max(0, Math.min(50, padding));
    if (this.config.padding !== newPadding) {
      this.config.padding = newPadding;
      this.recalculateSize();
      this.bgDirty = true;
    }
  }

  /**
   * Set member spacing
   */
  setMemberSpacing(spacing: number): void {
    const newSpacing = Math.max(0, Math.min(20, spacing));
    if (this.config.memberSpacing !== newSpacing) {
      this.config.memberSpacing = newSpacing;
      this.recalculateSize();
      this.bgDirty = true;
    }
  }

  /**
   * Set screen padding (offset from screen edge)
   */
  setScreenPadding(padding: number): void {
    const newPadding = Math.max(0, Math.min(200, padding));
    if (this.config.screenPadding !== newPadding) {
      this.config.screenPadding = newPadding;
    }
  }

  /**
   * Set widget anchor position
   */
  setAnchor(anchor: import('./types').WidgetAnchor): void {
    if (this.config.anchor !== anchor) {
      this.config.anchor = anchor;
    }
  }

  /**
   * Recalculate widget size based on members count
   */
  private recalculateSize(): void {
    const itemHeight = LAYOUT.itemHeight + this.config.memberSpacing;
    const contentHeight =
      this.config.padding * 2 +
      this.members.length * itemHeight -
      this.config.memberSpacing;
    this.config.size.y = Math.max(100, Math.min(contentHeight, 500));
  }

  // ==================== Widget Lifecycle ====================

  update(deltaTime: number): void {
    const lerpSpeed = 8;

    for (const anim of this.animations.values()) {
      const diff = anim.targetGlow - anim.speakingGlow;
      if (Math.abs(diff) > 0.01) {
        anim.speakingGlow += diff * Math.min(deltaTime * lerpSpeed, 1);
      } else if (anim.speakingGlow !== anim.targetGlow) {
        anim.speakingGlow = anim.targetGlow;
      }
    }
  }

  render(ctx: OverlayRenderContext): void {
    if (!this.texturePipeline || !this.vertexBuffer || !this.device) return;

    // Store texture tracking functions
    this.trackTextureFn = ctx.trackTexture;
    this.untrackTextureFn = ctx.untrackTexture;

    // Rebuild background texture if needed
    if (this.bgDirty || !this.bgBindGroup) {
      this.updateBackgroundTexture();
    }

    if (!this.bgBindGroup) return;

    const { x: widgetW, y: widgetH } = this.config.size;
    const screenPad = this.config.screenPadding;
    
    // Calculate actual position based on anchor and screenPadding
    let widgetX: number;
    let widgetY: number;
    
    switch (this.config.anchor) {
      case 'top-left':
        widgetX = screenPad;
        widgetY = screenPad;
        break;
      case 'top-right':
        widgetX = ctx.canvasSize.x - screenPad - widgetW;
        widgetY = screenPad;
        break;
      case 'bottom-left':
        widgetX = screenPad;
        widgetY = ctx.canvasSize.y - screenPad - widgetH;
        break;
      case 'bottom-right':
        widgetX = ctx.canvasSize.x - screenPad - widgetW;
        widgetY = ctx.canvasSize.y - screenPad - widgetH;
        break;
      case 'top-center':
        widgetX = (ctx.canvasSize.x - widgetW) / 2;
        widgetY = screenPad;
        break;
      case 'bottom-center':
        widgetX = (ctx.canvasSize.x - widgetW) / 2;
        widgetY = ctx.canvasSize.y - screenPad - widgetH;
        break;
      default:
        widgetX = screenPad;
        widgetY = screenPad;
    }

    // Build vertices for all draws
    let vertexOffset = 0;
    const vertices = this.vertices;

    // Helper to add a quad
    const addQuad = (
      x: number,
      y: number,
      w: number,
      h: number,
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      r: number,
      g: number,
      b: number,
      a: number,
      extra0: number,
      extra1: number,
    ) => {
      const base = vertexOffset * 10;
      // Triangle 1
      vertices[base + 0] = x;
      vertices[base + 1] = y;
      vertices[base + 2] = u0;
      vertices[base + 3] = v0;
      vertices[base + 4] = r;
      vertices[base + 5] = g;
      vertices[base + 6] = b;
      vertices[base + 7] = a;
      vertices[base + 8] = extra0;
      vertices[base + 9] = extra1;

      vertices[base + 10] = x + w;
      vertices[base + 11] = y;
      vertices[base + 12] = u1;
      vertices[base + 13] = v0;
      vertices[base + 14] = r;
      vertices[base + 15] = g;
      vertices[base + 16] = b;
      vertices[base + 17] = a;
      vertices[base + 18] = extra0;
      vertices[base + 19] = extra1;

      vertices[base + 20] = x;
      vertices[base + 21] = y + h;
      vertices[base + 22] = u0;
      vertices[base + 23] = v1;
      vertices[base + 24] = r;
      vertices[base + 25] = g;
      vertices[base + 26] = b;
      vertices[base + 27] = a;
      vertices[base + 28] = extra0;
      vertices[base + 29] = extra1;

      // Triangle 2
      vertices[base + 30] = x + w;
      vertices[base + 31] = y;
      vertices[base + 32] = u1;
      vertices[base + 33] = v0;
      vertices[base + 34] = r;
      vertices[base + 35] = g;
      vertices[base + 36] = b;
      vertices[base + 37] = a;
      vertices[base + 38] = extra0;
      vertices[base + 39] = extra1;

      vertices[base + 40] = x + w;
      vertices[base + 41] = y + h;
      vertices[base + 42] = u1;
      vertices[base + 43] = v1;
      vertices[base + 44] = r;
      vertices[base + 45] = g;
      vertices[base + 46] = b;
      vertices[base + 47] = a;
      vertices[base + 48] = extra0;
      vertices[base + 49] = extra1;

      vertices[base + 50] = x;
      vertices[base + 51] = y + h;
      vertices[base + 52] = u0;
      vertices[base + 53] = v1;
      vertices[base + 54] = r;
      vertices[base + 55] = g;
      vertices[base + 56] = b;
      vertices[base + 57] = a;
      vertices[base + 58] = extra0;
      vertices[base + 59] = extra1;

      vertexOffset += 6;
    };

    // @ts-ignore - accessing internal state
    const uniformBindGroup = ctx.uniformBindGroup;
    if (!uniformBindGroup) return;

    ctx.passEncoder.setPipeline(this.texturePipeline);
    ctx.passEncoder.setBindGroup(0, uniformBindGroup);
    ctx.passEncoder.setVertexBuffer(0, this.vertexBuffer);

    // Calculate final opacity (widget opacity * global opacity)
    const finalOpacity = this.config.opacity * ctx.globalOpacity;

    // Collect all draw commands first, then write buffer once
    interface DrawCommand {
      firstVertex: number;
      vertexCount: number;
      bindGroup: GPUBindGroup;
    }
    const drawCommands: DrawCommand[] = [];

    // 1. Background quad
    const bgFirstVertex = vertexOffset;
    addQuad(
      widgetX,
      widgetY,
      widgetW,
      widgetH,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      finalOpacity,
      0,
      0,
    );
    drawCommands.push({
      firstVertex: bgFirstVertex,
      vertexCount: 6,
      bindGroup: this.bgBindGroup,
    });

    // 2. Collect avatar quads
    const padding = this.config.padding;
    const startY = padding;
    const itemHeight = LAYOUT.itemHeight;
    const itemSpacing = this.config.memberSpacing;
    const avatarSize = LAYOUT.avatarSize;

    for (let i = 0; i < this.members.length; i++) {
      const member = this.members[i];
      const memberY = startY + i * (itemHeight + itemSpacing);

      const avatarX = widgetX + padding + 6;
      const avatarY = widgetY + memberY + (itemHeight - avatarSize) / 2;

      // Get animation
      const anim = this.animations.get(member.userId);
      const glowIntensity = anim?.speakingGlow ?? 0;

      // Get avatar texture
      let avatarTex: AvatarTexture | null | undefined = null;

      if (member.avatarUrl) {
        avatarTex = this.avatarTextures.get(member.avatarUrl);
        if (!avatarTex && !this.avatarLoadingSet.has(member.avatarUrl)) {
          this.loadAvatarTexture(member.avatarUrl, member.userId);
        }
      }

      if (!avatarTex) {
        avatarTex = this.createFallbackTexture(
          member.userId,
          member.displayName,
          member.avatarColor,
        );
      }

      if (avatarTex) {
        const glowPadding = glowIntensity > 0 ? 4 : 0;
        const drawX = avatarX - glowPadding;
        const drawY = avatarY - glowPadding;
        const drawSize = avatarSize + glowPadding * 2;

        const avatarFirstVertex = vertexOffset;
        addQuad(
          drawX,
          drawY,
          drawSize,
          drawSize,
          0,
          0,
          1,
          1,
          1,
          1,
          1,
          finalOpacity,
          glowIntensity,
          1.0,
        );
        drawCommands.push({
          firstVertex: avatarFirstVertex,
          vertexCount: 6,
          bindGroup: avatarTex.bindGroup,
        });
      }
    }

    // Write ALL vertex data to buffer ONCE
    ctx.device.queue.writeBuffer(
      this.vertexBuffer,
      0,
      vertices.buffer,
      vertices.byteOffset,
      vertexOffset * 10 * 4,
    );

    // Execute all draw commands
    for (const cmd of drawCommands) {
      ctx.passEncoder.setBindGroup(1, cmd.bindGroup);
      ctx.passEncoder.draw(cmd.vertexCount, 1, cmd.firstVertex, 0);
      ctx.trackDraw(cmd.vertexCount, 1);
    }
  }

  dispose(): void {
    // Untrack textures
    this.untrackTextureFn?.(`${this.config.id}-bg`);
    for (const [key] of this.avatarTextures) {
      this.untrackTextureFn?.(`avatar-${key}`);
    }

    this.vertexBuffer?.destroy();
    this.bgTexture?.destroy();

    for (const { texture } of this.avatarTextures.values()) {
      texture.destroy();
    }
    this.avatarTextures.clear();
    this.avatarLoadingSet.clear();
    this.animations.clear();
    this.device = null;
  }
}
