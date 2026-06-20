/**
 * Notifications overlay widget: a stack of transient toasts (DM, mention, voice
 * join, recording, …). Each toast auto-dismisses after `durationMs`. Rendered as
 * one rasterized panel; the whole stack fades in/out via CanvasPanelWidget.
 */

import { CanvasPanelWidget } from './CanvasPanelWidget'
import type { NotificationsWidgetConfig, OverlayNotification, OverlayNotificationKind } from './types'

const FONT = 'Inter, system-ui, -apple-system, sans-serif'

const KIND_COLOR: Record<OverlayNotificationKind, string> = {
  dm: '#818cf8',
  mention: '#fbbf24',
  join: '#34d399',
  record: '#f87171',
  online: '#38bdf8',
  info: '#94a3b8',
}

interface ActiveToast extends OverlayNotification {
  remaining: number // seconds until auto-dismiss
}

export class NotificationsWidget extends CanvasPanelWidget {
  private toasts: ActiveToast[] = []
  private durationMs = 5000
  private maxStack = 3

  setConfig(cfg: NotificationsWidgetConfig): void {
    this.durationMs = Math.max(1500, cfg.durationMs)
    this.maxStack = Math.max(1, Math.min(6, cfg.maxStack))
  }

  push(n: OverlayNotification): void {
    this.toasts.push({ ...n, remaining: this.durationMs / 1000 })
    if (this.toasts.length > this.maxStack) this.toasts.splice(0, this.toasts.length - this.maxStack)
    this.targetAppear = 1
    this.appear = Math.min(this.appear, 0.4) // re-trigger the slide on a new toast
    this.markDirty()
  }

  hasContent(): boolean {
    return this.toasts.length > 0
  }

  update(deltaTime: number): void {
    super.update(deltaTime)
    if (this.toasts.length > 0) {
      const dt = Math.min(deltaTime, 0.1)
      let changed = false
      for (const t of this.toasts) t.remaining -= dt
      const before = this.toasts.length
      this.toasts = this.toasts.filter((t) => t.remaining > 0)
      if (this.toasts.length !== before) changed = true
      if (changed) this.markDirty()
    }
  }

  needsContinuousRender(): boolean {
    return this.toasts.length > 0 || super.needsContinuousRender()
  }

  protected paint(): { w: number; h: number } | null {
    if (this.toasts.length === 0) return null

    const s = this.config.scale || 1
    const width = 300 * s
    const gap = 8 * s
    const padX = 12 * s
    const padY = 9 * s
    const titleSize = 12.5 * s
    const bodySize = 11.5 * s
    const accentW = 3 * s

    // Measure heights (title always, body optional).
    const rows = this.toasts.map((t) => ({ t, h: padY * 2 + (t.body ? titleSize + bodySize + 4 * s : titleSize) }))
    const height = rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1)

    const { ctx } = this.beginPaint(width, height)

    let y = 0
    for (const { t, h } of rows) {
      const color = t.color || KIND_COLOR[t.kind] || KIND_COLOR.info
      // Card.
      this.roundedRect(ctx, 0, y, width, h, 10 * s)
      ctx.fillStyle = 'rgba(18, 18, 23, 0.86)'
      ctx.fill()
      // Accent bar.
      this.roundedRect(ctx, 0, y, accentW + 4 * s, h, 10 * s)
      ctx.fillStyle = color
      ctx.fill()

      ctx.textBaseline = 'alphabetic'
      const tx = padX + accentW
      if (t.body) {
        ctx.font = `600 ${titleSize}px ${FONT}`
        ctx.fillStyle = color
        ctx.fillText(this.clip(ctx, t.title, width - tx - padX), tx, y + padY + titleSize)
        ctx.font = `400 ${bodySize}px ${FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        ctx.fillText(this.clip(ctx, t.body, width - tx - padX), tx, y + padY + titleSize + 4 * s + bodySize)
      } else {
        ctx.font = `500 ${titleSize}px ${FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.fillText(this.clip(ctx, t.title, width - tx - padX), tx, y + h / 2 + titleSize / 2 - 2 * s)
      }
      y += h + gap
    }

    return { w: width, h: height }
  }

  private clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    let t = (text || '').replace(/\n/g, ' ')
    if (ctx.measureText(t).width <= maxW) return t
    while (ctx.measureText(t + '…').width > maxW && t.length > 1) t = t.slice(0, -1)
    return t + '…'
  }
}
