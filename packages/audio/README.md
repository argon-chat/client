# @argon/audio

Audio management utilities for Argon applications. Handles device selection, audio routing, Web Audio API worklets, and DTMF tone generation.

## Installation

```bash
bun add @argon/audio
```

## Features

- **Device management** - Input/output device selection with persistence
- **Audio context** - Centralized Web Audio API context management
- **Worklet manager** - Audio worklet registration and lifecycle
- **DTMF player** - Generate phone dial tones
- **RTC processor** - Audio processing for WebRTC calls

## Usage

### Audio Management

```typescript
import { AudioManagement, type AudioManagerConfig } from '@argon/audio'

const config: AudioManagerConfig = {
  onInputDeviceChanged: (deviceId) => {
    console.log('Input device changed:', deviceId)
  },
  onOutputDeviceChanged: (deviceId) => {
    console.log('Output device changed:', deviceId)
  },
}

const audio = AudioManagement(config)

// Get current audio context
const ctx = audio.getCurrentAudioContext()

// Device selection
const inputDevice = audio.getInputDevice()
const outputDevice = audio.getOutputDevice()

// Change devices
await audio.setInputDevice('device-id')
await audio.setOutputDevice('device-id')

// Subscribe to device changes
const unsub = audio.onInputDeviceChanged((deviceId) => {
  // Handle device change
})
```

### Worklet Manager

For advanced audio processing with AudioWorklet:

```typescript
import { WorkletManager } from '@argon/audio'

const worklets = WorkletManager({
  audioContext: audio.getCurrentAudioContext(),
})

// Register worklets
await worklets.register('noise-gate', '/audio/noise-gate-processor.js')
await worklets.register('compressor', '/audio/compressor-processor.js')

// Create worklet node
const noiseGate = worklets.createNode('noise-gate')
source.connect(noiseGate).connect(ctx.destination)
```

### DTMF Tones

Generate phone dial tones for softphone applications:

```typescript
import { createDTMFPlayer } from '@argon/audio'

const dtmf = createDTMFPlayer(audioContext)

// Play individual tones
dtmf.play('1')  // Plays DTMF tone for '1'
dtmf.play('*')  // Plays DTMF tone for '*'
dtmf.play('#')  // Plays DTMF tone for '#'

// Play sequence
await dtmf.playSequence('1234567890')
```

## API Reference

### `AudioManagement(config)`

Creates an audio manager instance.

**Config:**
```typescript
interface AudioManagerConfig {
  onInputDeviceChanged?: (deviceId: string | null) => void
  onOutputDeviceChanged?: (deviceId: string | null) => void
}
```

**Returns:**
```typescript
interface IAudioManagement {
  getCurrentAudioContext(): AudioContext
  getInputDevice(): Ref<string | null>
  getOutputDevice(): Ref<string | null>
  setInputDevice(deviceId: string): void
  setOutputDevice(deviceId: string): void
  onInputDeviceChanged(cb: (id: string) => void): Subscription
  onOutputDeviceChanged(cb: (id: string) => void): Subscription
  createRtcProcessor(): AudioWorkletNode
}
```

### `WorkletManager(options)`

Manages audio worklet registration and lifecycle.

**Options:**
```typescript
{
  audioContext: AudioContext
}
```

### `createDTMFPlayer(audioContext)`

Creates a DTMF tone generator.

**Returns:**
```typescript
interface DTMFPlayer {
  play(digit: string, duration?: number): void
  playSequence(digits: string, interval?: number): Promise<void>
  stop(): void
}
```

## DTMF Frequencies

| Key | Low Hz | High Hz |
|-----|--------|---------|
| 1,2,3 | 697 | 1209,1336,1477 |
| 4,5,6 | 770 | 1209,1336,1477 |
| 7,8,9 | 852 | 1209,1336,1477 |
| *,0,# | 941 | 1209,1336,1477 |

## Dependencies

- `vue` - Vue.js reactivity
- `@argon/core` - Logging and disposables

## License

MIT
