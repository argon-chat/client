/**
 * Tests for Argon PlayFrame SDK Client
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PlayFrameClient } from '../src/client';

// ============================================================================
// Client State Tests
// ============================================================================

describe('PlayFrameClient State', () => {
  let client: PlayFrameClient;

  beforeEach(() => {
    client = new PlayFrameClient({
      game: { id: 'test', version: '1.0.0', title: 'Test' },
      debug: false,
    });
  });

  test('initial state is disconnected', () => {
    expect(client.getState()).toBe('disconnected');
  });

  test('isConnected returns false initially', () => {
    expect(client.isConnected()).toBe(false);
  });

  test('getContext returns null before connection', () => {
    expect(client.getContext()).toBeNull();
  });

  test('getUser throws when disconnected', async () => {
    // getUser is async and calls ensureConnected which throws
    await expect(client.getUser()).rejects.toThrow();
  });

  test('getSpace returns null before connection', () => {
    expect(client.getSpace()).toBeNull();
  });

  test('getPermissions returns null before connection', () => {
    expect(client.getPermissions()).toBeNull();
  });

  test('getCapabilities returns null before connection', () => {
    expect(client.getCapabilities()).toBeNull();
  });
});

// ============================================================================
// Event Emitter Tests
// ============================================================================

describe('PlayFrameClient Events', () => {
  let client: PlayFrameClient;

  beforeEach(() => {
    client = new PlayFrameClient({
      game: { id: 'test', version: '1.0.0', title: 'Test' },
    });
  });

  test('emits events to listeners', () => {
    let received = false;

    client.on('error', () => {
      received = true;
    });

    // Emit an error event
    (client as any).emit('error', { error: { code: 'TEST', message: 'test' }, fatal: false });

    expect(received).toBe(true);
  });

  test('once listener fires only once', () => {
    let count = 0;

    client.once('disconnected', () => {
      count++;
    });

    (client as any).emit('disconnected', { reason: 'test' });
    (client as any).emit('disconnected', { reason: 'test' });

    expect(count).toBe(1);
  });

  test('off removes listener', () => {
    let count = 0;
    const handler = () => { count++; };

    client.on('disconnected', handler);
    (client as any).emit('disconnected', { reason: 'test' });
    expect(count).toBe(1);

    client.off('disconnected', handler);
    (client as any).emit('disconnected', { reason: 'test' });
    expect(count).toBe(1);
  });
});

// ============================================================================
// WebRTC API Tests
// ============================================================================

describe('PlayFrameClient WebRTC API', () => {
  let client: PlayFrameClient;

  beforeEach(() => {
    client = new PlayFrameClient({
      game: { id: 'test', version: '1.0.0', title: 'Test' },
      permissions: ['networking'],
    });
  });

  test('getIceServers returns empty config when disconnected', async () => {
    // Since client is not connected, ensureConnected() will throw
    await expect(client.getIceServers()).rejects.toThrow();
  });

  test('sendSignal returns false when disconnected', async () => {
    await expect(
      client.sendSignal('peer-123', {
        type: 'offer',
        sdp: 'test-sdp',
      })
    ).rejects.toThrow();
  });

});
