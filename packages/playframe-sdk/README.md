# @argon/playframe-sdk

SDK for developing games for Argon PlayFrame.

## Installation

```bash
npm install @argon/playframe-sdk
```

## Quick Start

```typescript
import { 
  PlayFrameClient, 
  createFrameLoop, 
  createInputManager,
  isInPlayFrame 
} from '@argon/playframe-sdk';

// Check environment
if (!isInPlayFrame()) {
  console.log('Running in standalone mode - using mock data');
}

// Initialize client
const client = new PlayFrameClient({
  game: {
    id: 'my-awesome-game',
    version: '1.0.0',
    title: 'My Awesome Game',
  },
  permissions: ['keyboard', 'audio', 'pointer-lock'],
  layout: {
    mode: 'fixed-aspect',
    aspectRatio: { width: 16, height: 9 },
  },
  debug: true, // Enable debug logging
});

// Connect to host
const context = await client.connect();
console.log('Connected!', context);

// Get user info
const user = await client.getUser();
console.log('Playing as:', user.displayName);

// Get other participants
const { participants } = await client.getParticipants();
console.log('Players:', participants.length);
```

## Game Loop

```typescript
import { createFrameLoop, configureCanvas } from '@argon/playframe-sdk';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Setup frame loop
const loop = createFrameLoop((deltaTime, totalTime) => {
  // Update game state
  update(deltaTime);
  
  // Clear and render
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  render(ctx);
}, {
  targetFps: 60,
  pauseOnHidden: true,
  onPause: () => console.log('Game paused'),
  onResume: () => console.log('Game resumed'),
});

// Start the loop
loop.start();

// Handle client events
client.on('pause', () => loop.pause());
client.on('resume', () => loop.resume());
client.on('terminate', () => {
  loop.stop();
  // Cleanup
});
```

## Input Handling

```typescript
import { createInputManager } from '@argon/playframe-sdk';

// Request keyboard focus
await client.requestKeyboardFocus(true);

// Create input manager
const input = createInputManager({
  element: document.body,
  preventDefaults: true,
});

input.start();

// In your game loop
function update(dt: number) {
  const state = input.getState();
  
  // Keyboard
  if (state.keys.has('KeyW') || state.keys.has('ArrowUp')) {
    player.moveUp(dt);
  }
  
  // Mouse
  if (input.isMouseButtonDown(0)) {
    player.shoot();
  }
  
  // Touch
  for (const [id, touch] of state.touches) {
    handleTouch(touch.x, touch.y);
  }
  
  // Reset movement delta after processing
  input.resetMovement();
}
```

## Pointer Lock (for FPS games)

```typescript
// Request pointer lock
const success = await client.requestPointerLock(true);

if (success) {
  // Get mouse movement
  const input = createInputManager();
  
  function update() {
    const state = input.getState();
    camera.rotate(
      state.mouse.movementX * sensitivity,
      state.mouse.movementY * sensitivity
    );
    input.resetMovement();
  }
}
```

## Gamepad Support

```typescript
// Request gamepad access
await client.requestGamepad(true);

// Poll gamepads in your game loop
function update() {
  const gamepads = navigator.getGamepads();
  
  for (const gamepad of gamepads) {
    if (!gamepad) continue;
    
    // Left stick
    const moveX = gamepad.axes[0];
    const moveY = gamepad.axes[1];
    
    // Buttons
    if (gamepad.buttons[0].pressed) {
      player.jump();
    }
  }
}
```

## Audio

```typescript
// Request audio context
const audioInfo = await client.requestAudioContext({
  latencyHint: 'interactive',
});

if (audioInfo.available) {
  const audioCtx = new AudioContext({
    sampleRate: audioInfo.sampleRate,
  });
  
  // Your audio code...
}

// Listen for audio state changes (volume, mute, visibility)
client.on('audioStateUpdate', (state) => {
  masterGain.gain.value = state.muted ? 0 : state.masterVolume;
  
  if (!state.visible) {
    // Optionally reduce/pause audio when in background
  }
});
```

## Layout Handling

```typescript
import { configureCanvas } from '@argon/playframe-sdk';

// Listen for layout updates
client.on('layoutUpdate', ({ layout, reason }) => {
  console.log('Layout changed:', reason);
  
  // Reconfigure canvas
  const size = configureCanvas(canvas, layout.viewport, {
    aspectRatio: { width: 16, height: 9 },
    devicePixelRatio: layout.devicePixelRatio,
  });
  
  // Update game rendering
  game.resize(size.width, size.height);
});

// Request fullscreen
await client.requestFullscreen(true);
```

## Multiplayer

```typescript
// Get current user
const me = await client.getUser();
console.log('I am:', me.ephemeralId, me.role);

// Get all participants
const { participants } = await client.getParticipants({ role: 'player' });

// Listen for changes
client.on('participantJoin', (user) => {
  console.log('Player joined:', user.displayName);
  game.addPlayer(user.ephemeralId, user);
});

client.on('participantLeave', ({ ephemeralId }) => {
  console.log('Player left:', ephemeralId);
  game.removePlayer(ephemeralId);
});
```

## WebRTC P2P Networking

For real-time multiplayer games, PlayFrame provides WebRTC peer-to-peer networking with host-administered TURN credentials.

```typescript
import type { RtcSignalMessage, RtcPeerState } from '@argon/playframe-sdk';

// Request networking permission in your config
const client = new PlayFrameClient({
  game: { id: 'my-multiplayer-game', version: '1.0.0', title: 'My Game' },
  permissions: ['keyboard', 'audio', 'networking'],
});

await client.connect();

// Get ICE servers (STUN/TURN) for NAT traversal
const iceConfig = await client.getIceServers();
console.log('ICE servers:', iceConfig.iceServers);
console.log('Creds expire in:', iceConfig.ttl, 'seconds');

// Create RTCPeerConnection with provided servers
const pc = new RTCPeerConnection({
  iceServers: iceConfig.iceServers,
});

// Handle incoming signals from other peers
client.on('rtcSignal', ({ from, signal }) => {
  console.log('Signal from:', from);
  
  if (signal.type === 'offer') {
    // Handle incoming offer
    await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    // Send answer back
    await client.sendSignal(from, {
      type: 'answer',
      sdp: answer.sdp!,
    });
  } else if (signal.type === 'answer') {
    await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
  } else if (signal.type === 'ice-candidate' && signal.candidate) {
    await pc.addIceCandidate(signal.candidate);
  }
});

// Initiate connection to a peer
async function connectToPeer(peerId: string) {
  const dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  // Send offer to peer
  await client.sendSignal(peerId, {
    type: 'offer',
    sdp: offer.sdp!,
  });
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      client.sendSignal(peerId, {
        type: 'ice-candidate',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        },
      });
    }
  };
  
  return dc;
}

// Listen for peer state changes
client.on('rtcPeerState', (state) => {
  console.log('Peer', state.peerId, 'is now', state.state);
  if (state.available) {
    // Peer is available for connection
  }
});
```

### Channel Presets

Use the built-in presets for common use cases:

```typescript
import { RTC_CHANNEL_PRESETS } from '@argon/playframe';

// Low-latency unreliable channel for position updates
const positionChannel = pc.createDataChannel('positions', RTC_CHANNEL_PRESETS.lowLatency);

// Reliable ordered channel for chat/events
const chatChannel = pc.createDataChannel('chat', RTC_CHANNEL_PRESETS.reliable);

// Bulk data transfer
const bulkChannel = pc.createDataChannel('bulk', RTC_CHANNEL_PRESETS.bulk);
```

## Local Storage

```typescript
import { createGameStorage } from '@argon/playframe-sdk';

// Create namespaced storage
const storage = createGameStorage('my-game');

// Save/load data
storage.set('highScore', 1000);
const highScore = storage.get<number>('highScore', 0);

// Clear game data
storage.clear();
```

## Logging

```typescript
// Send logs to host (for debugging)
client.log('info', 'Game started');
client.log('debug', 'Player position', { x: 100, y: 200 });
client.log('error', 'Failed to load asset', { asset: 'player.png' });
```

## Event Reference

```typescript
client.on('connected', (context) => {
  // Connection established, context received
});

client.on('disconnected', ({ reason }) => {
  // Connection lost
});

client.on('pause', ({ reason }) => {
  // Game should pause
  // reason: 'background' | 'user-requested' | 'host-requested' | 'error'
});

client.on('resume', () => {
  // Game should resume
});

client.on('terminate', ({ reason, message }) => {
  // Game is being terminated
  // reason: 'user-closed' | 'host-closed' | 'timeout' | 'error' | 'kicked' | 'session-ended'
});

client.on('layoutUpdate', ({ layout, reason }) => {
  // Viewport/layout changed
});

client.on('audioStateUpdate', (state) => {
  // Audio settings changed (volume, mute, etc.)
});

client.on('error', ({ error, fatal }) => {
  // Error occurred
  if (fatal) {
    // Game must terminate
  }
});
```

## Standalone Development

For developing outside of Argon:

```typescript
import { isStandalone } from '@argon/playframe-sdk';

if (isStandalone()) {
  // Mock the PlayFrame client for local development
  // Or use playframe-host's createStandaloneRunner
}
```

## Best Practices

1. **Handle pause/resume properly** - Save game state on pause, restore on resume
2. **Respect audio state** - Mute audio when the host requests it
3. **Don't block Escape** - Allow users to access the pause menu
4. **Use ephemeral IDs** - Never try to identify real users, use ephemeral IDs
5. **Test with different layouts** - Your game should work with letterboxing
6. **Request only needed permissions** - Don't request permissions you don't need
7. **Handle disconnection gracefully** - Save progress, show error to user

## TypeScript

The SDK is fully typed. Import types as needed:

```typescript
import type {
  EphemeralUser,
  EphemeralSpace,
  GameContext,
  LayoutState,
  Permission,
} from '@argon/playframe-sdk';
```

## License

MIT - See LICENSE file
