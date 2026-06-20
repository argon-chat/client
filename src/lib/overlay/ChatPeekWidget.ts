/**
 * Chat-peek overlay widget: shows the last few messages of the active text
 * channel as a compact panel. Live messages only (fed by useOverlayChatPublisher).
 */

import { CanvasPanelWidget } from './CanvasPanelWidget'
import type { ChatWidgetConfig, OverlayChatMessage } from './types'

const FONT = 'Inter, system-ui, -apple-system, sans-serif'

export class ChatPeekWidget extends CanvasPanelWidget {
  private messages: OverlayChatMessage[] = []
  private maxLines = 6

  setConfig(cfg: ChatWidgetConfig): void {
    if (cfg.maxLines !== this.maxLines) {
      this.maxLines = Math.max(1, Math.min(12, cfg.maxLines))
      this.markDirty()
    }
  }

  setMessages(list: OverlayChatMessage[]): void {
    this.messages = Array.isArray(list) ? list.slice(-this.maxLines) : []
    this.markDirty()
  }

  hasContent(): boolean {
    return this.messages.length > 0
  }

  protected paint(): { w: number; h: number } | null {
    const list = this.messages.slice(-this.maxLines)
    if (list.length === 0) return null

    const s = this.config.scale || 1
    const pad = 10 * s
    const lineH = 19 * s
    const width = 320 * s
    const fontSize = 12.5 * s
    const authorSize = 12.5 * s
    const height = pad * 2 + list.length * lineH

    const { ctx } = this.beginPaint(width, height)

    // Panel background.
    this.roundedRect(ctx, 0, 0, width, height, 12 * s)
    ctx.fillStyle = 'rgba(16, 16, 20, 0.78)'
    ctx.fill()

    ctx.textBaseline = 'middle'
    let y = pad + lineH / 2
    for (const m of list) {
      const cy = y
      // Author (colored, semibold).
      ctx.font = `600 ${authorSize}px ${FONT}`
      ctx.fillStyle = m.authorColor || '#cbd5e1'
      const author = m.author.length > 18 ? m.author.slice(0, 18) + '…' : m.author
      ctx.fillText(author, pad, cy)
      const authorW = ctx.measureText(author).width

      // Message text (white, truncated to width).
      ctx.font = `400 ${fontSize}px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      const textX = pad + authorW + 7 * s
      const maxW = width - textX - pad
      let text = (m.text || '').replace(/\n/g, ' ')
      while (ctx.measureText(text).width > maxW && text.length > 1) text = text.slice(0, -1)
      if (text !== (m.text || '').replace(/\n/g, ' ')) text += '…'
      ctx.fillText(text, textX, cy)

      y += lineH
    }

    return { w: width, h: height }
  }
}
