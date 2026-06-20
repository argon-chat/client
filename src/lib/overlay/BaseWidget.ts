/**
 * Base Widget Class
 * Abstract base for all overlay widgets
 */

import type {
  IWidget,
  WidgetConfig,
  OverlayRenderContext,
  Vec2,
  WidgetAnchor,
  OverlayWidgetLayout,
} from './types'

export abstract class BaseWidget implements IWidget {
  public readonly id: string
  public config: WidgetConfig

  constructor(id: string, position: Vec2 = { x: 0, y: 0 }, size: Vec2 = { x: 200, y: 100 }) {
    this.id = id
    this.config = {
      id,
      position,
      size,
      visible: true,
      opacity: 1,
      showWidgetBackground: false,
      showMemberCards: false,
      padding: 12,
      memberSpacing: 6,
      screenPadding: 20,
      anchor: 'top-left',
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    }
  }

  abstract update(deltaTime: number): void
  abstract render(ctx: OverlayRenderContext): void

  dispose(): void {
    // Override in subclasses if cleanup needed
  }

  setPosition(x: number, y: number): void {
    this.config.position.x = x
    this.config.position.y = y
  }

  setSize(width: number, height: number): void {
    this.config.size.x = width
    this.config.size.y = height
  }

  setVisible(visible: boolean): void {
    this.config.visible = visible
  }

  setOpacity(opacity: number): void {
    this.config.opacity = Math.max(0, Math.min(1, opacity))
  }

  setAnchor(anchor: WidgetAnchor): void {
    this.config.anchor = anchor
  }

  setScreenPadding(padding: number): void {
    this.config.screenPadding = Math.max(0, Math.min(400, padding))
  }

  setScale(scale: number): void {
    this.config.scale = Math.max(0.5, Math.min(2, scale))
  }

  /** Apply a placement entry from the HUD config (anchor + offset + scale + opacity + visibility). */
  applyLayout(layout: OverlayWidgetLayout): void {
    this.config.anchor = layout.anchor
    this.config.offsetX = layout.offsetX
    this.config.offsetY = layout.offsetY
    this.config.visible = layout.visible
    this.setScale(layout.scale)
    this.setOpacity(layout.opacity)
  }

  /**
   * Whether the widget needs the renderer to keep producing frames (running
   * animations, live timers, pending texture loads). The overlay window uses
   * this to extend its idle settle window. Default: false (static content).
   */
  needsContinuousRender(): boolean {
    return false
  }

  /** Whether this widget currently has anything to draw (drives visibility gating). */
  hasContent(): boolean {
    return true
  }
}

/**
 * Widget Manager
 * Handles widget lifecycle and rendering order
 */
export class WidgetManager {
  private widgets: Map<string, IWidget> = new Map()
  private renderOrder: string[] = []
  
  addWidget(widget: IWidget): void {
    this.widgets.set(widget.id, widget)
    this.renderOrder.push(widget.id)
    console.log(`[WidgetManager] Added widget: ${widget.id}`)
  }
  
  removeWidget(id: string): void {
    const widget = this.widgets.get(id)
    if (widget) {
      widget.dispose()
      this.widgets.delete(id)
      this.renderOrder = this.renderOrder.filter(wid => wid !== id)
      console.log(`[WidgetManager] Removed widget: ${id}`)
    }
  }
  
  getWidget<T extends IWidget>(id: string): T | undefined {
    return this.widgets.get(id) as T | undefined
  }
  
  getAllWidgets(): IWidget[] {
    return this.renderOrder
      .map(id => this.widgets.get(id))
      .filter((w): w is IWidget => w !== undefined)
  }
  
  bringToFront(id: string): void {
    const index = this.renderOrder.indexOf(id)
    if (index > -1) {
      this.renderOrder.splice(index, 1)
      this.renderOrder.push(id)
    }
  }
  
  sendToBack(id: string): void {
    const index = this.renderOrder.indexOf(id)
    if (index > -1) {
      this.renderOrder.splice(index, 1)
      this.renderOrder.unshift(id)
    }
  }
  
  updateAll(deltaTime: number): void {
    for (const widget of this.widgets.values()) {
      if (widget.config.visible) {
        widget.update(deltaTime)
      }
    }
  }
  
  renderAll(ctx: OverlayRenderContext): void {
    for (const id of this.renderOrder) {
      const widget = this.widgets.get(id)
      if (widget && widget.config.visible) {
        widget.render(ctx)
      }
    }
  }
  
  dispose(): void {
    for (const widget of this.widgets.values()) {
      widget.dispose()
    }
    this.widgets.clear()
    this.renderOrder = []
  }
}
