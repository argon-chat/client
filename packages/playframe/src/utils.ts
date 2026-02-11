/**
 * Argon PlayFrame Utilities
 * 
 * Shared utilities for message handling, CSP building, and more.
 */

import type { MessageEnvelope, ResponseEnvelope, MessageType } from './protocol';
import type { AspectRatio, Dimensions, LayoutState } from './types';
import { PLAYFRAME_PROTOCOL_ID, ALWAYS_BLOCKED_KEYS, ALWAYS_BLOCKED_COMBOS } from './constants';

// ============================================================================
// Message Utilities
// ============================================================================

/**
 * Type guard for PlayFrame messages.
 */
export function isPlayFrameMessage(event: MessageEvent): event is MessageEvent<MessageEnvelope> {
  const data = event.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    data.protocol === PLAYFRAME_PROTOCOL_ID &&
    typeof data.version === 'number' &&
    typeof data.id === 'string' &&
    typeof data.type === 'string'
  );
}

/**
 * Create a pending request tracker.
 */
export interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  type: MessageType;
  createdAt: number;
}

export class RequestTracker {
  private pending = new Map<string, PendingRequest>();
  private defaultTimeout: number;

  constructor(defaultTimeout = 5000) {
    this.defaultTimeout = defaultTimeout;
  }

  create<T>(
    messageId: string,
    type: MessageType,
    timeout = this.defaultTimeout
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`Request ${type} timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutId,
        type,
        createdAt: Date.now(),
      });
    });
  }

  resolve(requestId: string, response: ResponseEnvelope): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    clearTimeout(request.timeout);
    this.pending.delete(requestId);

    if (response.success) {
      request.resolve(response.payload);
    } else {
      request.reject(new Error(response.error?.message || 'Request failed'));
    }

    return true;
  }

  cancel(messageId: string, reason?: string): void {
    const request = this.pending.get(messageId);
    if (request) {
      clearTimeout(request.timeout);
      this.pending.delete(messageId);
      request.reject(new Error(reason || 'Request cancelled'));
    }
  }

  cancelAll(reason?: string): void {
    for (const [id] of this.pending) {
      this.cancel(id, reason);
    }
  }

  get size(): number {
    return this.pending.size;
  }
}

// ============================================================================
// Layout Utilities
// ============================================================================

/**
 * Calculate dimensions maintaining aspect ratio.
 */
export function calculateAspectFitDimensions(
  container: Dimensions,
  aspectRatio: AspectRatio
): Dimensions {
  const containerRatio = container.width / container.height;
  const targetRatio = aspectRatio.width / aspectRatio.height;

  if (containerRatio > targetRatio) {
    // Container is wider - fit to height
    return {
      width: Math.floor(container.height * targetRatio),
      height: container.height,
    };
  } else {
    // Container is taller - fit to width
    return {
      width: container.width,
      height: Math.floor(container.width / targetRatio),
    };
  }
}

/**
 * Calculate dimensions for pixel-perfect scaling (integer multiples).
 */
export function calculatePixelPerfectDimensions(
  container: Dimensions,
  baseSize: Dimensions
): Dimensions {
  const scaleX = Math.floor(container.width / baseSize.width);
  const scaleY = Math.floor(container.height / baseSize.height);
  const scale = Math.max(1, Math.min(scaleX, scaleY));

  return {
    width: baseSize.width * scale,
    height: baseSize.height * scale,
  };
}

/**
 * Clamp dimensions within min/max bounds.
 */
export function clampDimensions(
  size: Dimensions,
  min?: Dimensions,
  max?: Dimensions
): Dimensions {
  return {
    width: Math.max(min?.width ?? 0, Math.min(max?.width ?? Infinity, size.width)),
    height: Math.max(min?.height ?? 0, Math.min(max?.height ?? Infinity, size.height)),
  };
}

// ============================================================================
// Input Utilities
// ============================================================================

/**
 * Check if a key event should be blocked.
 */
export function shouldBlockKey(event: KeyboardEvent): boolean {
  // Check always blocked keys
  if (ALWAYS_BLOCKED_KEYS.has(event.key)) {
    return true;
  }

  // Check always blocked combinations
  for (const combo of ALWAYS_BLOCKED_COMBOS) {
    const comboObj = combo as { key: string; ctrl?: boolean; alt?: boolean; meta?: boolean };
    if (
      event.key === comboObj.key &&
      event.ctrlKey === (comboObj.ctrl ?? false) &&
      event.altKey === (comboObj.alt ?? false)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize a key event to a consistent format.
 */
export interface NormalizedKeyEvent {
  key: string;
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  repeat: boolean;
}

export function normalizeKeyEvent(event: KeyboardEvent): NormalizedKeyEvent {
  return {
    key: event.key,
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
  };
}

// ============================================================================
// CSP Utilities
// ============================================================================

/**
 * Build a CSP header string from directives.
 */
export function buildCspHeader(
  directives: Record<string, string[]>
): string {
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

/**
 * Parse a CSP header string into directives.
 */
export function parseCspHeader(
  header: string
): Record<string, string[]> {
  const directives: Record<string, string[]> = {};

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [directive, ...values] = trimmed.split(/\s+/);
    if (directive) {
      directives[directive] = values;
    }
  }

  return directives;
}

/**
 * Merge CSP directives, combining values for each directive.
 */
export function mergeCspDirectives(
  base: Record<string, string[]>,
  ...extensions: Record<string, string[]>[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  // Copy base
  for (const [key, values] of Object.entries(base)) {
    result[key] = [...values];
  }

  // Merge extensions
  for (const ext of extensions) {
    for (const [key, values] of Object.entries(ext)) {
      if (result[key]) {
        // Add unique values
        for (const value of values) {
          if (!result[key].includes(value)) {
            result[key].push(value);
          }
        }
      } else {
        result[key] = [...values];
      }
    }
  }

  return result;
}

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Create a frame limiter for requestAnimationFrame throttling.
 */
export function createFrameLimiter(targetFps: number) {
  let lastFrameTime = 0;
  const minFrameInterval = 1000 / targetFps;

  return {
    shouldRender(timestamp: number): boolean {
      const elapsed = timestamp - lastFrameTime;
      if (elapsed >= minFrameInterval) {
        lastFrameTime = timestamp - (elapsed % minFrameInterval);
        return true;
      }
      return false;
    },

    setTargetFps(fps: number): void {
      // minFrameInterval = 1000 / fps; // Commented out as it's a const
    },

    reset(): void {
      lastFrameTime = 0;
    },
  };
}

/**
 * Debounce a function.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced as T & { cancel: () => void };
}

/**
 * Throttle a function.
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number
): T {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = interval - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}

// ============================================================================
// Event Emitter
// ============================================================================

export type EventHandler<T = unknown> = (data: T) => void;

export class EventEmitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);

    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    const wrapper = (data: Events[K]) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${String(event)}:`, error);
      }
    });
  }

  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
