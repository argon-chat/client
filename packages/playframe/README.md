# @argon/playframe

Shared protocol definitions and utilities for Argon PlayFrame - the embedded games system.

## Overview

This package contains the core protocol definitions, types, and utilities shared between:
- `@argon/playframe-sdk` - SDK for game developers
- `@argon/playframe-host` - Host controller for the Argon client

## Protocol

PlayFrame uses a **pull model** where the game (client) initiates all requests to the host. Communication happens via `postMessage` between the iframe and host window.

### Versioning

The protocol is versioned to ensure compatibility:

```typescript
import { PROTOCOL_VERSION, isVersionCompatible } from '@argon/playframe';

// Current protocol version
console.log(PROTOCOL_VERSION); // 1

// Check compatibility
if (!isVersionCompatible(gameVersion)) {
  throw new Error('Incompatible protocol version');
}
```

### Message Structure

All messages follow a common envelope structure:

```typescript
interface MessageEnvelope<T> {
  protocol: 'argon-playframe';
  version: number;
  id: string;
  type: MessageType;
  timestamp: number;
  payload: T;
}
```

## Types

### User & Space (Ephemeral IDs)

For privacy and security, PlayFrame uses ephemeral identifiers:

```typescript
interface EphemeralUser {
  ephemeralId: string;     // Session-scoped, not the real user ID
  displayName: string;     // May be anonymized
  avatarUrl: string | null; // Proxied through CDN
  role: ParticipantRole;   // 'host' | 'player' | 'spectator' | 'pending'
  state: ParticipantState; // 'active' | 'idle' | 'disconnected'
}

interface EphemeralSpace {
  ephemeralId: string;
  name: string;
  type: SpaceType;         // 'voice-channel' | 'text-channel' | 'dm' | 'group-dm'
  maxParticipants: number;
  participantCount: number;
  isPrivate: boolean;
}
```

### Layout

Games can specify layout preferences:

```typescript
interface LayoutConfig {
  mode: 'fixed-aspect' | 'responsive' | 'fixed-size';
  aspectRatio?: { width: number; height: number }; // For fixed-aspect
  minSize?: Dimensions;
  maxSize?: Dimensions;
  preferredSize?: Dimensions;
  pixelPerfect?: boolean;
}
```

### Permissions

Available permissions that games can request:

- `pointer-lock` - Pointer Lock API
- `gamepad` - Gamepad API
- `keyboard` - Full keyboard input
- `audio` - Audio output
- `microphone` - Microphone input (requires user consent)
- `clipboard-read` - Read clipboard
- `clipboard-write` - Write clipboard
- `storage` - Local storage access
- `fullscreen` - Fullscreen API
- `networking` - WebRTC P2P networking with TURN credentials

### WebRTC P2P Types

For real-time multiplayer, the protocol includes WebRTC signaling types:

```typescript
import type {
  IceServer,
  IceServersConfig,
  RtcSignalMessage,
  RtcSignalType,
  RtcPeerState,
  RtcDataChannelConfig,
} from '@argon/playframe';

// Channel presets for common use cases
import { RTC_CHANNEL_PRESETS } from '@argon/playframe';
// lowLatency: unreliable, unordered (position updates)
// reliable: ordered, retransmitted (events, chat)
// bulk: large data transfers
```

## Constants

```typescript
import {
  ASPECT_RATIOS,           // Common aspect ratios (16:9, 4:3, etc.)
  DEFAULT_SANDBOX_FLAGS,   // Default iframe sandbox attributes
  BASE_CSP_DIRECTIVES,     // Base Content Security Policy
  ALWAYS_BLOCKED_KEYS,     // Keys never forwarded to games
  DEFAULT_FPS_LIMIT,       // 60 FPS
} from '@argon/playframe';
```

## Utilities

### Message Helpers

```typescript
import { createMessage, createResponse, isValidMessage } from '@argon/playframe';

// Create a message
const msg = createMessage('get-user', {});

// Validate incoming message
if (isValidMessage(event.data)) {
  // Process message
}
```

### Layout Utilities

```typescript
import { calculateAspectFitDimensions, clampDimensions } from '@argon/playframe';

// Calculate dimensions maintaining aspect ratio
const size = calculateAspectFitDimensions(
  { width: 1920, height: 1080 },
  { width: 16, height: 9 }
);
```

### Input Utilities

```typescript
import { shouldBlockKey } from '@argon/playframe';

document.addEventListener('keydown', (e) => {
  if (shouldBlockKey(e)) {
    return; // Don't forward to game
  }
});
```

### Event Emitter

```typescript
import { EventEmitter } from '@argon/playframe';

interface MyEvents {
  data: { value: number };
  error: Error;
}

const emitter = new EventEmitter<MyEvents>();

emitter.on('data', (data) => console.log(data.value));
emitter.emit('data', { value: 42 });
```

## License

MIT - See LICENSE file
