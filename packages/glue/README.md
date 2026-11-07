# @argon/glue

Generated server API client for Argon services. This package provides type-safe communication between the Argon client and backend services.

## Installation

```bash
bun add @argon/glue
```

## Features

- **Type-safe API client** - Auto-generated from Ion schema definitions
- **Ion streams** - Real-time bidirectional communication (`EventBus.Realtime`)

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

### Server Events

Realtime events arrive over the `EventBus.Realtime` Ion stream (`RealtimeFrame` in, `RealtimeCommand`
out); each event payload is the CBOR of an `ArgonEvent`. In the app the stream runs in
`src/workers/realtimeWorker.ts`.

## Generated Types

The package exports all generated types from Ion schemas:

- `ServerInteraction` - Server API methods
- `ChannelInteraction` - Channel operations  
- `UserInteraction` - User management
- `CallInteraction` - Direct voice/video calls
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
└── argonChat.ts      # Generated server API contracts
```

## Dependencies

- `@argon-chat/ion.webcore` - Ion runtime: CBOR formatters, unary calls and streams

## License

MIT
