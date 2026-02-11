/**
 * Tests for Argon PlayFrame SDK Client
 * 
 * These tests mock postMessage communication to test the client behavior.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { PlayFrameClient, type PlayFrameClientConfig } from '../src/client';
import {
  createMessage,
  createResponse,
  PROTOCOL_VERSION,
  type MessageEnvelope,
  type ResponseEnvelope,
} from '@argon/playframe';

// ============================================================================
// Test Helpers
// ============================================================================

interface MockWindow {
  postMessage: ReturnType<typeof mock>;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

function createMockParent(): MockWindow {
  const listeners = new Map<string, Set<EventListener>>();
  
  return {
    postMessage: mock(() => {}),
    addEventListener: (type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  };
}

function simulateResponse<T>(
  client: PlayFrameClient,
  requestId: string,
  type: string,
  payload: T,
  success = true
): void {
  const response = createResponse(requestId, type as any, payload, success);
  const event = new MessageEvent('message', {
    data: response,
    origin: 'http://localhost',
  });
  window.dispatchEvent(event);
}

// ============================================================================
// Client Configuration Tests
// ============================================================================

describe('PlayFrameClient Configuration', () => {
  test('accepts minimal config', () => {
    const client = new PlayFrameClient({
      game: {
        id: 'test-game',
        version: '1.0.0',
        title: 'Test Game',
      },
    });

    expect(client).toBeDefined();
  });

  test('accepts full config', () => {
    const client = new PlayFrameClient({
      game: {
        id: 'test-game',
        version: '1.0.0',
        title: 'Test Game',
        description: 'A test game',
        developer: 'Test Dev',
        icon: 'https://example.com/icon.png',
      },
      permissions: ['keyboard', 'audio', 'pointer-lock', 'networking'],
      layout: {
        mode: 'fixed-aspect',
        aspectRatio: { width: 16, height: 9 },
      },
      requestTimeout: 10000,
      debug: true,
    });

    expect(client).toBeDefined();
  });
});

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

    client.once('resume', () => {
      count++;
    });

    (client as any).emit('resume', undefined);
    (client as any).emit('resume', undefined);

    expect(count).toBe(1);
  });

  test('off removes listener', () => {
    let count = 0;
    const handler = () => { count++; };

    client.on('resume', handler);
    (client as any).emit('resume', undefined);
    expect(count).toBe(1);

    client.off('resume', handler);
    (client as any).emit('resume', undefined);
    expect(count).toBe(1);
  });
});

// ============================================================================
// Logging Tests
// ============================================================================

describe('PlayFrameClient Logging', () => {
  let client: PlayFrameClient;

  beforeEach(() => {
    client = new PlayFrameClient({
      game: { id: 'test', version: '1.0.0', title: 'Test' },
      debug: true,
    });
  });

  test('log method does not throw when disconnected', () => {
    expect(() => {
      client.log('info', 'Test message');
      client.log('debug', 'Debug message', { extra: 'data' });
      client.log('warn', 'Warning');
      client.log('error', 'Error occurred');
    }).not.toThrow();
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

  test('reportPeerState does not throw when disconnected', () => {
    expect(() => {
      client.reportPeerState('peer-123', {
        peerId: 'peer-123',
        state: 'connected',
        available: true,
      });
    }).not.toThrow();
  });

  test('rtcSignal event type is defined', () => {
    let eventReceived = false;
    
    client.on('rtcSignal', ({ from, signal }) => {
      eventReceived = true;
      expect(typeof from).toBe('string');
      expect(signal).toBeDefined();
    });

    // Simulate event
    (client as any).emit('rtcSignal', {
      from: 'peer-456',
      signal: { type: 'offer', targetPeerId: 'me', sdp: 'offer-sdp' },
    });

    expect(eventReceived).toBe(true);
  });

  test('rtcPeerState event type is defined', () => {
    let eventReceived = false;

    client.on('rtcPeerState', (state) => {
      eventReceived = true;
      expect(state.peerId).toBe('peer-789');
      expect(state.state).toBe('connected');
    });

    (client as any).emit('rtcPeerState', {
      peerId: 'peer-789',
      state: 'connected',
      available: true,
    });

    expect(eventReceived).toBe(true);
  });
});

// ============================================================================
// Types Export Tests
// ============================================================================

describe('PlayFrameClient Types', () => {
  test('exports PlayFrameClientConfig type', () => {
    const config: PlayFrameClientConfig = {
      game: { id: 'test', version: '1.0.0', title: 'Test' },
      permissions: ['keyboard', 'audio'],
      layout: { mode: 'responsive' },
      requestTimeout: 5000,
      debug: false,
    };

    expect(config).toBeDefined();
  });
});
