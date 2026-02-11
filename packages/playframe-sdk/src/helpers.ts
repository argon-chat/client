/**
 * Argon PlayFrame SDK Helpers
 * 
 * Utility functions and hooks for game development.
 */

import type { Dimensions, AspectRatio } from '@argon/playframe';
import { calculateAspectFitDimensions } from '@argon/playframe';

// ============================================================================
// Canvas Helpers
// ============================================================================

/**
 * Configure a canvas for the current layout.
 */
export function configureCanvas(
  canvas: HTMLCanvasElement,
  viewport: Dimensions,
  options?: {
    aspectRatio?: AspectRatio;
    pixelPerfect?: boolean;
    devicePixelRatio?: number;
  }
): Dimensions {
  const dpr = options?.devicePixelRatio ?? window.devicePixelRatio ?? 1;
  
  let size: Dimensions;
  
  if (options?.aspectRatio) {
    size = calculateAspectFitDimensions(viewport, options.aspectRatio);
  } else {
    size = viewport;
  }
  
  // Set canvas display size
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  
  // Set canvas buffer size (accounting for DPR for crisp rendering)
  if (options?.pixelPerfect) {
    canvas.width = size.width;
    canvas.height = size.height;
  } else {
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
  }
  
  // Center the canvas
  canvas.style.position = 'absolute';
  canvas.style.left = `${(viewport.width - size.width) / 2}px`;
  canvas.style.top = `${(viewport.height - size.height) / 2}px`;
  
  return size;
}

// ============================================================================
// Frame Loop
// ============================================================================

export interface FrameLoopOptions {
  /** Target FPS (0 = uncapped) */
  targetFps?: number;
  /** Pause when document is hidden */
  pauseOnHidden?: boolean;
  /** Callback when frame loop pauses */
  onPause?: () => void;
  /** Callback when frame loop resumes */
  onResume?: () => void;
}

export interface FrameLoopControls {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isRunning: () => boolean;
  isPaused: () => boolean;
  getFps: () => number;
}

/**
 * Create a managed frame loop with FPS limiting and pause support.
 */
export function createFrameLoop(
  callback: (deltaTime: number, totalTime: number) => void,
  options: FrameLoopOptions = {}
): FrameLoopControls {
  const { targetFps = 60, pauseOnHidden = true, onPause, onResume } = options;
  
  let running = false;
  let paused = false;
  let animationFrameId: number | null = null;
  let lastTime = 0;
  let totalTime = 0;
  let frameCount = 0;
  let fpsLastTime = 0;
  let currentFps = 0;
  
  const minFrameTime = targetFps > 0 ? 1000 / targetFps : 0;
  
  function loop(timestamp: number): void {
    if (!running || paused) return;
    
    const deltaMs = timestamp - lastTime;
    
    // FPS limiting
    if (minFrameTime > 0 && deltaMs < minFrameTime) {
      animationFrameId = requestAnimationFrame(loop);
      return;
    }
    
    // Calculate FPS
    frameCount++;
    if (timestamp - fpsLastTime >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      fpsLastTime = timestamp;
    }
    
    // Convert to seconds
    const deltaSec = deltaMs / 1000;
    totalTime += deltaSec;
    lastTime = timestamp;
    
    try {
      callback(deltaSec, totalTime);
    } catch (error) {
      console.error('[PlayFrame] Frame callback error:', error);
    }
    
    animationFrameId = requestAnimationFrame(loop);
  }
  
  function handleVisibilityChange(): void {
    if (!pauseOnHidden) return;
    
    if (document.hidden) {
      if (running && !paused) {
        paused = true;
        onPause?.();
      }
    } else {
      if (running && paused) {
        paused = false;
        lastTime = performance.now();
        onResume?.();
        animationFrameId = requestAnimationFrame(loop);
      }
    }
  }
  
  return {
    start(): void {
      if (running) return;
      
      running = true;
      paused = false;
      lastTime = performance.now();
      fpsLastTime = lastTime;
      
      if (pauseOnHidden) {
        document.addEventListener('visibilitychange', handleVisibilityChange);
      }
      
      animationFrameId = requestAnimationFrame(loop);
    },
    
    stop(): void {
      running = false;
      paused = false;
      
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
    
    pause(): void {
      if (!running || paused) return;
      paused = true;
      onPause?.();
    },
    
    resume(): void {
      if (!running || !paused) return;
      paused = false;
      lastTime = performance.now();
      onResume?.();
      animationFrameId = requestAnimationFrame(loop);
    },
    
    isRunning(): boolean {
      return running;
    },
    
    isPaused(): boolean {
      return paused;
    },
    
    getFps(): number {
      return currentFps;
    },
  };
}

// ============================================================================
// Input Helpers
// ============================================================================

export interface InputState {
  keys: Set<string>;
  mouse: {
    x: number;
    y: number;
    buttons: number;
    movementX: number;
    movementY: number;
  };
  touches: Map<number, { x: number; y: number }>;
}

export interface InputManagerOptions {
  element?: HTMLElement;
  preventDefaults?: boolean;
}

export interface InputManagerControls {
  getState: () => InputState;
  isKeyDown: (key: string) => boolean;
  isMouseButtonDown: (button: number) => boolean;
  resetMovement: () => void;
  start: () => void;
  stop: () => void;
}

/**
 * Create an input manager for handling keyboard, mouse, and touch.
 */
export function createInputManager(options: InputManagerOptions = {}): InputManagerControls {
  const element = options.element ?? document.body;
  const preventDefaults = options.preventDefaults ?? true;
  
  const state: InputState = {
    keys: new Set(),
    mouse: { x: 0, y: 0, buttons: 0, movementX: 0, movementY: 0 },
    touches: new Map(),
  };
  
  const handlers: Array<[string, EventListener]> = [];
  
  function addHandler(type: string, handler: EventListener): void {
    element.addEventListener(type, handler);
    handlers.push([type, handler]);
  }
  
  return {
    getState(): InputState {
      return state;
    },
    
    isKeyDown(key: string): boolean {
      return state.keys.has(key);
    },
    
    isMouseButtonDown(button: number): boolean {
      return (state.mouse.buttons & (1 << button)) !== 0;
    },
    
    resetMovement(): void {
      state.mouse.movementX = 0;
      state.mouse.movementY = 0;
    },
    
    start(): void {
      // Keyboard
      addHandler('keydown', ((e: KeyboardEvent) => {
        state.keys.add(e.code);
        if (preventDefaults) e.preventDefault();
      }) as EventListener);
      
      addHandler('keyup', ((e: KeyboardEvent) => {
        state.keys.delete(e.code);
        if (preventDefaults) e.preventDefault();
      }) as EventListener);
      
      // Mouse
      addHandler('mousemove', ((e: MouseEvent) => {
        state.mouse.x = e.clientX;
        state.mouse.y = e.clientY;
        state.mouse.movementX += e.movementX;
        state.mouse.movementY += e.movementY;
      }) as EventListener);
      
      addHandler('mousedown', ((e: MouseEvent) => {
        state.mouse.buttons = e.buttons;
        if (preventDefaults) e.preventDefault();
      }) as EventListener);
      
      addHandler('mouseup', ((e: MouseEvent) => {
        state.mouse.buttons = e.buttons;
      }) as EventListener);
      
      // Touch
      addHandler('touchstart', ((e: TouchEvent) => {
        for (const touch of e.changedTouches) {
          state.touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
        if (preventDefaults) e.preventDefault();
      }) as EventListener);
      
      addHandler('touchmove', ((e: TouchEvent) => {
        for (const touch of e.changedTouches) {
          state.touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
        if (preventDefaults) e.preventDefault();
      }) as EventListener);
      
      addHandler('touchend', ((e: TouchEvent) => {
        for (const touch of e.changedTouches) {
          state.touches.delete(touch.identifier);
        }
      }) as EventListener);
      
      addHandler('touchcancel', ((e: TouchEvent) => {
        for (const touch of e.changedTouches) {
          state.touches.delete(touch.identifier);
        }
      }) as EventListener);
      
      // Blur - clear all input state
      addHandler('blur', (() => {
        state.keys.clear();
        state.mouse.buttons = 0;
        state.touches.clear();
      }) as EventListener);
    },
    
    stop(): void {
      for (const [type, handler] of handlers) {
        element.removeEventListener(type, handler);
      }
      handlers.length = 0;
    },
  };
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Namespaced storage wrapper for games.
 * Data is stored under a game-specific prefix.
 */
export function createGameStorage(gameId: string) {
  const prefix = `playframe:${gameId}:`;
  
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      try {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw) as T;
      } catch {
        return defaultValue;
      }
    },
    
    set<T>(key: string, value: T): void {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch (error) {
        console.warn('[PlayFrame] Storage write failed:', error);
      }
    },
    
    remove(key: string): void {
      localStorage.removeItem(prefix + key);
    },
    
    clear(): void {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          keys.push(key);
        }
      }
      for (const key of keys) {
        localStorage.removeItem(key);
      }
    },
  };
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if running inside a PlayFrame host.
 */
export function isInPlayFrame(): boolean {
  return window.parent !== window;
}

/**
 * Check if running in standalone/dev mode.
 */
export function isStandalone(): boolean {
  return window.parent === window;
}
