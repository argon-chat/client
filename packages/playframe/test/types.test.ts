/**
 * Tests for Argon PlayFrame WebRTC Types
 */

import { describe, test, expect } from 'bun:test';
import {
  RTC_CHANNEL_PRESETS,
  type IceServer,
  type IceServersConfig,
  type RtcSignalMessage,
  type RtcPeerState,
  type RtcDataChannelConfig,
} from '../src/types';

// ============================================================================
// Type Tests (compile-time validation)
// ============================================================================

describe('WebRTC Types', () => {
  test('IceServer structure', () => {
    const server: IceServer = {
      urls: 'stun:stun.example.com:3478',
    };
    expect(server.urls).toBe('stun:stun.example.com:3478');

    const turnServer: IceServer = {
      urls: ['turn:turn.example.com:3478', 'turn:turn.example.com:5349'],
      username: 'user',
      credential: 'pass',
      credentialType: 'password',
    };
    expect(turnServer.username).toBe('user');
    expect(turnServer.credential).toBe('pass');
  });

  test('IceServersConfig structure', () => {
    const config: IceServersConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { 
          urls: 'turn:turn.example.com:3478',
          username: 'user123',
          credential: 'pass456',
        },
      ],
      ttl: 86400,
      issuedAt: Date.now(),
    };

    expect(config.iceServers.length).toBe(2);
    expect(config.ttl).toBe(86400);
    expect(config.issuedAt).toBeLessThanOrEqual(Date.now());
  });

  test('RtcSignalMessage offer', () => {
    const offer: RtcSignalMessage = {
      type: 'offer',
      targetPeerId: 'peer-123',
      sdp: 'v=0\r\no=- 123...',
    };

    expect(offer.type).toBe('offer');
    expect(offer.targetPeerId).toBe('peer-123');
    expect(offer.sdp).toBeDefined();
  });

  test('RtcSignalMessage answer', () => {
    const answer: RtcSignalMessage = {
      type: 'answer',
      targetPeerId: 'peer-123',
      sourcePeerId: 'peer-456',
      sdp: 'v=0\r\no=- 456...',
    };

    expect(answer.type).toBe('answer');
    expect(answer.sourcePeerId).toBe('peer-456');
  });

  test('RtcSignalMessage ice-candidate', () => {
    const candidate: RtcSignalMessage = {
      type: 'ice-candidate',
      targetPeerId: 'peer-123',
      candidate: {
        candidate: 'candidate:1 1 UDP 2122252543 192.168.1.1 12345 typ host',
        sdpMid: 'audio',
        sdpMLineIndex: 0,
        usernameFragment: 'abc123',
      },
    };

    expect(candidate.type).toBe('ice-candidate');
    expect(candidate.candidate).toBeDefined();
    expect(candidate.candidate?.candidate).toContain('candidate:');
  });

  test('RtcPeerState structure', () => {
    const connected: RtcPeerState = {
      peerId: 'peer-789',
      state: 'connected',
      available: true,
    };

    expect(connected.peerId).toBe('peer-789');
    expect(connected.state).toBe('connected');
    expect(connected.available).toBe(true);

    const failed: RtcPeerState = {
      peerId: 'peer-000',
      state: 'failed',
      available: false,
    };

    expect(failed.state).toBe('failed');
    expect(failed.available).toBe(false);
  });

  test('RtcPeerConnectionState values', () => {
    const states: RtcPeerState['state'][] = [
      'new',
      'connecting',
      'connected',
      'disconnected',
      'failed',
      'closed',
    ];

    for (const state of states) {
      const peerState: RtcPeerState = {
        peerId: 'test',
        state,
        available: state === 'connected',
      };
      expect(peerState.state).toBe(state);
    }
  });
});

// ============================================================================
// Channel Presets Tests
// ============================================================================

describe('RTC_CHANNEL_PRESETS', () => {
  test('reliable preset', () => {
    const preset = RTC_CHANNEL_PRESETS.reliable;
    
    // Should be ordered for reliability
    expect(preset.ordered).toBe(true);
    expect(preset.label).toBe('reliable');
  });

  test('unreliable preset', () => {
    const preset = RTC_CHANNEL_PRESETS.unreliable;
    
    // Should be unordered with no retransmits for lowest latency
    expect(preset.ordered).toBe(false);
    expect(preset.maxRetransmits).toBe(0);
    expect(preset.label).toBe('unreliable');
  });

  test('semiReliable preset', () => {
    const preset = RTC_CHANNEL_PRESETS.semiReliable;
    
    // Should be ordered but with limited retransmits
    expect(preset.ordered).toBe(true);
    expect(preset.maxRetransmits).toBe(3);
    expect(preset.label).toBe('semi-reliable');
  });

  test('presets have valid RtcDataChannelConfig structure', () => {
    const presets = [
      RTC_CHANNEL_PRESETS.reliable,
      RTC_CHANNEL_PRESETS.unreliable,
      RTC_CHANNEL_PRESETS.semiReliable,
    ];

    for (const preset of presets) {
      // All presets should have label and ordered properties
      expect(typeof preset.label).toBe('string');
      expect(typeof preset.ordered).toBe('boolean');
    }
  });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('WebRTC Scenarios', () => {
  test('ICE credential refresh scenario', () => {
    const initialConfig: IceServersConfig = {
      iceServers: [{ urls: 'turn:turn.example.com', username: 'u1', credential: 'c1' }],
      ttl: 3600,
      issuedAt: Date.now() - 3500000, // Issued ~58 minutes ago
    };

    // Check if credentials are about to expire
    const expiresAt = initialConfig.issuedAt + (initialConfig.ttl * 1000);
    const isExpiringSoon = expiresAt - Date.now() < 300000; // Less than 5 min

    expect(isExpiringSoon).toBe(true);
  });

  test('Signaling flow scenario', () => {
    const signals: RtcSignalMessage[] = [];

    // Peer A creates offer
    const offer: RtcSignalMessage = {
      type: 'offer',
      targetPeerId: 'peer-B',
      sdp: 'offer-sdp...',
    };
    signals.push(offer);

    // Peer B receives offer (with source filled in by host)
    const receivedOffer: RtcSignalMessage = {
      ...offer,
      sourcePeerId: 'peer-A',
    };

    // Peer B creates answer
    const answer: RtcSignalMessage = {
      type: 'answer',
      targetPeerId: 'peer-A',
      sourcePeerId: 'peer-B',
      sdp: 'answer-sdp...',
    };
    signals.push(answer);

    // ICE candidates flow
    const iceFromA: RtcSignalMessage = {
      type: 'ice-candidate',
      targetPeerId: 'peer-B',
      candidate: { candidate: 'candidate...', sdpMid: '0', sdpMLineIndex: 0 },
    };
    signals.push(iceFromA);

    expect(signals.length).toBe(3);
    expect(signals[0].type).toBe('offer');
    expect(signals[1].type).toBe('answer');
    expect(signals[2].type).toBe('ice-candidate');
  });

  test('Peer state machine scenario', () => {
    const states: RtcPeerState[] = [];
    const peerId = 'peer-123';

    // Connection lifecycle
    states.push({ peerId, state: 'new', available: false });
    states.push({ peerId, state: 'connecting', available: false });
    states.push({ peerId, state: 'connected', available: true });
    states.push({ peerId, state: 'disconnected', available: false });
    states.push({ peerId, state: 'closed', available: false });

    expect(states.length).toBe(5);
    
    // Only connected state should be available
    const availableCount = states.filter(s => s.available).length;
    expect(availableCount).toBe(1);
  });
});
