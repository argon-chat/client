/**
 * Tests for Argon PlayFrame Protocol
 */

import { describe, test, expect } from 'bun:test';
import {
  PROTOCOL_VERSION,
  PROTOCOL_MIN_VERSION,
  PROTOCOL_MAX_VERSION,
  CURRENT_PROTOCOL,
  generateMessageId,
  createMessage,
  createResponse,
  isValidMessage,
  isResponse,
  isVersionCompatible,
  type MessageEnvelope,
  type ResponseEnvelope,
} from '../src/protocol';

describe('Protocol Versioning', () => {
  test('PROTOCOL_VERSION is defined', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  test('version range is valid', () => {
    expect(PROTOCOL_MIN_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
    expect(PROTOCOL_MAX_VERSION).toBeGreaterThanOrEqual(PROTOCOL_VERSION);
  });

  test('CURRENT_PROTOCOL has correct structure', () => {
    expect(CURRENT_PROTOCOL).toHaveProperty('major');
    expect(CURRENT_PROTOCOL).toHaveProperty('minor');
    expect(CURRENT_PROTOCOL).toHaveProperty('patch');
    expect(CURRENT_PROTOCOL.major).toBe(1);
  });
});

describe('generateMessageId', () => {
  test('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateMessageId());
    }
    expect(ids.size).toBe(1000);
  });

  test('generated ID is a string', () => {
    const id = generateMessageId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('generated ID contains timestamp component', () => {
    const id = generateMessageId();
    // Format: timestamp-counter-random
    const parts = id.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('createMessage', () => {
  test('creates a valid message envelope', () => {
    const payload = { foo: 'bar' };
    const message = createMessage('handshake', payload);

    expect(message.protocol).toBe('argon-playframe');
    expect(message.version).toBe(PROTOCOL_VERSION);
    expect(message.type).toBe('handshake');
    expect(message.payload).toEqual(payload);
    expect(typeof message.id).toBe('string');
    expect(typeof message.timestamp).toBe('number');
  });

  test('timestamp is approximately now', () => {
    const before = Date.now();
    const message = createMessage('ping', {});
    const after = Date.now();

    expect(message.timestamp).toBeGreaterThanOrEqual(before);
    expect(message.timestamp).toBeLessThanOrEqual(after);
  });

  test('each message has unique ID', () => {
    const msg1 = createMessage('ping', {});
    const msg2 = createMessage('ping', {});
    expect(msg1.id).not.toBe(msg2.id);
  });
});

describe('createResponse', () => {
  test('creates a success response', () => {
    const response = createResponse('req-123', 'get-user', { user: 'test' }, true);

    expect(response.protocol).toBe('argon-playframe');
    expect(response.requestId).toBe('req-123');
    expect(response.type).toBe('get-user');
    expect(response.payload).toEqual({ user: 'test' });
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });

  test('creates an error response', () => {
    const error = { code: 'PERMISSION_DENIED' as const, message: 'Not allowed' };
    const response = createResponse('req-456', 'audio-context-request', {}, false, error);

    expect(response.success).toBe(false);
    expect(response.error).toEqual(error);
  });
});

describe('isValidMessage', () => {
  test('validates correct message', () => {
    const message: MessageEnvelope = {
      protocol: 'argon-playframe',
      version: 1,
      id: 'test-id',
      type: 'handshake',
      timestamp: Date.now(),
      payload: {},
    };

    expect(isValidMessage(message)).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidMessage(null)).toBe(false);
  });

  test('rejects non-object', () => {
    expect(isValidMessage('string')).toBe(false);
    expect(isValidMessage(123)).toBe(false);
    expect(isValidMessage(undefined)).toBe(false);
  });

  test('rejects wrong protocol', () => {
    expect(isValidMessage({
      protocol: 'other-protocol',
      version: 1,
      id: 'test',
      type: 'handshake',
      timestamp: Date.now(),
    })).toBe(false);
  });

  test('rejects missing fields', () => {
    expect(isValidMessage({
      protocol: 'argon-playframe',
      version: 1,
      // missing id, type, timestamp
    })).toBe(false);
  });

  test('rejects wrong field types', () => {
    expect(isValidMessage({
      protocol: 'argon-playframe',
      version: '1', // should be number
      id: 'test',
      type: 'handshake',
      timestamp: Date.now(),
    })).toBe(false);
  });
});

describe('isResponse', () => {
  test('identifies response envelope', () => {
    const response: ResponseEnvelope = {
      protocol: 'argon-playframe',
      version: 1,
      id: 'resp-id',
      requestId: 'req-id',
      type: 'get-user',
      timestamp: Date.now(),
      payload: {},
      success: true,
    };

    expect(isResponse(response)).toBe(true);
  });

  test('rejects regular message', () => {
    const message: MessageEnvelope = {
      protocol: 'argon-playframe',
      version: 1,
      id: 'msg-id',
      type: 'handshake',
      timestamp: Date.now(),
      payload: {},
    };

    expect(isResponse(message)).toBe(false);
  });
});

describe('isVersionCompatible', () => {
  test('accepts current version', () => {
    expect(isVersionCompatible(PROTOCOL_VERSION)).toBe(true);
  });

  test('accepts min version', () => {
    expect(isVersionCompatible(PROTOCOL_MIN_VERSION)).toBe(true);
  });

  test('accepts max version', () => {
    expect(isVersionCompatible(PROTOCOL_MAX_VERSION)).toBe(true);
  });

  test('rejects version below min', () => {
    expect(isVersionCompatible(PROTOCOL_MIN_VERSION - 1)).toBe(false);
  });

  test('rejects version above max', () => {
    expect(isVersionCompatible(PROTOCOL_MAX_VERSION + 1)).toBe(false);
  });
});
