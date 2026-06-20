/**
 * Base for overlay widgets whose content is rasterized to a 2D canvas and drawn
 * as a single textured quad (chat peek, notifications/toasts). Subclasses paint
 * `ctx2d` in `paint()` and report the panel's logical size; this base handles the
 * GPU texture upload, anchored placement, a show/fade animation, and the quad draw.
 *
 * Content is painted at the final scaled logical size (subclasses multiply by
 * `this.config.scale`) so text stays crisp — matching VoiceMembersWidget.
 */

import { BaseWidget } from './BaseWidget'
import { computeAnchoredPosition } from './layout'
import type { OverlayRenderContext, Vec2 } from './types'

export abstract class CanvasPanelWidget extends BaseWidget {
  protected device: GPUDevice | null = null
  protected ctx2d: CanvasRenderingContext2D
  protected panelCanvas: HTMLCanvasElement
  protected dirty = true

  /** Logical (scaled) panel size set by the last paint(). */
  protected panelW = 0
  protected panelH = 0

  // Appear/fade animation (0→1).
  protected appear = 0
  protected targetAppear = 1

  private pipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler | null = null
  private vertexBuffer: GPUBuffer | null = null
  private vertices = new Float32Array(6 * 10)
  private texture: GPUTexture | null = null
  private bindGroup: GPUBindGroup | null = null

  private trackTextureFn: OverlayRenderContext['trackTexture'] | null = null
  private untrackTextureFn: OverlayRenderContext['untrackTexture'] | null = null

  constructor(id: string, position: Vec2 = { x: 0, y: 0 }) {
    super(id, position)
    this.panelCanvas = document.createElement('canvas')
    this.ctx2d = this.panelCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!
  }

  /**
   * Paint `this.ctx2d` and return the panel's logical size, or null if there's
   * nothing to draw. Implementations must size `this.panelCanvas` to
   * `w*dpr × h*dpr` and draw scaled by dpr (use {@link beginPaint}).
   */
  protected abstract paint(): { w: number; h: number } | null

  /** Helper: size the canvas to (w,h) logical px and return a dpr-scaled ctx. */
  protected beginPaint(w: number, h: number): { ctx: CanvasRenderingContext2D; dpr: number } {
    const dpr = window.devicePixelRatio || 1
    this.panelCanvas.width = Math.max(1, Math.ceil(w * dpr))
    this.panelCanvas.height = Math.max(1, Math.ceil(h * dpr))
    const ctx = this.ctx2d
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.panelCanvas.width, this.panelCanvas.height)
    ctx.scale(dpr, dpr)
    return { ctx, dpr }
  }

  protected roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, radius: number,
  ): void {
    const r = Math.min(radius, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  initGPU(device: GPUDevice, format: GPUTextureFormat, uniformBindGroupLayout: GPUBindGroupLayout): void {
    this.device = device
    this.vertexBuffer = device.createBuffer({
      label: `${this.id} Vertex Buffer`,
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    })

    const shader = device.createShaderModule({
      label: `${this.id} Shader`,
      code: /* wgsl */ `
        struct Uniforms { resolution: vec2f, time: f32, _pad: f32 }
        struct VSIn { @location(0) position: vec2f, @location(1) uv: vec2f, @location(2) color: vec4f, @location(3) extra: vec2f }
        struct VSOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f }
        @group(0) @binding(0) var<uniform> u: Uniforms;
        @group(1) @binding(0) var s: sampler;
        @group(1) @binding(1) var t: texture_2d<f32>;
        @vertex fn vs_main(i: VSIn) -> VSOut {
          var o: VSOut;
          o.position = vec4f((i.position.x / u.resolution.x) * 2.0 - 1.0, 1.0 - (i.position.y / u.resolution.y) * 2.0, 0.0, 1.0);
          o.uv = i.uv; o.color = i.color; return o;
        }
        @fragment fn fs_main(i: VSOut) -> @location(0) vec4f {
          return textureSample(t, s, i.uv) * i.color;
        }
      `,
    })
    const texLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    this.pipeline = device.createRenderPipeline({
      label: `${this.id} Pipeline`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [uniformBindGroupLayout, texLayout] }),
      vertex: {
        module: shader, entryPoint: 'vs_main',
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
        module: shader, entryPoint: 'fs_main',
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

  /** Subclasses call this to request a texture rebuild on next render. */
  protected markDirty(): void { this.dirty = true }

  private rebuild(): void {
    if (!this.device || !this.pipeline || !this.sampler) return
    const res = this.paint()
    if (!res || res.w <= 0 || res.h <= 0) {
      this.panelW = 0; this.panelH = 0; this.bindGroup = null
      this.dirty = false
      return
    }
    this.panelW = res.w
    this.panelH = res.h

    if (this.texture) { this.untrackTextureFn?.(`${this.id}-panel`); this.texture.destroy() }
    const w = this.panelCanvas.width, h = this.panelCanvas.height
    this.texture = this.device.createTexture({
      label: `${this.id} Panel Texture`,
      size: [w, h], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.trackTextureFn?.(`${this.id}-panel`, this.texture, w, h, 4)
    const data = this.ctx2d.getImageData(0, 0, w, h)
    this.device.queue.writeTexture({ texture: this.texture }, data.data, { bytesPerRow: w * 4 }, { width: w, height: h })
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.texture.createView() },
      ],
    })
    this.dirty = false
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.05)
    const diff = this.targetAppear - this.appear
    if (Math.abs(diff) > 0.001) this.appear += diff * Math.min(dt * 10, 1)
    else this.appear = this.targetAppear
  }

  needsContinuousRender(): boolean {
    return Math.abs(this.targetAppear - this.appear) > 0.001
  }

  render(ctx: OverlayRenderContext): void {
    if (!this.pipeline || !this.vertexBuffer || !this.device) return
    this.trackTextureFn = ctx.trackTexture
    this.untrackTextureFn = ctx.untrackTexture

    if (this.dirty || !this.bindGroup) this.rebuild()
    if (!this.bindGroup || this.panelW <= 0) return

    // @ts-ignore - internal extension for widgets
    const uniformBindGroup = ctx.uniformBindGroup
    if (!uniformBindGroup) return

    const w = this.panelW
    const h = this.panelH
    const origin = computeAnchoredPosition(
      this.config.anchor, ctx.canvasSize, { x: w, y: h },
      this.config.screenPadding, this.config.offsetX, this.config.offsetY,
    )

    // Subtle slide-in synced with the fade.
    const slide = (1 - this.appear) * 12
    const x = origin.x
    const y = origin.y + slide
    const alpha = this.config.opacity * ctx.globalOpacity * this.appear

    const v = this.vertices
    const quad = [
      [x, y, 0, 0], [x + w, y, 1, 0], [x, y + h, 0, 1],
      [x + w, y, 1, 0], [x + w, y + h, 1, 1], [x, y + h, 0, 1],
    ]
    for (let i = 0; i < 6; i++) {
      const b = i * 10
      v[b] = quad[i][0]; v[b + 1] = quad[i][1]; v[b + 2] = quad[i][2]; v[b + 3] = quad[i][3]
      v[b + 4] = 1; v[b + 5] = 1; v[b + 6] = 1; v[b + 7] = alpha; v[b + 8] = 0; v[b + 9] = 0
    }
    this.device.queue.writeBuffer(this.vertexBuffer, 0, v.buffer, v.byteOffset, 6 * 10 * 4)

    ctx.passEncoder.setPipeline(this.pipeline)
    ctx.passEncoder.setBindGroup(0, uniformBindGroup)
    ctx.passEncoder.setBindGroup(1, this.bindGroup)
    ctx.passEncoder.setVertexBuffer(0, this.vertexBuffer)
    ctx.passEncoder.draw(6)
    ctx.trackDraw(6, 1)
  }

  dispose(): void {
    this.untrackTextureFn?.(`${this.id}-panel`)
    this.texture?.destroy()
    this.vertexBuffer?.destroy()
    this.device = null
    this.bindGroup = null
  }
}
