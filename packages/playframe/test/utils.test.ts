/**
 * Tests for Argon PlayFrame Utilities
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  RequestTracker,
  calculateAspectFitDimensions,
  calculatePixelPerfectDimensions,
  clampDimensions,
  shouldBlockKey,
  normalizeKeyEvent,
  buildCspHeader,
  parseCspHeader,
  mergeCspDirectives,
  debounce,
  throttle,
  EventEmitter,
} from '../src/utils';
import type { ResponseEnvelope } from '../src/protocol';

// ============================================================================
// RequestTracker Tests
// ============================================================================

describe('RequestTracker', () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    tracker = new RequestTracker(100); // 100ms timeout for tests
  });

  test('creates pending request', async () => {
    const promise = tracker.create<{ value: number }>('msg-1', 'get-user');
    expect(tracker.size).toBe(1);

    // Resolve it
    tracker.resolve('msg-1', {
      protocol: 'argon-playframe',
      version: 1,
      id: 'resp-1',
      requestId: 'msg-1',
      type: 'get-user',
      timestamp: Date.now(),
      payload: { value: 42 },
      success: true,
    } as ResponseEnvelope<{ value: number }>);

    const result = await promise;
    expect(result).toEqual({ value: 42 });
    expect(tracker.size).toBe(0);
  });

  test('rejects on error response', async () => {
    const promise = tracker.create('msg-2', 'get-user');

    tracker.resolve('msg-2', {
      protocol: 'argon-playframe',
      version: 1,
      id: 'resp-2',
      requestId: 'msg-2',
      type: 'get-user',
      timestamp: Date.now(),
      payload: {},
      success: false,
      error: { code: 'PERMISSION_DENIED', message: 'Not allowed' },
    } as ResponseEnvelope);

    await expect(promise).rejects.toThrow('Not allowed');
  });

  test('times out after delay', async () => {
    const promise = tracker.create('msg-3', 'get-user', 50);

    await expect(promise).rejects.toThrow('timed out');
    expect(tracker.size).toBe(0);
  });

  test('cancel removes pending request', async () => {
    const promise = tracker.create('msg-4', 'get-user');
    expect(tracker.size).toBe(1);

    tracker.cancel('msg-4', 'Test cancel');

    await expect(promise).rejects.toThrow('Test cancel');
    expect(tracker.size).toBe(0);
  });

  test('cancelAll cancels all pending requests', async () => {
    const p1 = tracker.create('msg-5', 'get-user');
    const p2 = tracker.create('msg-6', 'get-context');
    expect(tracker.size).toBe(2);

    tracker.cancelAll('Shutdown');

    await expect(p1).rejects.toThrow('Shutdown');
    await expect(p2).rejects.toThrow('Shutdown');
    expect(tracker.size).toBe(0);
  });

  test('resolve returns false for unknown request', () => {
    const result = tracker.resolve('unknown', {
      protocol: 'argon-playframe',
      version: 1,
      id: 'resp',
      requestId: 'unknown',
      type: 'get-user',
      timestamp: Date.now(),
      payload: {},
      success: true,
    } as ResponseEnvelope);

    expect(result).toBe(false);
  });
});

// ============================================================================
// Layout Utilities Tests
// ============================================================================

describe('calculateAspectFitDimensions', () => {
  test('fits to height when container is wider', () => {
    const result = calculateAspectFitDimensions(
      { width: 1920, height: 1080 },
      { width: 4, height: 3 } // 4:3 aspect ratio
    );

    // Height stays 1080, width = 1080 * (4/3) = 1440
    expect(result.height).toBe(1080);
    expect(result.width).toBe(1440);
  });

  test('fits to width when container is taller', () => {
    const result = calculateAspectFitDimensions(
      { width: 800, height: 1200 },
      { width: 16, height: 9 }
    );

    // Width stays 800, height = 800 / (16/9) = 450
    expect(result.width).toBe(800);
    expect(result.height).toBe(450);
  });

  test('handles square container with 16:9 aspect', () => {
    const result = calculateAspectFitDimensions(
      { width: 1000, height: 1000 },
      { width: 16, height: 9 }
    );

    // 16:9 = 1.777..., container is 1:1
    // Width stays 1000, height = 1000 / 1.777 = 562
    expect(result.width).toBe(1000);
    expect(result.height).toBe(562);
  });

  test('handles exact aspect ratio match', () => {
    const result = calculateAspectFitDimensions(
      { width: 1600, height: 900 },
      { width: 16, height: 9 }
    );

    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
  });
});

describe('calculatePixelPerfectDimensions', () => {
  test('calculates integer scale factor', () => {
    const result = calculatePixelPerfectDimensions(
      { width: 1920, height: 1080 },
      { width: 320, height: 180 }
    );

    // Scale X = 1920/320 = 6, Scale Y = 1080/180 = 6
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test('uses minimum scale to maintain aspect ratio', () => {
    const result = calculatePixelPerfectDimensions(
      { width: 1000, height: 600 },
      { width: 320, height: 240 }
    );

    // Scale X = floor(1000/320) = 3, Scale Y = floor(600/240) = 2
    // Use min(3, 2) = 2
    expect(result.width).toBe(640); // 320 * 2
    expect(result.height).toBe(480); // 240 * 2
  });

  test('minimum scale is 1', () => {
    const result = calculatePixelPerfectDimensions(
      { width: 100, height: 100 },
      { width: 320, height: 240 }
    );

    // Scale would be 0, but minimum is 1
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });
});

describe('clampDimensions', () => {
  test('clamps to minimum', () => {
    const result = clampDimensions(
      { width: 100, height: 50 },
      { width: 200, height: 100 }
    );

    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  test('clamps to maximum', () => {
    const result = clampDimensions(
      { width: 2000, height: 1500 },
      undefined,
      { width: 1920, height: 1080 }
    );

    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test('clamps both min and max', () => {
    const result = clampDimensions(
      { width: 50, height: 2000 },
      { width: 100, height: 100 },
      { width: 1000, height: 1000 }
    );

    expect(result.width).toBe(100);
    expect(result.height).toBe(1000);
  });

  test('passes through when within bounds', () => {
    const result = clampDimensions(
      { width: 500, height: 400 },
      { width: 100, height: 100 },
      { width: 1000, height: 1000 }
    );

    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });
});

// ============================================================================
// Input Utilities Tests
// ============================================================================

describe('shouldBlockKey', () => {
  // Mock KeyboardEvent
  const createKeyEvent = (key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({
      key,
      code: options.code || `Key${key.toUpperCase()}`,
      ctrlKey: options.ctrlKey ?? false,
      altKey: options.altKey ?? false,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      repeat: options.repeat ?? false,
    } as KeyboardEvent);

  test('blocks F11 (fullscreen)', () => {
    expect(shouldBlockKey(createKeyEvent('F11'))).toBe(true);
  });

  test('blocks F12 (devtools)', () => {
    expect(shouldBlockKey(createKeyEvent('F12'))).toBe(true);
  });

  test('blocks Ctrl+W (close tab)', () => {
    expect(shouldBlockKey(createKeyEvent('w', { ctrlKey: true }))).toBe(true);
  });

  test('blocks Ctrl+T (new tab)', () => {
    expect(shouldBlockKey(createKeyEvent('t', { ctrlKey: true }))).toBe(true);
  });

  test('blocks Ctrl+N (new window)', () => {
    expect(shouldBlockKey(createKeyEvent('n', { ctrlKey: true }))).toBe(true);
  });

  test('allows regular keys', () => {
    expect(shouldBlockKey(createKeyEvent('a'))).toBe(false);
    expect(shouldBlockKey(createKeyEvent('Space'))).toBe(false);
    expect(shouldBlockKey(createKeyEvent('ArrowUp'))).toBe(false);
  });

  test('allows Ctrl+C (games might need copy)', () => {
    // This depends on your ALWAYS_BLOCKED_COMBOS config
    // Adjust test based on actual blocked combos
    expect(shouldBlockKey(createKeyEvent('c', { ctrlKey: true }))).toBe(false);
  });
});

describe('normalizeKeyEvent', () => {
  const createKeyEvent = (options: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      key: options.key || 'a',
      code: options.code || 'KeyA',
      ctrlKey: options.ctrlKey ?? false,
      altKey: options.altKey ?? false,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      repeat: options.repeat ?? false,
    } as KeyboardEvent);

  test('normalizes key event', () => {
    const event = createKeyEvent({
      key: 'A',
      code: 'KeyA',
      shiftKey: true,
    });

    const normalized = normalizeKeyEvent(event);

    expect(normalized).toEqual({
      key: 'A',
      code: 'KeyA',
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
      repeat: false,
    });
  });

  test('captures all modifiers', () => {
    const event = createKeyEvent({
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: true,
      repeat: true,
    });

    const normalized = normalizeKeyEvent(event);

    expect(normalized.ctrl).toBe(true);
    expect(normalized.alt).toBe(true);
    expect(normalized.shift).toBe(true);
    expect(normalized.meta).toBe(true);
    expect(normalized.repeat).toBe(true);
  });
});

// ============================================================================
// CSP Utilities Tests
// ============================================================================

describe('buildCspHeader', () => {
  test('builds CSP header from directives', () => {
    const header = buildCspHeader({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
    });

    expect(header).toBe("default-src 'self'; script-src 'self' 'unsafe-inline'");
  });

  test('handles empty directives', () => {
    const header = buildCspHeader({});
    expect(header).toBe('');
  });

  test('handles single directive', () => {
    const header = buildCspHeader({
      'frame-ancestors': ['https://example.com'],
    });
    expect(header).toBe('frame-ancestors https://example.com');
  });
});

describe('parseCspHeader', () => {
  test('parses CSP header into directives', () => {
    const directives = parseCspHeader("default-src 'self'; script-src 'self' 'unsafe-inline'");

    expect(directives).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
    });
  });

  test('handles empty header', () => {
    const directives = parseCspHeader('');
    expect(directives).toEqual({});
  });

  test('handles whitespace variations', () => {
    const directives = parseCspHeader("  default-src   'self'  ;  script-src  'none'  ");

    expect(directives).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'none'"],
    });
  });
});

describe('mergeCspDirectives', () => {
  test('merges directives', () => {
    const merged = mergeCspDirectives(
      { 'script-src': ["'self'"] },
      { 'script-src': ["'unsafe-inline'"], 'style-src': ["'self'"] }
    );

    expect(merged).toEqual({
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'"],
    });
  });

  test('does not duplicate values', () => {
    const merged = mergeCspDirectives(
      { 'script-src': ["'self'", 'https://example.com'] },
      { 'script-src': ["'self'", 'https://other.com'] }
    );

    expect(merged['script-src']).toEqual(["'self'", 'https://example.com', 'https://other.com']);
  });

  test('does not mutate original', () => {
    const base = { 'script-src': ["'self'"] };
    const ext = { 'script-src': ["'unsafe-inline'"] };

    mergeCspDirectives(base, ext);

    expect(base['script-src']).toEqual(["'self'"]);
  });
});

// ============================================================================
// Timing Utilities Tests
// ============================================================================

describe('debounce', () => {
  test('debounces function calls', async () => {
    let callCount = 0;
    const fn = debounce(() => callCount++, 50);

    fn();
    fn();
    fn();

    expect(callCount).toBe(0);

    await Bun.sleep(100);
    expect(callCount).toBe(1);
  });

  test('cancel prevents execution', async () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 50);

    fn();
    fn.cancel();

    await Bun.sleep(100);
    expect(called).toBe(false);
  });
});

describe('throttle', () => {
  test('throttles function calls', async () => {
    let callCount = 0;
    const fn = throttle(() => callCount++, 50);

    fn(); // Executes immediately
    fn(); // Queued
    fn(); // Ignored (already queued)

    expect(callCount).toBe(1);

    await Bun.sleep(100);
    expect(callCount).toBe(2);
  });
});

// ============================================================================
// EventEmitter Tests
// ============================================================================

describe('EventEmitter', () => {
  interface TestEvents {
    data: { value: number };
    error: Error;
    empty: void;
  }

  let emitter: EventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEvents>();
  });

  test('registers and calls handlers', () => {
    let received: { value: number } | undefined;
    emitter.on('data', (data) => { received = data; });

    emitter.emit('data', { value: 42 });

    expect(received).toBeDefined();
    expect(received!.value).toBe(42);
  });

  test('handles multiple listeners', () => {
    const values: number[] = [];
    emitter.on('data', (d) => values.push(d.value));
    emitter.on('data', (d) => values.push(d.value * 2));

    emitter.emit('data', { value: 10 });

    expect(values).toEqual([10, 20]);
  });

  test('on() returns unsubscribe function', () => {
    let called = false;
    const unsub = emitter.on('data', () => { called = true; });

    unsub();
    emitter.emit('data', { value: 1 });

    expect(called).toBe(false);
  });

  test('once() fires only once', () => {
    let count = 0;
    emitter.once('data', () => count++);

    emitter.emit('data', { value: 1 });
    emitter.emit('data', { value: 2 });
    emitter.emit('data', { value: 3 });

    expect(count).toBe(1);
  });

  test('off() removes specific handler', () => {
    let count = 0;
    const handler = () => count++;

    emitter.on('data', handler);
    emitter.emit('data', { value: 1 });
    expect(count).toBe(1);

    emitter.off('data', handler);
    emitter.emit('data', { value: 2 });
    expect(count).toBe(1);
  });

  test('removeAllListeners() for specific event', () => {
    let dataCount = 0;
    let errorCount = 0;

    emitter.on('data', () => dataCount++);
    emitter.on('error', () => errorCount++);

    emitter.removeAllListeners('data');

    emitter.emit('data', { value: 1 });
    emitter.emit('error', new Error('test'));

    expect(dataCount).toBe(0);
    expect(errorCount).toBe(1);
  });

  test('removeAllListeners() without argument clears all', () => {
    let dataCount = 0;
    let errorCount = 0;

    emitter.on('data', () => dataCount++);
    emitter.on('error', () => errorCount++);

    emitter.removeAllListeners();

    emitter.emit('data', { value: 1 });
    emitter.emit('error', new Error('test'));

    expect(dataCount).toBe(0);
    expect(errorCount).toBe(0);
  });

  test('handles handler errors gracefully', () => {
    let secondCalled = false;

    emitter.on('data', () => { throw new Error('Handler error'); });
    emitter.on('data', () => { secondCalled = true; });

    // Should not throw, should continue to second handler
    emitter.emit('data', { value: 1 });

    expect(secondCalled).toBe(true);
  });

  test('handles void event type', () => {
    let called = false;
    emitter.on('empty', () => { called = true; });

    emitter.emit('empty', undefined as unknown as void);

    expect(called).toBe(true);
  });
});
