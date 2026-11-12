/**
 * Tests for Argon PlayFrame Host - Watchdog
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Watchdog } from '../src/watchdog';

// ============================================================================
// Watchdog Tests
// ============================================================================

describe('Watchdog', () => {
  let watchdog: Watchdog;
  let onTimeout: ReturnType<typeof mock>;
  let onHealthReport: ReturnType<typeof mock>;
  let pingSender: ReturnType<typeof mock>;

  beforeEach(() => {
    onTimeout = mock(() => {});
    onHealthReport = mock(() => {});
    pingSender = mock(() => {});

    watchdog = new Watchdog({
      heartbeatInterval: 50, // Fast for testing
      timeout: 100,
      maxMissedHeartbeats: 3,
      onTimeout,
      onHealthReport,
    });

    watchdog.setPingSender((seq, time) => {
      pingSender(seq, time);
    });
  });

  afterEach(() => {
    watchdog.stop();
  });

  test('sends initial ping on start', () => {
    watchdog.start();
    expect(pingSender).toHaveBeenCalledTimes(1);
  });

  test('records pong and reports healthy', () => {
    watchdog.start();

    // Get the seq from the ping
    const [seq, time] = pingSender.mock.calls[0] as [number, number];

    // Record pong
    watchdog.recordPong(seq, Date.now());

    const health = watchdog.getHealth();
    expect(health.state).toBe('healthy');
    expect(health.missedHeartbeats).toBe(0);
  });

  test('tracks response time', () => {
    watchdog.start();

    const [seq, time] = pingSender.mock.calls[0] as [number, number];

    // Wait a bit before responding
    const startTime = Date.now();
    while (Date.now() - startTime < 10) {
      // Busy wait for 10ms
    }

    watchdog.recordPong(seq, Date.now());

    const health = watchdog.getHealth();
    expect(health.currentResponseTime).toBeGreaterThan(0);
  });

  test('reports health on pong', () => {
    watchdog.start();

    const [seq, time] = pingSender.mock.calls[0] as [number, number];
    watchdog.recordPong(seq, Date.now());

    expect(onHealthReport).toHaveBeenCalled();
  });

  test('counts missed heartbeats', async () => {
    watchdog.start();

    // Wait for multiple heartbeat intervals without responding
    await Bun.sleep(120);

    const health = watchdog.getHealth();
    expect(health.missedHeartbeats).toBeGreaterThan(0);
  });

  test('triggers timeout after max missed heartbeats', async () => {
    watchdog = new Watchdog({
      heartbeatInterval: 20,
      timeout: 50,
      maxMissedHeartbeats: 2,
      onTimeout,
    });

    watchdog.setPingSender(() => {});
    watchdog.start();

    // Wait for timeout
    await Bun.sleep(200);

    expect(onTimeout).toHaveBeenCalled();
  });

  test('calculates uptime', async () => {
    watchdog.start();

    await Bun.sleep(50);

    const health = watchdog.getHealth();
    expect(health.uptime).toBeGreaterThanOrEqual(50);
  });

  test('state transitions to warning then critical', async () => {
    watchdog = new Watchdog({
      heartbeatInterval: 30,
      timeout: 60,
      maxMissedHeartbeats: 3,
      onTimeout,
    });

    watchdog.setPingSender(() => {});
    watchdog.start();

    // Initial state
    expect(watchdog.getHealth().state).toBe('healthy');

    // Wait for first missed heartbeat
    await Bun.sleep(70);
    expect(watchdog.getHealth().missedHeartbeats).toBeGreaterThanOrEqual(1);

    // After missing heartbeats, should transition to warning/critical
    const health = watchdog.getHealth();
    expect(['warning', 'critical']).toContain(health.state);
  });

  test('stop prevents further pings', async () => {
    watchdog.start();
    const initialCalls = pingSender.mock.calls.length;

    watchdog.stop();
    await Bun.sleep(100);

    // No additional pings should be sent
    expect(pingSender.mock.calls.length).toBe(initialCalls);
  });

  test('keeps only last 10 response times', () => {
    watchdog.start();

    // Simulate many pong responses
    for (let i = 0; i < 15; i++) {
      const [seq] = pingSender.mock.calls[pingSender.mock.calls.length - 1] as [number, number];
      watchdog.recordPong(seq, Date.now());
      (watchdog as any).sendPing();
    }

    // Internal responseTimes array should have at most 10 entries
    expect((watchdog as any).responseTimes.length).toBeLessThanOrEqual(10);
  });
});
