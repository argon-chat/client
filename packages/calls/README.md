# @argon/calls

Argon's calling: direct calls, voice channels, screen sharing and camera, on top of
[LiveKit](https://livekit.io/). This is the single implementation — the app's
`useUnifiedCall` store is a thin pinia wrapper around `createCallManager()` and holds no
call logic of its own.

## Design

The package owns the LiveKit integration and nothing else. Every collaborator — audio
engine, API client, user pool, event bus, permissions, preferences — arrives through
`CallManagerConfig`. That is what keeps this a package rather than a second copy of the
app's state layer, and it is why the call logic can be tested without pinia, without app
stores, and without mocking anything but the SDK.

Two rules follow from that, and both have bitten before:

- **No `window` access.** Host-specific behaviour goes through config callbacks —
  `selectScreenSource`, `consumeCrashRecovery`. The web build supplies no-ops.
- **No app imports.** If the manager needs something new from the app, it gets a new
  config field, not an import.

## Usage

```typescript
import { createCallManager, type CallManagerConfig } from "@argon/calls";

const calls = createCallManager(config satisfies CallManagerConfig);

await calls.joinVoiceChannel(channelId);
await calls.startScreenShare({ deviceId, systemAudio: "include" });
await calls.leave();
```

`createCallManager` returns plain Vue refs (`calls.isConnected.value`). Components in the
app see them unwrapped because pinia does that when wrapping a setup store.

See `src/types.ts` for the full config contract — it is the authoritative description of
what a host must provide, and each interface documents why it exists.

## What it handles

- **Bandwidth** — adaptive streaming with dynacast, vp9 without a fallback layer, and
  per-tile receive controls (hide a participant's video, cap its quality).
- **Diagnostics** — server-reported connection quality per participant, per-tile receive
  stats, subscription failures surfaced with a reason.
- **Recovery** — connection warm-up before joining, blocked-playback detection, and
  automatic voice rejoin after a renderer crash.
- **Screen share** — source pre-selection through the host, system audio with
  `restrictOwnAudio`, and screencast drawing sessions.

## Tests

- `test/calls/CallManager.test.ts` — behaviour, built from a plain config object.
- `test/store/unifiedCallStore.test.ts` — the app wiring, through pinia.

Run with `bun run test:app`.
