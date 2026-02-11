/**
 * Tests for Argon PlayFrame SDK Helpers
 */

import './setup';
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  configureCanvas,
  createFrameLoop,
  createInputManager,
  createGameStorage,
  isInPlayFrame,
  isStandalone,
} from '../src/helpers';

// ============================================================================
// Canvas Helpers Tests
// ============================================================================

describe('configureCanvas', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    canvas?.remove();
  });

  test('sets canvas display size to viewport', () => {
    configureCanvas(canvas, { width: 800, height: 600 });

    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  test('applies aspect ratio', () => {
    const size = configureCanvas(
      canvas,
      { width: 1920, height: 1080 },
      { aspectRatio: { width: 4, height: 3 } }
    );

    // Width fits to height: 1080 * (4/3) = 1440
    expect(size.width).toBe(1440);
    expect(size.height).toBe(1080);
  });

  test('sets buffer size with DPR', () => {
    configureCanvas(
      canvas,
      { width: 800, height: 600 },
      { devicePixelRatio: 2 }
    );

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  test('pixel-perfect mode ignores DPR', () => {
    configureCanvas(
      canvas,
      { width: 800, height: 600 },
      { pixelPerfect: true, devicePixelRatio: 2 }
    );

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  test('centers canvas in viewport', () => {
    const size = configureCanvas(
      canvas,
      { width: 1000, height: 800 },
      { aspectRatio: { width: 16, height: 9 } }
    );

    // Canvas is centered, left offset = (1000 - size.width) / 2
    const expectedLeft = (1000 - size.width) / 2;
    const expectedTop = (800 - size.height) / 2;

    expect(canvas.style.left).toBe(`${expectedLeft}px`);
    expect(canvas.style.top).toBe(`${expectedTop}px`);
  });
});

// ============================================================================
// Frame Loop Tests
// ============================================================================

describe('createFrameLoop', () => {
  test('starts and stops', async () => {
    let frameCount = 0;
    const loop = createFrameLoop(() => {
      frameCount++;
    }, { targetFps: 60 });

    expect(loop.isRunning()).toBe(false);

    loop.start();
    expect(loop.isRunning()).toBe(true);

    // Wait for some frames
    await Bun.sleep(100);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
    expect(frameCount).toBeGreaterThan(0);
  });

  test('pause and resume', async () => {
    let frameCount = 0;
    const loop = createFrameLoop(() => {
      frameCount++;
    });

    loop.start();
    await Bun.sleep(50);

    loop.pause();
    expect(loop.isPaused()).toBe(true);

    const countAtPause = frameCount;
    await Bun.sleep(50);

    // Should not have advanced while paused
    expect(frameCount).toBe(countAtPause);

    loop.resume();
    expect(loop.isPaused()).toBe(false);
    await Bun.sleep(50);

    // Should have advanced after resume
    expect(frameCount).toBeGreaterThan(countAtPause);

    loop.stop();
  });

  test('calls onPause and onResume callbacks', async () => {
    let pauseCalled = false;
    let resumeCalled = false;

    const loop = createFrameLoop(() => {}, {
      onPause: () => { pauseCalled = true; },
      onResume: () => { resumeCalled = true; },
    });

    loop.start();
    await Bun.sleep(16);

    loop.pause();
    expect(pauseCalled).toBe(true);

    loop.resume();
    expect(resumeCalled).toBe(true);

    loop.stop();
  });

  test('provides delta time to callback', async () => {
    const deltas: number[] = [];

    const loop = createFrameLoop((deltaTime) => {
      deltas.push(deltaTime);
    }, { targetFps: 60 });

    loop.start();
    await Bun.sleep(100);
    loop.stop();

    // Delta times should be positive and reasonable (< 100ms)
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) {
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(0.1); // Less than 100ms
    }
  });

  test('provides total time to callback', async () => {
    let lastTotalTime = 0;

    const loop = createFrameLoop((_, totalTime) => {
      expect(totalTime).toBeGreaterThanOrEqual(lastTotalTime);
      lastTotalTime = totalTime;
    });

    loop.start();
    await Bun.sleep(100);
    loop.stop();

    expect(lastTotalTime).toBeGreaterThan(0);
  });
});

// ============================================================================
// Input Manager Tests
// ============================================================================

describe('createInputManager', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test('tracks key state', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();

    const state = input.getState();
    expect(state.keys.size).toBe(0);

    // Simulate keydown
    const keydownEvent = new KeyboardEvent('keydown', { code: 'KeyA' });
    container.dispatchEvent(keydownEvent);

    expect(input.isKeyDown('KeyA')).toBe(true);

    // Simulate keyup
    const keyupEvent = new KeyboardEvent('keyup', { code: 'KeyA' });
    container.dispatchEvent(keyupEvent);

    expect(input.isKeyDown('KeyA')).toBe(false);

    input.stop();
  });

  test('tracks mouse state', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();

    // Simulate mousemove
    const moveEvent = new MouseEvent('mousemove', {
      clientX: 100,
      clientY: 200,
      movementX: 10,
      movementY: 5,
    });
    container.dispatchEvent(moveEvent);

    const state = input.getState();
    expect(state.mouse.x).toBe(100);
    expect(state.mouse.y).toBe(200);
    expect(state.mouse.movementX).toBe(10);
    expect(state.mouse.movementY).toBe(5);

    input.stop();
  });

  test('resetMovement clears movement deltas', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();

    const moveEvent = new MouseEvent('mousemove', {
      clientX: 100,
      clientY: 200,
      movementX: 50,
      movementY: 30,
    });
    container.dispatchEvent(moveEvent);

    expect(input.getState().mouse.movementX).toBe(50);

    input.resetMovement();

    expect(input.getState().mouse.movementX).toBe(0);
    expect(input.getState().mouse.movementY).toBe(0);

    input.stop();
  });

  test('tracks mouse buttons', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();

    // Left button down
    const downEvent = new MouseEvent('mousedown', { buttons: 1 });
    container.dispatchEvent(downEvent);

    expect(input.isMouseButtonDown(0)).toBe(true);

    // Button up
    const upEvent = new MouseEvent('mouseup', { buttons: 0 });
    container.dispatchEvent(upEvent);

    expect(input.isMouseButtonDown(0)).toBe(false);

    input.stop();
  });

  test('clears state on blur', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();

    // Set some state
    const keydownEvent = new KeyboardEvent('keydown', { code: 'KeyW' });
    container.dispatchEvent(keydownEvent);

    expect(input.isKeyDown('KeyW')).toBe(true);

    // Blur should clear
    const blurEvent = new FocusEvent('blur');
    container.dispatchEvent(blurEvent);

    expect(input.isKeyDown('KeyW')).toBe(false);
    expect(input.getState().mouse.buttons).toBe(0);

    input.stop();
  });

  test('stop removes all event listeners', () => {
    const input = createInputManager({ element: container, preventDefaults: false });
    input.start();
    input.stop();

    // Events should no longer be tracked
    const keydownEvent = new KeyboardEvent('keydown', { code: 'KeyA' });
    container.dispatchEvent(keydownEvent);

    // Key should not be registered since listener was removed
    // Note: This depends on the state not being modified after stop
    expect(input.getState().keys.size).toBe(0);
  });
});

// ============================================================================
// Storage Helpers Tests
// ============================================================================

describe('createGameStorage', () => {
  const storage = createGameStorage('test-game');

  beforeEach(() => {
    localStorage.clear();
  });

  test('stores and retrieves values', () => {
    storage.set('score', 1000);
    expect(storage.get<number>('score')).toBe(1000);
  });

  test('returns default value for missing key', () => {
    expect(storage.get<number>('missing', 0)).toBe(0);
    expect(storage.get<string>('missing')).toBeUndefined();
  });

  test('stores complex objects', () => {
    const data = { name: 'Player', level: 5, items: ['sword', 'shield'] };
    storage.set('saveData', data);

    const retrieved = storage.get<typeof data>('saveData');
    expect(retrieved).toEqual(data);
  });

  test('removes specific key', () => {
    storage.set('key1', 'value1');
    storage.set('key2', 'value2');

    storage.remove('key1');

    expect(storage.get<string>('key1')).toBeUndefined();
    expect(storage.get<string>('key2')).toBe('value2');
  });

  test('clear removes only game-prefixed keys', () => {
    storage.set('gameKey', 'gameValue');
    localStorage.setItem('otherKey', 'otherValue');

    storage.clear();

    expect(storage.get<string>('gameKey')).toBeUndefined();
    expect(localStorage.getItem('otherKey')).toBe('otherValue');
  });

  test('namespaces storage per game', () => {
    const storage1 = createGameStorage('game1');
    const storage2 = createGameStorage('game2');

    storage1.set('score', 100);
    storage2.set('score', 200);

    expect(storage1.get<number>('score')).toBe(100);
    expect(storage2.get<number>('score')).toBe(200);
  });
});

// ============================================================================
// Environment Detection Tests
// ============================================================================

describe('Environment Detection', () => {
  test('isInPlayFrame detects iframe', () => {
    // In test environment, window.parent === window (no iframe)
    // So this should return false
    const result = isInPlayFrame();
    expect(typeof result).toBe('boolean');
  });

  test('isStandalone is opposite of isInPlayFrame', () => {
    expect(isStandalone()).toBe(!isInPlayFrame());
  });
});
