/**
 * Argon PlayFrame Host - DevTools
 * 
 * Development mode utilities and standalone game runner.
 */

import type {
  GameContext,
  EphemeralUser,
  EphemeralSpace,
  Permission,
  HostCapabilities,
  LayoutConfig,
  LayoutState,
  AudioState,
  SessionInfo,
  GameInfo,
} from '@argon/playframe';
import type { HealthReport } from './watchdog';

// ============================================================================
// Dev Mode Configuration
// ============================================================================

export interface DevModeConfig {
  /** Enable dev mode */
  enabled: boolean;
  /** Show debug overlay */
  showOverlay?: boolean;
  /** Log all messages */
  logMessages?: boolean;
  /** Mock user data */
  mockUser?: Partial<EphemeralUser>;
  /** Mock space data */
  mockSpace?: Partial<EphemeralSpace>;
  /** Mock participants */
  mockParticipants?: EphemeralUser[];
  /** Auto-grant all permissions */
  autoGrantPermissions?: boolean;
  /** Disable watchdog in dev mode */
  disableWatchdog?: boolean;
  /** Disable CSP in dev mode (dangerous!) */
  disableCsp?: boolean;
  /** Custom heartbeat interval for testing */
  heartbeatInterval?: number;
}

export const DEFAULT_DEV_CONFIG: DevModeConfig = {
  enabled: false,
  showOverlay: true,
  logMessages: true,
  autoGrantPermissions: true,
  disableWatchdog: true,
  disableCsp: false,
  heartbeatInterval: 5000,
};

// ============================================================================
// Mock Data Generators
// ============================================================================

/**
 * Generate a mock ephemeral user.
 */
export function generateMockUser(overrides?: Partial<EphemeralUser>): EphemeralUser {
  return {
    ephemeralId: `dev-user-${Math.random().toString(36).slice(2, 10)}`,
    displayName: 'Dev Player',
    avatarUrl: null,
    role: 'player',
    state: 'active',
    ...overrides,
  };
}

/**
 * Generate a mock ephemeral space.
 */
export function generateMockSpace(overrides?: Partial<EphemeralSpace>): EphemeralSpace {
  return {
    ephemeralId: `dev-space-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Dev Channel',
    type: 'voice-channel',
    maxParticipants: 8,
    participantCount: 1,
    isPrivate: false,
    ...overrides,
  };
}

/**
 * Generate a mock session info.
 */
export function generateMockSession(): SessionInfo {
  return {
    sessionId: `dev-session-${Math.random().toString(36).slice(2, 10)}`,
    startedAt: Date.now(),
    state: 'playing',
  };
}

/**
 * Generate mock host capabilities.
 */
export function generateMockCapabilities(devMode = true): HostCapabilities {
  return {
    inputTypes: ['mouse', 'keyboard'],
    audioAvailable: true,
    fullscreenAvailable: true,
    pointerLockAvailable: true,
    gamepadAvailable: navigator.getGamepads !== undefined,
    maxFps: 60,
    devMode,
  };
}

/**
 * Generate a full mock game context.
 */
export function generateMockContext(
  game: GameInfo,
  permissions: Permission[],
  config?: DevModeConfig
): GameContext {
  const user = generateMockUser(config?.mockUser);
  const space = generateMockSpace(config?.mockSpace);
  
  return {
    protocolVersion: 1,
    game,
    user,
    space,
    session: generateMockSession(),
    permissions: {
      granted: config?.autoGrantPermissions ? permissions : [],
      denied: config?.autoGrantPermissions ? [] : permissions,
      canRequestMore: true,
    },
    capabilities: generateMockCapabilities(true),
  };
}

// ============================================================================
// Debug Overlay
// ============================================================================

export interface DebugOverlayData {
  /** Connection state */
  state: string;
  /** FPS */
  fps: number;
  /** Memory usage */
  memory?: { used: number; total: number };
  /** Latency */
  latency: number;
  /** Health report */
  health?: HealthReport;
  /** Protocol version */
  protocolVersion: number;
  /** Session ID */
  sessionId: string;
  /** Participant count */
  participantCount: number;
  /** Custom data */
  custom?: Record<string, string | number>;
}

/**
 * Create a debug overlay element.
 */
export function createDebugOverlay(container: HTMLElement): {
  update: (data: Partial<DebugOverlayData>) => void;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  destroy: () => void;
} {
  const overlay = document.createElement('div');
  overlay.id = 'playframe-debug-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 8px;
    right: 8px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.85);
    color: #00ff00;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    line-height: 1.4;
    border-radius: 4px;
    z-index: 999999;
    pointer-events: none;
    min-width: 180px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  `;
  
  let data: DebugOverlayData = {
    state: 'initializing',
    fps: 0,
    latency: 0,
    protocolVersion: 1,
    sessionId: '',
    participantCount: 0,
  };
  
  function render(): void {
    const lines: string[] = [
      `[PlayFrame Dev Mode]`,
      `State: ${data.state}`,
      `FPS: ${data.fps}`,
      `Latency: ${data.latency}ms`,
    ];
    
    if (data.memory) {
      const usedMB = (data.memory.used / 1024 / 1024).toFixed(1);
      const totalMB = (data.memory.total / 1024 / 1024).toFixed(1);
      lines.push(`Memory: ${usedMB}/${totalMB} MB`);
    }
    
    if (data.health) {
      const healthColor = data.health.state === 'healthy' ? '#00ff00' 
        : data.health.state === 'warning' ? '#ffff00' 
        : '#ff0000';
      lines.push(`Health: <span style="color:${healthColor}">${data.health.state}</span>`);
    }
    
    lines.push(`Protocol: v${data.protocolVersion}`);
    lines.push(`Session: ${data.sessionId.slice(0, 12)}...`);
    lines.push(`Players: ${data.participantCount}`);
    
    if (data.custom) {
      lines.push('---');
      for (const [key, value] of Object.entries(data.custom)) {
        lines.push(`${key}: ${value}`);
      }
    }
    
    overlay.innerHTML = lines.join('<br>');
  }
  
  container.appendChild(overlay);
  render();
  
  return {
    update(newData: Partial<DebugOverlayData>): void {
      data = { ...data, ...newData };
      render();
    },
    
    show(): void {
      overlay.style.display = 'block';
    },
    
    hide(): void {
      overlay.style.display = 'none';
    },
    
    toggle(): void {
      overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
    },
    
    destroy(): void {
      overlay.remove();
    },
  };
}

// ============================================================================
// Console Logger
// ============================================================================

export interface MessageLogger {
  logIncoming: (type: string, payload: unknown) => void;
  logOutgoing: (type: string, payload: unknown) => void;
  setEnabled: (enabled: boolean) => void;
}

/**
 * Create a message logger for debugging.
 */
export function createMessageLogger(prefix = '[PlayFrame]'): MessageLogger {
  let enabled = true;
  
  const styles = {
    incoming: 'color: #4CAF50; font-weight: bold',
    outgoing: 'color: #2196F3; font-weight: bold',
    type: 'color: #FF9800',
    payload: 'color: #9E9E9E',
  };
  
  return {
    logIncoming(type: string, payload: unknown): void {
      if (!enabled) return;
      console.groupCollapsed(
        `%c${prefix} %c← %c${type}`,
        styles.payload,
        styles.incoming,
        styles.type
      );
      console.log(payload);
      console.groupEnd();
    },
    
    logOutgoing(type: string, payload: unknown): void {
      if (!enabled) return;
      console.groupCollapsed(
        `%c${prefix} %c→ %c${type}`,
        styles.payload,
        styles.outgoing,
        styles.type
      );
      console.log(payload);
      console.groupEnd();
    },
    
    setEnabled(value: boolean): void {
      enabled = value;
    },
  };
}

// ============================================================================
// Standalone Game Runner
// ============================================================================

export interface StandaloneRunnerConfig {
  /** Game URL to load */
  gameUrl: string;
  /** Container element or selector */
  container: HTMLElement | string;
  /** Game info */
  game: GameInfo;
  /** Dev mode configuration */
  devConfig?: DevModeConfig;
  /** Permissions to grant */
  permissions?: Permission[];
  /** Initial layout */
  layout?: LayoutConfig;
  /** On ready callback */
  onReady?: (context: GameContext) => void;
  /** On error callback */
  onError?: (error: Error) => void;
}

/**
 * Create a standalone game runner for development.
 * This allows running games outside of Argon for testing.
 */
export async function createStandaloneRunner(config: StandaloneRunnerConfig): Promise<{
  iframe: HTMLIFrameElement;
  context: GameContext;
  destroy: () => void;
}> {
  const container = typeof config.container === 'string'
    ? document.querySelector(config.container)
    : config.container;
  
  if (!container || !(container instanceof HTMLElement)) {
    throw new Error('Invalid container');
  }
  
  const devConfig = { ...DEFAULT_DEV_CONFIG, ...config.devConfig };
  const permissions = config.permissions ?? [];
  
  // Create mock context
  const context = generateMockContext(config.game, permissions, devConfig);
  
  // Create iframe (less restrictive in dev mode)
  const iframe = document.createElement('iframe');
  iframe.src = config.gameUrl;
  iframe.style.cssText = `
    border: none;
    width: 100%;
    height: 100%;
    display: block;
  `;
  
  // Less restrictive sandbox in dev mode
  if (!devConfig.disableCsp) {
    iframe.sandbox.value = 'allow-scripts allow-same-origin allow-pointer-lock allow-fullscreen';
  }
  
  container.appendChild(iframe);
  
  // Debug overlay
  let overlay: ReturnType<typeof createDebugOverlay> | null = null;
  if (devConfig.showOverlay) {
    overlay = createDebugOverlay(container);
    overlay.update({
      state: 'loading',
      sessionId: context.session.sessionId,
      protocolVersion: context.protocolVersion,
      participantCount: 1,
    });
  }
  
  // Message logger
  const logger = devConfig.logMessages ? createMessageLogger() : null;
  
  // Wait for iframe to load
  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve();
    iframe.onerror = () => reject(new Error('Failed to load game'));
    
    setTimeout(() => reject(new Error('Game load timeout')), 30000);
  });
  
  overlay?.update({ state: 'connected' });
  config.onReady?.(context);
  
  return {
    iframe,
    context,
    destroy(): void {
      iframe.remove();
      overlay?.destroy();
    },
  };
}

// ============================================================================
// Performance Profiler
// ============================================================================

export interface PerformanceMarker {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export class PerformanceProfiler {
  private markers = new Map<string, PerformanceMarker>();
  private completedMarkers: PerformanceMarker[] = [];

  start(name: string): void {
    this.markers.set(name, {
      name,
      startTime: performance.now(),
    });
  }

  end(name: string): number {
    const marker = this.markers.get(name);
    if (!marker) {
      console.warn(`No marker found: ${name}`);
      return 0;
    }
    
    marker.endTime = performance.now();
    marker.duration = marker.endTime - marker.startTime;
    
    this.markers.delete(name);
    this.completedMarkers.push(marker);
    
    return marker.duration;
  }

  measure<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  getMarkers(): PerformanceMarker[] {
    return [...this.completedMarkers];
  }

  clear(): void {
    this.markers.clear();
    this.completedMarkers = [];
  }

  getSummary(): Record<string, { count: number; total: number; avg: number; min: number; max: number }> {
    const summary: Record<string, number[]> = {};
    
    for (const marker of this.completedMarkers) {
      if (marker.duration === undefined) continue;
      
      if (!summary[marker.name]) {
        summary[marker.name] = [];
      }
      summary[marker.name].push(marker.duration);
    }
    
    const result: Record<string, { count: number; total: number; avg: number; min: number; max: number }> = {};
    
    for (const [name, durations] of Object.entries(summary)) {
      const total = durations.reduce((a, b) => a + b, 0);
      result[name] = {
        count: durations.length,
        total,
        avg: total / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
      };
    }
    
    return result;
  }
}
