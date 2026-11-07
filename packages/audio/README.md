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

The manager uses browser AudioWorklet modules in web builds and compiled Rust
processors in vue-native (`globalThis.isVn === true`). Native registration checks
`AudioContext.loadNativeAudioWorklet` and performs no JS module fetch.

```typescript
import { AudioManagement, WorkletManager } from '@argon/audio'

const audio = new AudioManagement({ autoInitialize: false })
const worklets = new WorkletManager(audio)
await worklets.init()
const mono = await worklets.createStereoToMonoProcessor()
worklets.setEnabledVUNode(mono.Value, true)
source.connect(mono.Value).connect(destination)
// At the end of the owning graph's lifetime:
await mono.asyncDispose()
```

`AudioProcessorNode` describes the shared AudioNode, parameter map and receiving
port surface. The application maps its four existing processor ids to SDK names:

| Browser processor id | Native processor |
|---|---|
| `vu-meter-processor` | `peak-meter-stereo` |
| `vu-meter-light` | `peak-meter-mono` |
| `vu-stereo-to-mono-processor` | `stereo-to-mono` |
| `input-gate-processor` | `input-gate` |

The native path fails explicitly if a host lacks the API or a processor has no
native mapping. Ordinary browsers without AudioWorklet retain the existing
analyser/pass-through fallbacks. Native mono conversion preserves the existing
processor's left-channel-to-both behavior; it is not an average of two channels.

RNNoise and Speex use third-party WASM worklets. They are not native builtins;
native microphone capture uses libwebrtc APM through the `noiseSuppression`
constraint instead. Those algorithms are not advertised as interchangeable.

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
