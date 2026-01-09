# @argon/glue

Generated API client and IPC bindings for Argon services. This package provides type-safe communication between the Argon client and backend services.

## Installation

```bash
bun add @argon/glue
```

## Features

- **Type-safe API client** - Auto-generated from Ion schema definitions
- **SignalR integration** - Real-time bidirectional communication
- **IPC support** - Native app communication layer
- **Native glue** - Cross-platform native integrations

## Usage

### API Client

```typescript
import { createClient, type ServerInteraction } from '@argon/glue'

// Create authenticated client
const client = await createClient({
  endpoint: 'https://api.argon.chat',
  token: accessToken,
})

// Type-safe API calls
const user = await client.getUserProfile(userId)
const channels = await client.getChannels(serverId)
```

### Server Events (SignalR)

```typescript
import { createClient, CallIncoming, MessageCreated } from '@argon/glue'

const client = await createClient({ ... })

// Subscribe to server events
client.on<CallIncoming>('CallIncoming', (event) => {
  console.log('Incoming call from:', event.callerId)
})

client.on<MessageCreated>('MessageCreated', (event) => {
  console.log('New message:', event.content)
})
```

### Native Glue

For Electron/Tauri apps with native integrations:

```typescript
import { native, argon } from '@argon/glue'

// Check platform capabilities
if (native.isElectron) {
  argon.setWindowTitle('Argon')
  argon.minimize()
}

// Native notifications
argon.showNotification({
  title: 'New Message',
  body: 'You have a new message'
})
```

### IPC Client

For native desktop apps:

```typescript
import { createIpcClient } from '@argon/glue'

const ipc = createIpcClient()

// Call native functions
await ipc.invoke('openFile', { path: '/path/to/file' })
```

## Generated Types

The package exports all generated types from Ion schemas:

- `ServerInteraction` - Server API methods
- `ChannelInteraction` - Channel operations  
- `UserInteraction` - User management
- `VoiceInteraction` - Voice/video calls
- Event types: `CallIncoming`, `CallFinished`, `CallAccepted`, `MessageCreated`, etc.
- Model types: `User`, `Channel`, `Server`, `Message`, etc.

## Regenerating Types

Types are auto-generated from `.ion` files in the `/ion` directory:

```bash
bun run generate:types
```

## Architecture

```
@argon/glue
├── argonChat.ts      # Main API client (~9000 lines generated)
├── argon.ipc.ts      # IPC bindings for native apps
└── nativeGlue.ts     # Platform detection and native APIs
```

## Dependencies

- `@microsoft/signalr` - Real-time communication
- `msgpackr` - MessagePack serialization

## License

MIT
