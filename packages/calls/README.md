# @argon/calls

WebRTC call management for Argon applications using [LiveKit](https://livekit.io/). Provides a complete solution for direct calls, voice channels, and screen sharing.

## Installation

```bash
bun add @argon/calls
```

## Features

- **Direct calls** - One-to-one audio/video calls
- **Voice channels** - Multi-participant voice rooms
- **Screen sharing** - Share screen with system audio
- **Speaking detection** - Visual speaking indicators
- **Volume control** - Per-user volume with persistence
- **Connection quality** - RTT ping tracking and quality indicators
- **RTC diagnostics** - Detailed WebRTC stats

## Usage

### Setup

The call manager requires several dependencies to be injected. This allows you to integrate with your app's existing stores and services:

```typescript
import { createCallManager, type CallManagerConfig } from '@argon/calls'

// Your app's implementations
const config: CallManagerConfig = {
  audio: audioManager,          // Audio device management
  api: apiClient,               // Backend API client
  userPool: userPoolStore,      // User info lookup
  eventBus: eventBusStore,      // Server event subscriptions
  tones: tonePlayer,            // Call sounds
  system: systemStore,          // Mute state
  userVolume: volumeStore,      // Volume persistence
  currentUser: { id: userId, displayName: userName },
  
  // Optional: sync with realtime UI state
  onRealtimeUpdate: (channelId, userId, update) => {
    realtimeStore.setUserProperty(channelId, userId, (user) => {
      Object.assign(user, update)
    })
  }
}

const calls = createCallManager(config)
```

### Direct Calls

```typescript
// Start a call
await calls.startDirectCall(targetUserId)

// Handle incoming calls
watch(() => calls.incoming.value, (incoming) => {
  if (incoming) {
    showIncomingCallUI(incoming.callerId)
  }
})

// Accept/reject
await calls.acceptIncomingCall()
await calls.rejectIncomingCall()

// Leave call
await calls.leave()
```

### Voice Channels

```typescript
// Join voice channel
await calls.joinVoiceChannel(channelId)

// Check connected channel
if (calls.connectedVoiceChannelId.value === channelId) {
  // Already in this channel
}

// Leave channel
await calls.leave()
```

### Participants

```typescript
// Get all participants
for (const [userId, participant] of Object.entries(calls.participants)) {
  console.log(participant.displayName)
  console.log(participant.muted)
  console.log(participant.volume)
}

// Check who's speaking
if (calls.speaking.has(userId)) {
  // Show speaking indicator
}

// Set user volume
calls.setVolume(userId, 75)  // 0-200 (100 = normal)
```

### Screen Sharing

```typescript
// Start screen share
await calls.startScreenShare({
  deviceId: null,  // or specific device ID
  systemAudio: 'include'
})

// Check if sharing
if (calls.isSharing.value) { ... }

// Stop sharing
await calls.stopScreenShare()

// Get video tracks
const videoTrack = calls.videoTracks.get(userId)
```

### Connection Quality

```typescript
// Current ping
const pingMs = calls.ping.value

// Average ping
const avgPing = calls.averagePing.value

// Quality indicator: 'excellent' | 'good' | 'fair' | 'poor'
const quality = calls.qualityConnection.value

// Ping history (last 10 minutes)
calls.pingHistory.forEach(({ timestamp, value }) => {
  // Draw chart
})
```

### RTC Diagnostics

```typescript
// Get diagnostics for a participant
const diag = calls.diagnostics.get(userId)

if (diag) {
  console.log('Packets lost:', diag.audioPacketsLost)
  console.log('Jitter:', diag.audioJitter)
  console.log('RTT:', diag.rtt)
  console.log('Bitrate:', diag.bitrateKbps, 'kbps')
}
```

## API Reference

### `createCallManager(config)`

Creates a call manager instance with injected dependencies.

**Returns:** `CallManager`

### CallManager State

| Property | Type | Description |
|----------|------|-------------|
| `mode` | `Ref<'none' \| 'dm' \| 'channel'>` | Current call mode |
| `room` | `Ref<Room \| null>` | LiveKit Room instance |
| `callId` | `Ref<string \| null>` | Current call ID |
| `targetId` | `Ref<string \| null>` | Target user/channel ID |
| `connectedVoiceChannelId` | `Ref<string \| null>` | Connected voice channel |
| `isConnected` | `Ref<boolean>` | Connection status |
| `isConnecting` | `Ref<boolean>` | Connecting status |
| `isReconnecting` | `Ref<boolean>` | Reconnecting status |
| `participants` | `Record<string, CallParticipant>` | Call participants |
| `videoTracks` | `Map<string, RemoteTrack>` | Video tracks by user |
| `speaking` | `Set<string>` | Currently speaking user IDs |
| `incoming` | `Ref<CallIncoming \| null>` | Incoming call data |
| `isSharing` | `Ref<boolean>` | Screen sharing status |
| `ping` | `Ref<number>` | Current RTT in ms |
| `pingHistory` | `Array<{timestamp, value}>` | Ping history |
| `averagePing` | `ComputedRef<number>` | Average ping |
| `qualityConnection` | `ComputedRef<ConnectionQuality>` | Quality indicator |
| `diagnostics` | `Map<string, RtcDiagnostics>` | RTC stats per user |

### CallManager Actions

| Method | Description |
|--------|-------------|
| `startDirectCall(userId)` | Start direct call |
| `acceptIncomingCall()` | Accept incoming call |
| `rejectIncomingCall()` | Reject incoming call |
| `joinVoiceChannel(channelId)` | Join voice channel |
| `leave()` | Leave current call |
| `startScreenShare(opts)` | Start screen sharing |
| `stopScreenShare()` | Stop screen sharing |
| `setVolume(userId, vol, skipSave?)` | Set user volume |
| `dispose()` | Cleanup resources |

## Dependency Interfaces

### ICallAudioManager

```typescript
interface ICallAudioManager {
  getCurrentAudioContext(): AudioContext
  getInputDevice(): Ref<string | null>
  getOutputDevice(): Ref<string | null>
  onInputDeviceChanged(cb: (deviceId: string) => void): Subscription
  createRtcProcessor(): AudioWorkletNode | null
}
```

### ICallApiClient

```typescript
interface ICallApiClient {
  startDirectCall(targetUserId: string): Promise<{
    callId: string
    token: string
    rtc: RtcEndpoint
  } | null>
  acceptCall(callId: string): Promise<{ token: string; rtc: RtcEndpoint } | null>
  rejectCall(callId: string): Promise<void>
  joinVoiceChannel(channelId: string): Promise<{
    callId: string
    token: string
    rtc: RtcEndpoint
  } | null>
  leaveCall(callId: string): Promise<void>
}
```

### ICallEventBus

```typescript
interface ICallEventBus {
  onServerEvent<T>(event: string, handler: (data: T) => void): Subscription
}
```

## Dependencies

- `livekit-client` - WebRTC client
- `vue` - Reactivity
- `rxjs` - Event subscriptions
- `pinia` - State management (peer)
- `@argon/core` - Core utilities
- `@argon/glue` - API types

## License

MIT
