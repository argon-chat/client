# @argon/avatar

Avatar components for Argon applications with file storage integration. Displays user avatars with automatic caching and fallback support.

## Installation

```bash
bun add @argon/avatar
```

## Features

- **Smart caching** - Blob URL caching for efficient loading
- **Fallback support** - Graceful degradation to initials
- **File storage integration** - Abstract file storage interface
- **User pool integration** - Dynamic user info lookup
- **Reactive** - Automatically updates when avatar changes

## Usage

### Basic Setup

First, provide the required dependencies at app root:

```typescript
// main.ts
import { provide } from 'vue'
import { 
  AvatarFileStorageKey, 
  UserPoolKey,
  type IAvatarFileStorage,
  type IUserPool 
} from '@argon/avatar'

// Your file storage implementation
const fileStorage: IAvatarFileStorage = {
  async getAvatarBlob(avatarFileId: string): Promise<Blob | null> {
    const response = await fetch(`/api/files/${avatarFileId}`)
    return response.blob()
  }
}

// Your user pool implementation  
const userPool: IUserPool = {
  async getUser(userId: string) {
    return await api.getUser(userId)
  }
}

app.provide(AvatarFileStorageKey, fileStorage)
app.provide(UserPoolKey, userPool)
```

### ArgonAvatar Component

Basic avatar with known data:

```vue
<script setup lang="ts">
import { ArgonAvatar } from '@argon/avatar'
</script>

<template>
  <!-- With avatar file ID -->
  <ArgonAvatar 
    :avatarFileId="user.avatarFileId" 
    :fallback="user.displayName"
  />
  
  <!-- Fallback only (shows initials) -->
  <ArgonAvatar fallback="John Doe" />
  
  <!-- With size classes -->
  <ArgonAvatar 
    :avatarFileId="user.avatarFileId"
    fallback="JD"
    class="h-12 w-12"
  />
</template>
```

### SmartArgonAvatar Component

Avatar that auto-fetches user info by ID:

```vue
<script setup lang="ts">
import { SmartArgonAvatar } from '@argon/avatar'
</script>

<template>
  <!-- Just pass user ID - component fetches rest -->
  <SmartArgonAvatar :userId="message.authorId" />
  
  <!-- With custom size -->
  <SmartArgonAvatar 
    :userId="participant.id" 
    class="h-8 w-8"
  />
</template>
```

### useAvatarBlob Composable

For custom avatar implementations:

```typescript
import { useAvatarBlob } from '@argon/avatar'

const { blobUrl, isLoading, error } = useAvatarBlob(
  computed(() => user.value.avatarFileId)
)
```

## API Reference

### `ArgonAvatar`

**Props:**
- `avatarFileId?: string` - File ID to load avatar from
- `fallback?: string` - Text for fallback (usually initials or name)

### `SmartArgonAvatar`

**Props:**
- `userId: string` - User ID to fetch avatar for

Automatically fetches user info from the provided `IUserPool` and displays their avatar.

### `useAvatarBlob(avatarFileId)`

**Parameters:**
- `avatarFileId: Ref<string | undefined>` - Reactive file ID

**Returns:**
```typescript
{
  blobUrl: Ref<string | null>
  isLoading: Ref<boolean>
  error: Ref<Error | null>
}
```

### Dependency Injection Keys

```typescript
// Provide your implementations
import { AvatarFileStorageKey, UserPoolKey } from '@argon/avatar'

interface IAvatarFileStorage {
  getAvatarBlob(avatarFileId: string): Promise<Blob | null>
}

interface IUserPool {
  getUser(userId: string): Promise<{ displayName: string; avatarFileId?: string } | null>
}
```

## Dependencies

- `vue` - Vue.js
- `@argon/core` - Utilities
- `@argon/ui` - Avatar UI components

## License

MIT
