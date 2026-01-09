# @argon/storage

Persisted storage utilities for Vue applications. Provides reactive refs that automatically sync with localStorage.

## Installation

```bash
bun add @argon/storage
```

## Features

- **Reactive persistence** - Values automatically sync to localStorage
- **Type-safe** - Full TypeScript support with generic types
- **SuperJSON** - Supports complex types (Date, Map, Set, etc.)
- **Vue integration** - Works with `ref()` and `reactive()`

## Usage

### `persistedValue` - Simple Persisted State

For simple values that should persist across sessions:

```typescript
import { persistedValue } from '@argon/storage'

// String value
const username = persistedValue('user.name', 'Guest')
console.log(username.value) // 'Guest' or stored value

// Number value
const volume = persistedValue('audio.volume', 100)
volume.value = 75 // Automatically saved

// Boolean value
const darkMode = persistedValue('theme.dark', true)

// Object value (uses reactive())
const settings = persistedValue('app.settings', {
  notifications: true,
  sounds: true,
  language: 'en'
})

settings.notifications = false // Automatically saved
```

### `persisted` - Advanced Persisted Ref

For more control over persistence:

```typescript
import { persisted } from '@argon/storage'

interface UserPrefs {
  theme: 'dark' | 'light'
  fontSize: number
}

const prefs = persisted<UserPrefs>('user.prefs', {
  theme: 'dark',
  fontSize: 14
})

// Read value
console.log(prefs.value.theme) // 'dark'

// Update entire value
prefs.set({ theme: 'light', fontSize: 16 })

// Update single key
prefs.set_key('fontSize', 18)

// Clean up and remove from storage
prefs.destroy()
```

## API Reference

### `persistedValue<T>(key, defaultValue)`

Creates a reactive ref or reactive object that persists to localStorage.

**Parameters:**
- `key: string` - localStorage key
- `defaultValue: T` - Default value if not in storage

**Returns:** 
- `Ref<T>` for primitive types
- `Reactive<T>` for objects

**Behavior:**
- Primitives use `ref()` and watch for changes
- Objects use `reactive()` and `watchEffect()` for deep reactivity
- Complex types serialized with SuperJSON

### `persisted<T>(key, defaultValue)`

Creates a persisted ref with explicit methods.

**Parameters:**
- `key: string` - localStorage key  
- `defaultValue: T` - Default value if not in storage

**Returns:** `PersistedRef<T>`

```typescript
interface PersistedRef<T> {
  readonly value: T
  set(value: T): void
  set_key<K extends keyof T>(key: K, value: T[K]): void
  destroy(): void
}
```

## Storage Keys Convention

Recommended key naming convention:

```typescript
// Feature.setting format
persistedValue('audio.inputDevice', null)
persistedValue('audio.outputDevice', null)
persistedValue('appearance.theme', 'dark')
persistedValue('appearance.accentColor', 'blue')
persistedValue('user.preferences', { ... })
```

## Dependencies

- `vue` - Vue.js reactivity
- `superjson` - JSON serialization with type support
- `@argon/core` - Logger

## License

MIT
