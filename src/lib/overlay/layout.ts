/**
 * Shared overlay layout helpers.
 *
 * The overlay renders at the game's native resolution; widgets are placed by an
 * anchor corner/edge plus a free-placement offset (the drag editor writes the
 * offset). This file centralizes that math so every widget — and the in-app
 * layout-editor preview — positions identically.
 */

import type {
  OverlayHudConfig,
  OverlayWidgetLayout,
  OverlayWidgetType,
  Vec2,
  WidgetAnchor,
} from './types'

/** All widget types in their default render (back-to-front) order. */
export const OVERLAY_WIDGET_TYPES: OverlayWidgetType[] = ['voice', 'chat', 'notifications']

/**
 * Top-left screen position (logical px) for a widget of `size`, given its anchor,
 * the base edge padding and any free-placement offset.
 */
export function computeAnchoredPosition(
  anchor: WidgetAnchor,
  canvas: Vec2,
  size: Vec2,
  screenPadding: number,
  offsetX = 0,
  offsetY = 0,
): Vec2 {
  const left = screenPadding
  const right = canvas.x - screenPadding - size.x
  const top = screenPadding
  const bottom = canvas.y - screenPadding - size.y
  const centerX = (canvas.x - size.x) / 2

  let x: number
  let y: number
  switch (anchor) {
    case 'top-left': x = left; y = top; break
    case 'top-right': x = right; y = top; break
    case 'bottom-left': x = left; y = bottom; break
    case 'bottom-right': x = right; y = bottom; break
    case 'top-center': x = centerX; y = top; break
    case 'bottom-center': x = centerX; y = bottom; break
    default: x = left; y = top
  }
  return { x: x + offsetX, y: y + offsetY }
}

/** Whether an anchor pins to the right edge (used for horizontal growth direction). */
export function isRightAnchored(anchor: WidgetAnchor): boolean {
  return anchor === 'top-right' || anchor === 'bottom-right'
}

/** Whether an anchor pins to the bottom edge (toasts/chat stack upward from there). */
export function isBottomAnchored(anchor: WidgetAnchor): boolean {
  return anchor === 'bottom-left' || anchor === 'bottom-right' || anchor === 'bottom-center'
}

export function defaultWidgetLayout(
  overrides: Partial<OverlayWidgetLayout> = {},
): OverlayWidgetLayout {
  return {
    visible: true,
    anchor: 'top-left',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    opacity: 1,
    ...overrides,
  }
}

/** Sensible out-of-the-box HUD: voice top-left, chat bottom-left, toasts top-right. */
export function defaultHudConfig(): OverlayHudConfig {
  return {
    globalOpacity: 0.45,
    screenPadding: 20,
    widgets: {
      voice: defaultWidgetLayout({ anchor: 'top-left' }),
      chat: defaultWidgetLayout({ anchor: 'bottom-left', visible: false }),
      notifications: defaultWidgetLayout({ anchor: 'top-right' }),
    },
    voice: {
      mode: 'list',
      showNames: true,
      showWidgetBackground: false,
      showMemberCards: false,
      showVolume: false,
    },
    chat: {
      maxLines: 6,
      fadeAfterMs: 12_000,
    },
    notifications: {
      durationMs: 5_000,
      maxStack: 3,
    },
  }
}

/**
 * Merge a partial/legacy config (e.g. an older persisted shape, or the flat
 * `{globalOpacity, widgetAnchor, screenPadding}` the main process used to send)
 * onto the defaults so the overlay never reads `undefined`.
 */
export function normalizeHudConfig(raw: unknown): OverlayHudConfig {
  const base = defaultHudConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, any>

  if (typeof r.globalOpacity === 'number') base.globalOpacity = r.globalOpacity
  if (typeof r.screenPadding === 'number') base.screenPadding = r.screenPadding

  // Legacy flat fields → voice widget defaults.
  if (r.widgetAnchor) base.widgets.voice.anchor = r.widgetAnchor
  if (typeof r.showWidgetBackground === 'boolean') base.voice.showWidgetBackground = r.showWidgetBackground
  if (typeof r.showMemberCards === 'boolean') base.voice.showMemberCards = r.showMemberCards

  if (r.widgets && typeof r.widgets === 'object') {
    for (const type of OVERLAY_WIDGET_TYPES) {
      const w = r.widgets[type]
      if (w && typeof w === 'object') base.widgets[type] = { ...base.widgets[type], ...w }
    }
  }
  if (r.voice && typeof r.voice === 'object') base.voice = { ...base.voice, ...r.voice }
  if (r.chat && typeof r.chat === 'object') base.chat = { ...base.chat, ...r.chat }
  if (r.notifications && typeof r.notifications === 'object') {
    base.notifications = { ...base.notifications, ...r.notifications }
  }
  return base
}
