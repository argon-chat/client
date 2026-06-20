/**
 * Voice Members Widget
 * Displays voice-channel members with speaking indicators, in one of several
 * layout modes (vertical list / horizontal bar / avatars-only / grid).
 *
 * Rendering model (unchanged from v1): static content (cards, names, status +
 * screen-share badges) is rasterized to a single background texture via a 2D
 * canvas; avatars are per-member GPU textures drawn as quads with a speaking
 * ring/glow in the shader. The dynamic speaking-activity bar is drawn as a flat
 * quad (1×1 white texture × color) so it can pulse without rebuilding the bg.
 */

import { BaseWidget } from "./BaseWidget";
import { computeAnchoredPosition } from "./layout";
import type {
  OverlayRenderContext,
  VoiceMember,
  Vec2,
  VoiceLayoutMode,
  VoiceWidgetConfig,
} from "./types";

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

/** Per-member placement (widget-local logical px, already scaled). */
interface MemberItem {
  member: VoiceMember;
  ax: number; // avatar x
  ay: number; // avatar y
  asz: number; // avatar size
  // optional name slot
  nameX?: number;
  nameY?: number;
  nameMaxW?: number;
  // optional card background
  cardX?: number;
  cardY?: number;
  cardW?: number;
  cardH?: number;
  // optional status-icon anchor (right edge to draw leftwards from)
  iconRight?: number;
  iconCY?: number;
  // optional speaking-activity bar
  volX?: number;
  volY?: number;
  volW?: number;
  volH?: number;
}

interface ComputedLayout {
  width: number;
  height: number;
  items: MemberItem[];
}

// Base (unscaled) layout constants.
const BASE = {
  padding: 12,
  itemHeight: 44,
  itemSpacing: 6,
  avatarSize: 32,
  avatarMarginRight: 10,
  borderRadius: 12,
  itemBorderRadius: 8,
  statusIconSize: 16,
  statusIconMargin: 6,
  nameFont: 13,
  subFont: 11,
  gap: 8,
  listWidth: 240,
  volHeight: 3,
} as const;

export class VoiceMembersWidget extends BaseWidget {
  private members: VoiceMember[] = [];
  private animations: Map<string, MemberAnimation> = new Map();

  // Voice-specific appearance.
  private mode: VoiceLayoutMode = "list";
  private showNames = true;
  private showVolume = false;
  private pulseTime = 0; // drives the speaking-activity bar

  // Cached layout (recomputed when members/config change).
  private layout: ComputedLayout = { width: 200, height: 100, items: [] };

  // WebGPU resources
  private device: GPUDevice | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private vertices: Float32Array;
  private maxVertices: number = 6000;

  // Per-avatar GPU textures
  private avatarTextures: Map<string, AvatarTexture> = new Map();
  private avatarLoadingSet: Set<string> = new Set();

  // Flat 1×1 white texture for solid-color quads (speaking-activity bar).
  private whiteTexture: GPUTexture | null = null;
  private whiteBindGroup: GPUBindGroup | null = null;

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
  private screenShareIconImage: HTMLImageElement | null = null;
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

    this.loadIcons();
  }

  private async loadIcons(): Promise<void> {
    const mutedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
    const deafenedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M16.5 12.5V16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2v-1"/><path d="M4.59 5.59A9.96 9.96 0 0 0 2 12v2a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H4.5"/><path d="M21.95 10.06A10 10 0 0 0 12 2c-1.36 0-2.66.27-3.84.77"/><path d="M12 2a10 10 0 0 1 10 10v2a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 1.72-1.98"/></svg>`;
    const screenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    this.mutedIconImage = await this.svgToImage(mutedSvg);
    this.deafenedIconImage = await this.svgToImage(deafenedSvg);
    this.screenShareIconImage = await this.svgToImage(screenSvg);
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

  // ==================== Avatar textures ====================

  private loadAvatarTexture(url: string, _userId: string): void {
    if (this.avatarLoadingSet.has(url) || this.avatarTextures.has(url)) return;
    this.avatarLoadingSet.add(url);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.avatarLoadingSet.delete(url);
      if (this.device) this.createAvatarTexture(url, img);
    };
    img.onerror = () => {
      console.warn(`[VoiceMembersWidget] Failed to load avatar: ${url}`);
      this.avatarLoadingSet.delete(url);
    };
    img.src = url;
  }

  private createAvatarTexture(url: string, img: HTMLImageElement): void {
    if (!this.device || !this.texturePipeline || !this.sampler) return;

    const size = 64;
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

    this.avatarTextures.set(url, { texture, view, bindGroup, width: size, height: size });
    this.trackTextureFn?.(`avatar-${url}`, texture, size, size, 4);
  }

  private createFallbackTexture(
    _userId: string,
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

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = color || "#4a4a5a";
    ctx.fill();

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
    this.trackTextureFn?.(`avatar-${cacheKey}`, texture, size, size, 4);
    return avatarTex;
  }

  // ==================== GPU init ====================

  initGPU(
    device: GPUDevice,
    format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
  ): void {
    this.device = device;
    this.uniformBindGroupLayout = uniformBindGroupLayout;

    this.vertexBuffer = device.createBuffer({
      label: "VoiceMembers Vertex Buffer",
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.createTexturePipeline(device, format, uniformBindGroupLayout);
    this.createWhiteTexture(device);
  }

  /** 1×1 opaque white texture → flat colored quads (speaking-activity bar). */
  private createWhiteTexture(device: GPUDevice): void {
    if (!this.texturePipeline || !this.sampler) return;
    const texture = device.createTexture({
      label: "VoiceMembers White 1x1",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
    this.whiteTexture = texture;
    this.whiteBindGroup = device.createBindGroup({
      label: "VoiceMembers White BindGroup",
      layout: this.texturePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
  }

  private createTexturePipeline(
    device: GPUDevice,
    format: GPUTextureFormat,
    uniformBindGroupLayout: GPUBindGroupLayout,
  ): void {
    const shaderCode = /* wgsl */ `
      struct Uniforms { resolution: vec2f, time: f32, _padding: f32 }
      struct VertexInput {
        @location(0) position: vec2f,
        @location(1) uv: vec2f,
        @location(2) color: vec4f,
        @location(3) extra: vec2f, // x = glow intensity, y = isAvatar (>0.5 → circle mask)
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
        if (input.extra.y > 0.5) {
          let center = vec2f(0.5, 0.5);
          let dist = distance(input.uv, center);
          let avatarRadius = 0.44;
          let circleMask = 1.0 - smoothstep(avatarRadius - 0.012, avatarRadius + 0.012, dist);
          var outColor = vec4f(color.rgb, color.a * circleMask);
          let glowIntensity = input.extra.x;
          if (glowIntensity > 0.001) {
            let ringColor = vec3f(0.33, 0.86, 0.45);
            let ringMid = 0.47;
            let ringHalf = 0.026;
            let ring = (1.0 - smoothstep(0.0, ringHalf, abs(dist - ringMid))) * glowIntensity;
            let outerGlow = (1.0 - smoothstep(ringMid, 0.5, dist)) * glowIntensity * 0.22;
            outColor = vec4f(
              mix(outColor.rgb, ringColor, clamp(ring, 0.0, 1.0)) + ringColor * outerGlow * 0.6,
              max(outColor.a, max(ring, outerGlow))
            );
          }
          return outColor;
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
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
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
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
              { shaderLocation: 2, offset: 16, format: "float32x4" },
              { shaderLocation: 3, offset: 32, format: "float32x2" },
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
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  // ==================== Layout computation ====================

  /** Recompute the per-mode geometry from the current members + config. */
  private computeLayout(): void {
    const s = this.config.scale || 1;
    const px = (n: number) => n * s;
    const items: MemberItem[] = [];
    const n = this.members.length;

    if (n === 0) {
      this.layout = { width: px(BASE.listWidth), height: px(100), items };
      this.config.size.x = this.layout.width;
      this.config.size.y = this.layout.height;
      return;
    }

    const pad = px(BASE.padding);
    const asz = px(BASE.avatarSize);
    const gap = px(BASE.gap);

    if (this.mode === "list" || this.mode === "bar") {
      // Vertical list of cards, or a single horizontal row of chips.
      this.bgCtx.font = `500 ${px(BASE.nameFont)}px Inter, system-ui, sans-serif`;
      const itemH = px(BASE.itemHeight);

      if (this.mode === "list") {
        const width = px(BASE.listWidth);
        const itemSpacing = px(this.config.memberSpacing);
        let y = pad;
        for (const m of this.members) {
          const cardX = pad;
          const cardW = width - pad * 2;
          const ax = cardX + px(6);
          const ay = y + (itemH - asz) / 2;
          const nameX = ax + asz + px(BASE.avatarMarginRight);
          const nameMaxW = cardX + cardW - nameX - px(46);
          items.push({
            member: m,
            ax,
            ay,
            asz,
            nameX: this.showNames ? nameX : undefined,
            nameY: y + itemH / 2,
            nameMaxW,
            cardX,
            cardY: y,
            cardW,
            cardH: itemH,
            iconRight: cardX + cardW - px(8),
            iconCY: y + itemH / 2,
            volX: nameX,
            volY: y + itemH / 2 + px(9),
            volW: nameMaxW,
            volH: px(BASE.volHeight),
          });
          y += itemH + itemSpacing;
        }
        this.layout = { width, height: y - itemSpacing + pad, items };
      } else {
        // bar: chips left→right, name beside avatar.
        const chipH = itemH;
        const y = pad;
        let x = pad;
        for (const m of this.members) {
          const ax = x;
          const ay = y + (chipH - asz) / 2;
          let chipW = asz;
          let nameX: number | undefined;
          let nameMaxW: number | undefined;
          if (this.showNames) {
            nameX = ax + asz + px(8);
            const tw = Math.min(this.bgCtx.measureText(m.displayName).width, px(120));
            nameMaxW = tw;
            chipW = asz + px(8) + tw + px(10);
          } else {
            chipW = asz + px(6);
          }
          items.push({
            member: m,
            ax,
            ay,
            asz,
            nameX,
            nameY: y + chipH / 2,
            nameMaxW,
            iconRight: ax + chipW - px(4),
            iconCY: y + px(10),
          });
          x += chipW + gap;
        }
        this.layout = { width: x - gap + pad, height: chipH + pad * 2, items };
      }
      this.config.size.x = this.layout.width;
      this.config.size.y = this.layout.height;
      return;
    }

    if (this.mode === "avatars") {
      // Avatars only, wrapped into rows.
      const maxCols = Math.min(n, 8);
      const cols = maxCols;
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        items.push({
          member: this.members[i],
          ax: pad + c * (asz + gap),
          ay: pad + r * (asz + gap),
          asz,
        });
      }
      this.layout = {
        width: pad * 2 + cols * asz + (cols - 1) * gap,
        height: pad * 2 + rows * asz + (rows - 1) * gap,
        items,
      };
      this.config.size.x = this.layout.width;
      this.config.size.y = this.layout.height;
      return;
    }

    // grid: avatars wrapped with a small name under each.
    const cellW = px(72);
    const subH = this.showNames ? px(BASE.subFont) + px(6) : 0;
    const cellH = asz + subH + px(6);
    const cols = Math.min(n, 5);
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const cx = pad + c * cellW;
      const cy = pad + r * cellH;
      const ax = cx + (cellW - asz) / 2;
      items.push({
        member: this.members[i],
        ax,
        ay: cy,
        asz,
        nameX: this.showNames ? cx : undefined,
        nameY: cy + asz + px(4) + px(BASE.subFont) / 2,
        nameMaxW: cellW,
      });
    }
    this.layout = {
      width: pad * 2 + cols * cellW,
      height: pad * 2 + rows * cellH,
      items,
    };
    this.config.size.x = this.layout.width;
    this.config.size.y = this.layout.height;
  }

  // ==================== Background texture ====================

  private updateBackgroundTexture(): void {
    if (!this.device || !this.texturePipeline || !this.sampler) return;

    this.computeLayout();

    const dpr = window.devicePixelRatio || 1;
    const s = this.config.scale || 1;
    const width = Math.max(1, Math.ceil(this.layout.width * dpr));
    const height = Math.max(1, Math.ceil(this.layout.height * dpr));

    this.bgCanvas.width = width;
    this.bgCanvas.height = height;
    const ctx = this.bgCtx;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(dpr, dpr); // draw in logical (already-scaled) coords

    if (this.config.showWidgetBackground) {
      this.roundedRect(ctx, 0, 0, this.layout.width, this.layout.height, BASE.borderRadius * s);
      ctx.fillStyle = "rgba(20, 20, 24, 0.92)";
      ctx.fill();
    }

    const nameFont = BASE.nameFont * s;
    const subFont = BASE.subFont * s;
    const isGrid = this.mode === "grid";

    for (const it of this.layout.items) {
      const m = it.member;

      // Card background (list mode, opt-in).
      if (it.cardX !== undefined && this.config.showMemberCards) {
        this.roundedRect(ctx, it.cardX, it.cardY!, it.cardW!, it.cardH!, BASE.itemBorderRadius * s);
        ctx.fillStyle = "rgba(40, 40, 48, 0.7)";
        ctx.fill();
      }

      // Name.
      if (it.nameX !== undefined && this.showNames) {
        ctx.fillStyle = m.isSpeaking ? "#d6ffe0" : "white";
        ctx.font = `${isGrid ? 500 : 500} ${isGrid ? subFont : nameFont}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = isGrid ? "center" : "left";
        let text = m.displayName;
        const maxW = it.nameMaxW ?? 120;
        while (ctx.measureText(text).width > maxW && text.length > 2) text = text.slice(0, -1);
        if (text !== m.displayName) text += "…";
        const tx = isGrid ? it.nameX + (it.nameMaxW ?? 0) / 2 : it.nameX;
        ctx.fillText(text, tx, it.nameY!);
        ctx.textAlign = "left";
      }

      // Status / screen-share icons (drawn from the right).
      if (it.iconRight !== undefined && this.iconsLoaded) {
        const iconSize = BASE.statusIconSize * s;
        let ix = it.iconRight - iconSize;
        const iy = (it.iconCY ?? 0) - iconSize / 2;
        if (m.isDeafened) {
          ctx.drawImage(this.deafenedIconImage!, ix, iy, iconSize, iconSize);
          ix -= iconSize + BASE.statusIconMargin * s;
        }
        if (m.isMuted) {
          ctx.drawImage(this.mutedIconImage!, ix, iy, iconSize, iconSize);
          ix -= iconSize + BASE.statusIconMargin * s;
        }
        if (m.isScreenShare) {
          ctx.drawImage(this.screenShareIconImage!, ix, iy, iconSize, iconSize);
        }
      }

      // Screen-share badge on the avatar corner (avatars/grid modes have no icon row).
      if (it.iconRight === undefined && m.isScreenShare && this.iconsLoaded) {
        const b = BASE.statusIconSize * s * 0.9;
        ctx.drawImage(this.screenShareIconImage!, it.ax + it.asz - b, it.ay - b * 0.3, b, b);
      }
    }

    ctx.restore();

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
    this.trackTextureFn?.(`${this.config.id}-bg`, this.bgTexture, width, height, 4);

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
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ==================== Public API ====================

  setMembers(members: VoiceMember[]): void {
    this.members = members.map((m) => ({ ...m }));

    for (const member of this.members) {
      let anim = this.animations.get(member.userId);
      if (!anim) {
        anim = { speakingGlow: 0, targetGlow: 0 };
        this.animations.set(member.userId, anim);
      }
      anim.targetGlow = member.isSpeaking ? 1 : 0;
    }
    const memberIds = new Set(this.members.map((m) => m.userId));
    for (const userId of this.animations.keys()) {
      if (!memberIds.has(userId)) this.animations.delete(userId);
    }

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

  /** Toggle a single member's speaking state (used by the debug harness). */
  setSpeaking(userId: string, isSpeaking: boolean): void {
    const member = this.members.find((m) => m.userId === userId);
    if (!member) return;
    member.isSpeaking = isSpeaking;
    let anim = this.animations.get(userId);
    if (!anim) {
      anim = { speakingGlow: 0, targetGlow: 0 };
      this.animations.set(userId, anim);
    }
    anim.targetGlow = isSpeaking ? 1 : 0;
    this.bgDirty = true; // name highlight tracks speaking
  }

  /** Apply the full voice appearance config (from the HUD config). */
  setVoiceConfig(cfg: VoiceWidgetConfig): void {
    let dirty = false;
    if (cfg.mode !== this.mode) { this.mode = cfg.mode; dirty = true; }
    if (cfg.showNames !== this.showNames) { this.showNames = cfg.showNames; dirty = true; }
    if (cfg.showVolume !== this.showVolume) { this.showVolume = cfg.showVolume; dirty = true; }
    if (cfg.showWidgetBackground !== this.config.showWidgetBackground) {
      this.config.showWidgetBackground = cfg.showWidgetBackground; dirty = true;
    }
    if (cfg.showMemberCards !== this.config.showMemberCards) {
      this.config.showMemberCards = cfg.showMemberCards; dirty = true;
    }
    if (dirty) this.bgDirty = true;
  }

  setMode(mode: VoiceLayoutMode): void {
    if (this.mode !== mode) { this.mode = mode; this.bgDirty = true; }
  }

  setShowWidgetBackground(show: boolean): void {
    if (this.config.showWidgetBackground !== show) { this.config.showWidgetBackground = show; this.bgDirty = true; }
  }
  setShowMemberCards(show: boolean): void {
    if (this.config.showMemberCards !== show) { this.config.showMemberCards = show; this.bgDirty = true; }
  }
  setPadding(padding: number): void {
    const p = Math.max(0, Math.min(50, padding));
    if (this.config.padding !== p) { this.config.padding = p; this.bgDirty = true; }
  }
  setMemberSpacing(spacing: number): void {
    const sp = Math.max(0, Math.min(20, spacing));
    if (this.config.memberSpacing !== sp) { this.config.memberSpacing = sp; this.bgDirty = true; }
  }
  setScreenPadding(padding: number): void {
    this.config.screenPadding = Math.max(0, Math.min(400, padding));
  }
  setScale(scale: number): void {
    const s = Math.max(0.5, Math.min(2, scale));
    if (this.config.scale !== s) { this.config.scale = s; this.bgDirty = true; }
  }

  // ==================== Lifecycle ====================

  needsContinuousRender(): boolean {
    // Keep rendering while a glow is mid-transition or any member is speaking
    // (the speaking-activity bar pulses).
    for (const a of this.animations.values()) {
      if (Math.abs(a.targetGlow - a.speakingGlow) > 0.001 || a.targetGlow > 0.5) return true;
    }
    return false;
  }

  hasContent(): boolean {
    return this.members.length > 0;
  }

  update(deltaTime: number): void {
    this.pulseTime += deltaTime;
    const lerpSpeed = 12;
    const dt = Math.min(deltaTime, 0.05);
    for (const anim of this.animations.values()) {
      const diff = anim.targetGlow - anim.speakingGlow;
      if (Math.abs(diff) > 0.001) anim.speakingGlow += diff * Math.min(dt * lerpSpeed, 1);
      else anim.speakingGlow = anim.targetGlow;
    }
  }

  render(ctx: OverlayRenderContext): void {
    if (!this.texturePipeline || !this.vertexBuffer || !this.device) return;

    this.trackTextureFn = ctx.trackTexture;
    this.untrackTextureFn = ctx.untrackTexture;

    if (this.bgDirty || !this.bgBindGroup) this.updateBackgroundTexture();
    if (!this.bgBindGroup) return;
    if (this.members.length === 0) return;

    const widgetW = this.layout.width;
    const widgetH = this.layout.height;
    const origin = computeAnchoredPosition(
      this.config.anchor,
      ctx.canvasSize,
      { x: widgetW, y: widgetH },
      this.config.screenPadding,
      this.config.offsetX,
      this.config.offsetY,
    );

    // @ts-ignore - internal extension for widgets
    const uniformBindGroup = ctx.uniformBindGroup;
    if (!uniformBindGroup) return;

    ctx.passEncoder.setPipeline(this.texturePipeline);
    ctx.passEncoder.setBindGroup(0, uniformBindGroup);
    ctx.passEncoder.setVertexBuffer(0, this.vertexBuffer);

    const finalOpacity = this.config.opacity * ctx.globalOpacity;

    let vertexOffset = 0;
    const vertices = this.vertices;
    const addQuad = (
      x: number, y: number, w: number, h: number,
      u0: number, v0: number, u1: number, v1: number,
      r: number, g: number, b: number, a: number,
      extra0: number, extra1: number,
    ) => {
      const verts = [
        [x, y, u0, v0], [x + w, y, u1, v0], [x, y + h, u0, v1],
        [x + w, y, u1, v0], [x + w, y + h, u1, v1], [x, y + h, u0, v1],
      ];
      for (const vv of verts) {
        const base = vertexOffset * 10;
        vertices[base + 0] = vv[0]; vertices[base + 1] = vv[1];
        vertices[base + 2] = vv[2]; vertices[base + 3] = vv[3];
        vertices[base + 4] = r; vertices[base + 5] = g; vertices[base + 6] = b; vertices[base + 7] = a;
        vertices[base + 8] = extra0; vertices[base + 9] = extra1;
        vertexOffset++;
      }
    };

    interface DrawCommand { firstVertex: number; vertexCount: number; bindGroup: GPUBindGroup }
    const drawCommands: DrawCommand[] = [];

    // 1. Background quad (cards/names/icons baked).
    const bgFirst = vertexOffset;
    addQuad(origin.x, origin.y, widgetW, widgetH, 0, 0, 1, 1, 1, 1, 1, finalOpacity, 0, 0);
    drawCommands.push({ firstVertex: bgFirst, vertexCount: 6, bindGroup: this.bgBindGroup });

    // 2. Avatars (+ optional speaking-activity bar).
    const pulse = 0.6 + 0.4 * Math.sin(this.pulseTime * 7);
    for (const it of this.layout.items) {
      const m = it.member;
      const anim = this.animations.get(m.userId);
      const glow = anim?.speakingGlow ?? 0;

      let avatarTex: AvatarTexture | null | undefined = null;
      if (m.avatarUrl) {
        avatarTex = this.avatarTextures.get(m.avatarUrl);
        if (!avatarTex && !this.avatarLoadingSet.has(m.avatarUrl)) {
          this.loadAvatarTexture(m.avatarUrl, m.userId);
        }
      }
      if (!avatarTex) avatarTex = this.createFallbackTexture(m.userId, m.displayName, m.avatarColor);

      if (avatarTex) {
        const first = vertexOffset;
        addQuad(origin.x + it.ax, origin.y + it.ay, it.asz, it.asz, 0, 0, 1, 1, 1, 1, 1, finalOpacity, glow, 1.0);
        drawCommands.push({ firstVertex: first, vertexCount: 6, bindGroup: avatarTex.bindGroup });
      }

      // Speaking-activity bar (list mode only, opt-in) — flat green quad.
      if (this.showVolume && this.whiteBindGroup && it.volW !== undefined && glow > 0.02) {
        const fillW = it.volW * Math.max(0.08, glow * pulse);
        const first = vertexOffset;
        addQuad(
          origin.x + it.volX!, origin.y + it.volY!, fillW, it.volH!,
          0, 0, 1, 1, 0.33, 0.86, 0.45, finalOpacity * glow, 0, 0,
        );
        drawCommands.push({ firstVertex: first, vertexCount: 6, bindGroup: this.whiteBindGroup });
      }
    }

    ctx.device.queue.writeBuffer(
      this.vertexBuffer, 0, vertices.buffer, vertices.byteOffset, vertexOffset * 10 * 4,
    );
    for (const cmd of drawCommands) {
      ctx.passEncoder.setBindGroup(1, cmd.bindGroup);
      ctx.passEncoder.draw(cmd.vertexCount, 1, cmd.firstVertex, 0);
      ctx.trackDraw(cmd.vertexCount, 1);
    }
  }

  dispose(): void {
    this.untrackTextureFn?.(`${this.config.id}-bg`);
    for (const [key] of this.avatarTextures) this.untrackTextureFn?.(`avatar-${key}`);
    this.vertexBuffer?.destroy();
    this.bgTexture?.destroy();
    this.whiteTexture?.destroy();
    for (const { texture } of this.avatarTextures.values()) texture.destroy();
    this.avatarTextures.clear();
    this.avatarLoadingSet.clear();
    this.animations.clear();
    this.device = null;
  }
}
