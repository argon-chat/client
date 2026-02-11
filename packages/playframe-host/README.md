# @argon/playframe-host

Host controller for Argon PlayFrame - manages embedded game iframes with full lifecycle control.

## Overview

This package provides the host-side implementation for running PlayFrame games. It handles:

- Iframe creation with security sandbox
- Protocol communication
- Watchdog monitoring
- Input management
- Layout/resize handling
- Audio state
- Dev mode for testing

## Installation

```bash
npm install @argon/playframe-host
```

## Quick Start

```typescript
import { PlayFrameHost } from '@argon/playframe-host';

const host = new PlayFrameHost({
  gameUrl: 'https://games.argon.io/tic-tac-toe/',
  container: document.getElementById('game-container')!,
  game: {
    id: 'tic-tac-toe',
    version: '1.0.0',
    title: 'Tic Tac Toe',
  },
  user: {
    ephemeralId: 'eph-user-abc123',
    displayName: 'Player One',
    avatarUrl: 'https://cdn.argon.io/avatars/abc123',
    role: 'player',
    state: 'active',
  },
  space: {
    ephemeralId: 'eph-space-xyz789',
    name: 'Game Night',
    type: 'voice-channel',
    maxParticipants: 8,
    participantCount: 2,
    isPrivate: false,
  },
  session: {
    sessionId: 'session-12345',
    startedAt: Date.now(),
    state: 'playing',
  },
  autoGrantPermissions: ['keyboard', 'audio'],
});

// Start the game
const context = await host.start();
console.log('Game started!', context);

// Handle events
host.on('terminate', ({ reason }) => {
  console.log('Game ended:', reason);
  // Cleanup UI
});
```

## Server Requirements

### OAuth & Authentication

The server must provide endpoints for game authentication:

#### 1. Generate Ephemeral JWT Token

```
POST /api/playframe/token
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "gameId": "tic-tac-toe",
  "spaceId": "space-123",
  "sessionId": "session-456"
}

Response:
{
  "token": "eyJ...",           // Ephemeral JWT (short-lived, 1 hour)
  "ephemeralUserId": "eph-...",
  "ephemeralSpaceId": "eph-...",
  "expiresAt": 1699999999999
}
```

JWT Claims:
```json
{
  "sub": "eph-user-abc123",      // Ephemeral user ID
  "aud": "tic-tac-toe",          // Game ID
  "space": "eph-space-xyz789",   // Ephemeral space ID
  "session": "session-12345",    // Session ID
  "role": "player",              // Participant role
  "iat": 1699999999,
  "exp": 1700003599              // 1 hour expiry
}
```

#### 2. Refresh Token Endpoint

```
POST /api/playframe/token/refresh
Authorization: Bearer <ephemeral-token>

Response:
{
  "token": "eyJ...",
  "expiresAt": 1700007199
}
```

#### 3. Validate Game Access

```
GET /api/playframe/games/{gameId}/access
Authorization: Bearer <user-token>
X-Space-Id: space-123

Response:
{
  "allowed": true,
  "permissions": ["keyboard", "audio", "pointer-lock"],
  "maxParticipants": 8
}
```

### Game Manifest

Games must be registered with a manifest:

```
GET /api/playframe/games/{gameId}/manifest

Response:
{
  "id": "tic-tac-toe",
  "version": "1.0.0",
  "title": "Tic Tac Toe",
  "description": "Classic game for 2 players",
  "url": "https://games.argon.io/tic-tac-toe/",
  "icon": "https://games.argon.io/tic-tac-toe/icon.png",
  "permissions": {
    "required": ["keyboard"],
    "optional": ["audio", "storage"]
  },
  "layout": {
    "mode": "fixed-aspect",
    "aspectRatio": { "width": 1, "height": 1 },
    "minSize": { "width": 300, "height": 300 }
  },
  "players": {
    "min": 2,
    "max": 2
  },
  "categories": ["board", "multiplayer"],
  "csp": {
    "connect-src": ["wss://games.argon.io"]
  }
}
```

### Avatar Proxy

For privacy, avatar URLs should be proxied:

```
GET /api/cdn/avatar/{userId}
Response: Proxied avatar image
```

### WebSocket for Real-time Updates

For multiplayer synchronization:

```
WS /api/playframe/session/{sessionId}/ws
Authorization: Bearer <ephemeral-token>

// Messages
-> { "type": "join" }
<- { "type": "participant_join", "user": {...} }
<- { "type": "participant_leave", "ephemeralId": "..." }
<- { "type": "game_state", "state": {...} }
```

### Session Management

```
POST /api/playframe/sessions
Authorization: Bearer <user-token>

{
  "gameId": "tic-tac-toe",
  "spaceId": "space-123",
  "maxParticipants": 2
}

Response:
{
  "sessionId": "session-456",
  "joinCode": "ABC123",       // Optional invite code
  "createdAt": 1699999999999
}
```

```
DELETE /api/playframe/sessions/{sessionId}
Authorization: Bearer <user-token>
```

### Security Considerations

1. **Ephemeral IDs**: Never expose real user IDs to games. Generate session-scoped ephemeral IDs.

2. **Token Scope**: Ephemeral tokens should only grant access to:
   - The specific game
   - The specific session
   - Limited user info (display name, avatar, role)

3. **Rate Limiting**: Apply rate limits to all PlayFrame endpoints:
   - Token generation: 10/minute
   - Game access checks: 100/minute
   - Session creation: 5/minute

4. **CORS**: Games are loaded in iframes, configure CORS appropriately:
   ```
   Access-Control-Allow-Origin: https://argon.io
   Access-Control-Allow-Methods: GET, POST
   Access-Control-Allow-Headers: Authorization, Content-Type
   ```

5. **CSP Headers**: Serve games with strict CSP headers:
   ```
   Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; ...
   ```

---

## Host Configuration

### Full Configuration

```typescript
const host = new PlayFrameHost({
  // Required
  gameUrl: string;
  container: HTMLElement;
  game: GameInfo;
  user: EphemeralUser;
  space: EphemeralSpace;
  session: SessionInfo;

  // Permissions
  availablePermissions?: Permission[];
  autoGrantPermissions?: Permission[];

  // Security
  sandboxConfig?: SandboxConfig;
  cspConfig?: CspConfig;

  // Monitoring
  watchdogConfig?: {
    heartbeatInterval?: number;  // Default: 5000ms
    timeout?: number;            // Default: 12000ms
    maxMissedHeartbeats?: number; // Default: 3
  };

  // Layout
  layoutConstraints?: {
    minSize?: Dimensions;
    maxSize?: Dimensions;
    allowFullscreen?: boolean;
  };

  // Audio
  audioConfig?: {
    enabled?: boolean;
    masterVolume?: number;
  };

  // Input
  inputConfig?: {
    allowPointerLock?: boolean;
    allowGamepad?: boolean;
    blockedKeys?: string[];
    interceptEscape?: boolean;
  };

  // Callbacks
  getParticipants?: () => Promise<EphemeralUser[]>;
  requestPermission?: (permission: Permission, reason?: string) => Promise<boolean>;

  // Development
  devConfig?: DevModeConfig;
});
```

## WebRTC P2P Configuration

For real-time multiplayer games, configure WebRTC signaling relay:

```typescript
import type { IceServersConfig, RtcSignalMessage, RtcPeerState } from '@argon/playframe';

const host = new PlayFrameHost({
  // ... other config

  autoGrantPermissions: ['keyboard', 'audio', 'networking'],

  rtcConfig: {
    // Provide TURN/STUN servers for NAT traversal
    getIceServers: async (): Promise<IceServersConfig> => {
      // Fetch credentials from your TURN server
      const response = await fetch('/api/turn/credentials');
      const { servers, ttl } = await response.json();
      
      return {
        iceServers: servers,
        ttl,
        issuedAt: Date.now(),
      };
    },

    // Relay signals between peers
    relaySignal: async (from: string, to: string, signal: RtcSignalMessage): Promise<boolean> => {
      // Forward signal via WebSocket or server
      const targetHost = peerHosts.get(to);
      if (targetHost) {
        targetHost.relaySignalToGame(from, signal);
        return true;
      }
      return false;
    },

    // Track peer connection state
    onPeerStateChange: (userId: string, state: RtcPeerState) => {
      console.log('Peer state changed:', userId, state);
      // Update session tracking, analytics, etc.
    },
  },
});

// Relay incoming signal from server to game
function handleIncomingSignal(from: string, signal: RtcSignalMessage) {
  host.relaySignalToGame(from, signal);
}
```

### Server Requirements for WebRTC

#### 1. TURN Server Credentials

```
GET /api/turn/credentials
Authorization: Bearer <user-token>

Response:
{
  "servers": [
    {
      "urls": ["stun:stun.example.com:3478"],
    },
    {
      "urls": ["turn:turn.example.com:3478"],
      "username": "ephemeral-user-abc123",
      "credential": "temporary-password-xyz",
      "credentialType": "password"
    }
  ],
  "ttl": 86400  // Credentials valid for 24 hours
}
```

#### 2. Signaling Relay

Signals can be relayed via WebSocket or REST:

```
WebSocket:
// Client → Server
{ "type": "rtc-signal", "to": "eph-peer-xyz", "signal": {...} }
// Server → Target Client  
{ "type": "rtc-signal", "from": "eph-user-abc", "signal": {...} }
```

#### 3. TURN Server Setup

Recommended: [coturn](https://github.com/coturn/coturn) or cloud TURN services like Twilio/Xirsys.

coturn example config:
```
listening-port=3478
tls-listening-port=5349
realm=playframe.example.com
use-auth-secret
static-auth-secret=<your-secret>
```

Generate temporary credentials:
```typescript
import crypto from 'crypto';

function generateTurnCredentials(userId: string, secret: string, ttl: number) {
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${userId}`;
  const credential = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  
  return { username, credential };
}
```

## Sandbox Configuration

```typescript
import { buildSandboxAttribute, buildGameCsp } from '@argon/playframe-host';

// Default sandbox flags
const sandbox = buildSandboxAttribute(['keyboard', 'audio', 'pointer-lock']);
// Result: "allow-scripts allow-same-origin allow-pointer-lock"

// Custom CSP
const csp = buildGameCsp('https://games.argon.io', {
  allowedOrigins: ['wss://games.argon.io'],
  allowWasm: true,
  allowEval: false,
});
```

## Watchdog

The watchdog monitors game health via heartbeats:

```typescript
import { Watchdog } from '@argon/playframe-host';

const watchdog = new Watchdog({
  heartbeatInterval: 5000,
  timeout: 12000,
  maxMissedHeartbeats: 3,
  onTimeout: () => {
    console.error('Game unresponsive!');
    host.terminate('timeout');
  },
  onHealthReport: (health) => {
    console.log('Health:', health.state, 'Latency:', health.averageResponseTime);
  },
});
```

## Dev Mode

For development and testing:

```typescript
import { createStandaloneRunner } from '@argon/playframe-host';

// Run a game standalone (outside of Argon)
const runner = await createStandaloneRunner({
  gameUrl: 'http://localhost:3000/',
  container: document.getElementById('game')!,
  game: { id: 'my-game', version: '1.0.0', title: 'My Game' },
  devConfig: {
    enabled: true,
    showOverlay: true,
    logMessages: true,
    autoGrantPermissions: true,
    disableWatchdog: true,
  },
  onReady: (context) => {
    console.log('Game ready!', context);
  },
});

// Cleanup
runner.destroy();
```

### Debug Overlay

```typescript
import { createDebugOverlay } from '@argon/playframe-host';

const overlay = createDebugOverlay(container);

overlay.update({
  state: 'connected',
  fps: 60,
  latency: 15,
  health: { state: 'healthy', ... },
});

overlay.toggle(); // Show/hide
overlay.destroy(); // Remove
```

### Message Logger

```typescript
import { createMessageLogger } from '@argon/playframe-host';

const logger = createMessageLogger('[PlayFrame]');

logger.logIncoming('handshake', payload);
logger.logOutgoing('handshake-ack', response);
logger.setEnabled(false); // Disable
```

## Events

```typescript
host.on('load', () => {
  // Iframe loaded
});

host.on('ready', (context) => {
  // Handshake completed, game is running
});

host.on('pause', ({ reason }) => {
  // Game paused
});

host.on('resume', () => {
  // Game resumed
});

host.on('terminate', ({ reason, message }) => {
  // Game terminated
});

host.on('layoutChange', (layout) => {
  // Layout updated
});

host.on('healthReport', (health) => {
  // Watchdog health report
});

host.on('error', ({ error, fatal }) => {
  // Error occurred
});

host.on('participantJoin', (user) => {
  // Player joined
});

host.on('participantLeave', ({ ephemeralId }) => {
  // Player left
});

host.on('message', ({ direction, type, payload }) => {
  // All messages (for debugging)
});
```

## Host Methods

```typescript
// Lifecycle
await host.start(): Promise<GameContext>;
host.pause(reason?: PauseReason): void;
host.resume(): void;
host.terminate(reason?: TerminateReason, message?: string): void;

// State
host.getState(): HostState;
host.getContext(): GameContext | null;
host.getLayout(): LayoutState | null;

// Layout
host.updateContainerSize(): void;
await host.toggleFullscreen(): Promise<boolean>;

// Audio
host.setVolume(volume: number): void;
host.setMuted(muted: boolean): void;

// Participants
host.notifyParticipantJoin(user: EphemeralUser): void;
host.notifyParticipantLeave(ephemeralId: string): void;
```

## Browser API Restriction (Experimental)

For extra security, you can restrict browser APIs:

```typescript
import { generateApiRestrictionScript, RESTRICTED_APIS } from '@argon/playframe-host';

// Generate script to delete dangerous APIs
const script = generateApiRestrictionScript(RESTRICTED_APIS);
// This needs to be injected into the game's HTML before load
```

Note: This is experimental and requires control over the game's HTML or a service worker.

## License

MIT - See LICENSE file
