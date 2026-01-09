# @argon/core

Core utilities, types, and foundational functions for the Argon ecosystem.

## Installation

```bash
bun add @argon/core
```

## Features

- **Logger** - Structured logging with levels and prefixes
- **Utils** - Common utility functions (`cn` for className merging)
- **Disposables** - Resource cleanup pattern for subscriptions and event handlers

## Usage

### Logger

```typescript
import { logger } from '@argon/core'

// Log messages with different levels
logger.info('User logged in', { userId: '123' })
logger.warn('Connection slow', { latency: 500 })
logger.error('Failed to connect', error)
```

### Class Name Utility

```typescript
import { cn } from '@argon/core'

// Merge Tailwind classes with conditional classes
const buttonClass = cn(
  'px-4 py-2 rounded',
  isActive && 'bg-blue-500',
  isDisabled && 'opacity-50 cursor-not-allowed'
)
```

### Disposables

```typescript
import { DisposableBag, Disposable } from '@argon/core'

// Create a disposable bag for cleanup
const disposables = new DisposableBag()

// Add subscriptions or cleanup functions
disposables.addSubscription(eventEmitter.on('event', handler))
disposables.add(new Disposable(() => {
  console.log('Cleanup!')
}))

// Clean up all at once
disposables.dispose()
```

## API Reference

### `logger`

Global logger instance with methods:
- `info(message: string, ...args: any[])`
- `warn(message: string, ...args: any[])`
- `error(message: string, ...args: any[])`
- `debug(message: string, ...args: any[])`

### `cn(...inputs: ClassValue[]): string`

Merges class names using `clsx` and `tailwind-merge`. Handles:
- Conditional classes
- Array of classes
- Object notation
- Tailwind class conflict resolution

### `DisposableBag`

Collection of disposables for batch cleanup:
- `add(disposable: IDisposable)`
- `addSubscription(subscription: Subscription)`
- `dispose()`

### `Disposable`

Simple disposable wrapper:
- `constructor(cleanup: () => void)`
- `dispose()`

## License

MIT
