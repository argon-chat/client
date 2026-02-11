/**
 * Argon PlayFrame Host - Watchdog
 * 
 * Monitors iframe health and terminates unresponsive games.
 */

import { HEARTBEAT_TIMEOUT, DEFAULT_HEARTBEAT_INTERVAL } from '@argon/playframe';

// ============================================================================
// Watchdog Types
// ============================================================================

export interface WatchdogConfig {
  /** Heartbeat interval in ms */
  heartbeatInterval: number;
  /** Timeout before triggering kill */
  timeout: number;
  /** Maximum consecutive missed heartbeats before kill */
  maxMissedHeartbeats: number;
  /** Callback when watchdog triggers */
  onTimeout: () => void;
  /** Callback for health reports */
  onHealthReport?: (health: HealthReport) => void;
}

export interface HealthReport {
  /** Current state */
  state: 'healthy' | 'warning' | 'critical';
  /** Last successful heartbeat timestamp */
  lastHeartbeat: number;
  /** Number of missed heartbeats */
  missedHeartbeats: number;
  /** Average response time in ms */
  averageResponseTime: number;
  /** Current response time in ms */
  currentResponseTime: number;
  /** Uptime in ms */
  uptime: number;
}

// ============================================================================
// Watchdog Implementation
// ============================================================================

export class Watchdog {
  private config: WatchdogConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeartbeat: number = 0;
  private missedHeartbeats: number = 0;
  private responseTimes: number[] = [];
  private pendingPing: { time: number; seq: number } | null = null;
  private startTime: number = 0;
  private seq: number = 0;
  private running: boolean = false;

  constructor(config: Partial<WatchdogConfig> & Pick<WatchdogConfig, 'onTimeout'>) {
    this.config = {
      heartbeatInterval: config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      timeout: config.timeout ?? HEARTBEAT_TIMEOUT,
      maxMissedHeartbeats: config.maxMissedHeartbeats ?? 3,
      onTimeout: config.onTimeout,
      onHealthReport: config.onHealthReport,
    };
  }

  /**
   * Start the watchdog.
   */
  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.startTime = Date.now();
    this.lastHeartbeat = this.startTime;
    this.missedHeartbeats = 0;
    this.responseTimes = [];
    this.seq = 0;
    
    // Start heartbeat interval
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.config.heartbeatInterval);
    
    // Send initial ping
    this.sendPing();
  }

  /**
   * Stop the watchdog.
   */
  stop(): void {
    this.running = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    
    this.pendingPing = null;
  }

  /**
   * Record a pong response from the game.
   */
  recordPong(seq: number, gameTime: number): void {
    if (!this.running) return;
    
    // Check if this is the expected pong
    if (!this.pendingPing || this.pendingPing.seq !== seq) {
      // Out of order or duplicate pong
      return;
    }
    
    const responseTime = Date.now() - this.pendingPing.time;
    this.responseTimes.push(responseTime);
    
    // Keep only last 10 response times
    if (this.responseTimes.length > 10) {
      this.responseTimes.shift();
    }
    
    this.lastHeartbeat = Date.now();
    this.missedHeartbeats = 0;
    this.pendingPing = null;
    
    // Clear timeout timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    
    // Report health
    this.reportHealth();
  }

  /**
   * Get the current health report.
   */
  getHealth(): HealthReport {
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;
    
    const currentResponseTime = this.responseTimes[this.responseTimes.length - 1] ?? 0;
    
    let state: HealthReport['state'] = 'healthy';
    if (this.missedHeartbeats >= this.config.maxMissedHeartbeats - 1) {
      state = 'critical';
    } else if (this.missedHeartbeats > 0) {
      state = 'warning';
    }
    
    return {
      state,
      lastHeartbeat: this.lastHeartbeat,
      missedHeartbeats: this.missedHeartbeats,
      averageResponseTime: Math.round(avgResponseTime),
      currentResponseTime,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Callback to get the ping sender function.
   * This should be set by the host to send pings to the iframe.
   */
  private pingSender: ((seq: number, time: number) => void) | null = null;

  setPingSender(sender: (seq: number, time: number) => void): void {
    this.pingSender = sender;
  }

  private sendPing(): void {
    if (!this.running || !this.pingSender) return;
    
    // If there's a pending ping, count it as missed
    if (this.pendingPing) {
      this.missedHeartbeats++;
      
      if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
        this.trigger();
        return;
      }
      
      this.reportHealth();
    }
    
    const time = Date.now();
    this.pendingPing = { time, seq: this.seq };
    this.pingSender(this.seq, time);
    this.seq++;
    
    // Set timeout timer
    this.timeoutTimer = setTimeout(() => {
      this.missedHeartbeats++;
      
      if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
        this.trigger();
      } else {
        this.reportHealth();
      }
    }, this.config.timeout);
  }

  private trigger(): void {
    this.stop();
    this.config.onTimeout();
  }

  private reportHealth(): void {
    if (this.config.onHealthReport) {
      this.config.onHealthReport(this.getHealth());
    }
  }
}

// ============================================================================
// Frame Rate Monitor
// ============================================================================

export interface FrameRateMonitorConfig {
  /** Target FPS */
  targetFps: number;
  /** Sample window in ms */
  sampleWindow: number;
  /** Callback when FPS drops below threshold */
  onFpsDrop?: (currentFps: number, targetFps: number) => void;
  /** Threshold percentage below target to trigger callback (0-1) */
  threshold?: number;
}

export class FrameRateMonitor {
  private config: Required<FrameRateMonitorConfig>;
  private samples: number[] = [];
  private lastSampleTime: number = 0;
  private running: boolean = false;
  private animationFrameId: number | null = null;

  constructor(config: FrameRateMonitorConfig) {
    this.config = {
      targetFps: config.targetFps,
      sampleWindow: config.sampleWindow,
      onFpsDrop: config.onFpsDrop ?? (() => {}),
      threshold: config.threshold ?? 0.8,
    };
  }

  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.samples = [];
    this.lastSampleTime = performance.now();
    
    this.tick(this.lastSampleTime);
  }

  stop(): void {
    this.running = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  getCurrentFps(): number {
    if (this.samples.length < 2) return 0;
    
    const totalTime = this.samples[this.samples.length - 1] - this.samples[0];
    if (totalTime === 0) return 0;
    
    return Math.round((this.samples.length - 1) / (totalTime / 1000));
  }

  private tick(timestamp: number): void {
    if (!this.running) return;
    
    this.samples.push(timestamp);
    
    // Remove samples outside the window
    const windowStart = timestamp - this.config.sampleWindow;
    while (this.samples.length > 0 && this.samples[0] < windowStart) {
      this.samples.shift();
    }
    
    // Check FPS
    const currentFps = this.getCurrentFps();
    const targetMinFps = this.config.targetFps * this.config.threshold;
    
    if (currentFps > 0 && currentFps < targetMinFps) {
      this.config.onFpsDrop(currentFps, this.config.targetFps);
    }
    
    this.animationFrameId = requestAnimationFrame((t) => this.tick(t));
  }
}

// ============================================================================
// Memory Monitor (experimental)
// ============================================================================

export interface MemoryInfo {
  /** JS heap size limit in bytes */
  jsHeapSizeLimit?: number;
  /** Total JS heap size in bytes */
  totalJSHeapSize?: number;
  /** Used JS heap size in bytes */
  usedJSHeapSize?: number;
}

/**
 * Get memory info if available (Chrome only).
 */
export function getMemoryInfo(): MemoryInfo | null {
  const perf = performance as Performance & {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  };
  
  if (!perf.memory) return null;
  
  return {
    jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
    totalJSHeapSize: perf.memory.totalJSHeapSize,
    usedJSHeapSize: perf.memory.usedJSHeapSize,
  };
}
