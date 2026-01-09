# @argon/softphone

Softphone components and utilities for USSD, phone number handling, and dial pad interfaces.

## Installation

```bash
bun add @argon/softphone
```

## Features

- **USSD Client** - Send USSD codes and handle responses
- **Phone keyboard** - Dial pad Vue component
- **BCD encoding** - Phone number to GUID conversion for routing
- **Type definitions** - Full TypeScript support

## Usage

### USSD Client

```typescript
import { UssdClient, type UssdSession } from '@argon/softphone'

// Create USSD client
const ussd = new UssdClient({
  endpoint: 'wss://ussd.example.com',
  onSessionStart: (session: UssdSession) => {
    console.log('USSD session started:', session.id)
  },
  onResponse: (response) => {
    // Display USSD menu to user
    console.log('USSD Response:', response.text)
  },
  onSessionEnd: () => {
    console.log('USSD session ended')
  }
})

// Send USSD code
await ussd.send('*123#')

// Continue session with user input
await ussd.reply('1')  // Select menu option 1

// End session
ussd.cancel()
```

### Softphone Keyboard Component

```vue
<script setup lang="ts">
import { SoftphoneKeyboard } from '@argon/softphone'
import { ref } from 'vue'

const number = ref('')

function handleDigit(digit: string) {
  number.value += digit
}

function handleCall() {
  // Initiate call with number.value
}
</script>

<template>
  <div class="softphone">
    <input v-model="number" readonly />
    
    <SoftphoneKeyboard 
      @digit="handleDigit"
      @call="handleCall"
      @backspace="number = number.slice(0, -1)"
    />
  </div>
</template>
```

### Phone Number Encoding

Convert phone numbers to GUIDs for routing:

```typescript
import { encodePhoneToGuid } from '@argon/softphone'

// Encode phone number to GUID for routing
const guid = encodePhoneToGuid('+1234567890')
// Returns: GUID that can be used as routing identifier
```

## API Reference

### `UssdClient`

**Constructor options:**
```typescript
interface UssdClientOptions {
  endpoint: string
  onSessionStart?: (session: UssdSession) => void
  onResponse?: (response: UssdResponse) => void
  onSessionEnd?: () => void
  onError?: (error: Error) => void
}
```

**Methods:**
- `send(code: string): Promise<void>` - Send initial USSD code
- `reply(input: string): Promise<void>` - Reply to USSD prompt
- `cancel(): void` - Cancel current session

### `SoftphoneKeyboard`

**Events:**
- `@digit(digit: string)` - Emitted when digit pressed (0-9, *, #)
- `@call()` - Emitted when call button pressed
- `@backspace()` - Emitted when backspace pressed
- `@longpress(digit: string)` - Emitted on long press (for +, etc.)

### `encodePhoneToGuid(phoneNumber)`

Converts phone number to GUID using BCD encoding.

**Parameters:**
- `phoneNumber: string` - Phone number with optional + prefix

**Returns:** `string` - GUID representation

## USSD Response Types

```typescript
interface UssdSession {
  id: string
  code: string
  startTime: Date
}

interface UssdResponse {
  text: string
  type: 'menu' | 'info' | 'input' | 'end'
  options?: string[]
}
```

## Dependencies

- `vue` - Vue.js
- `@argon/core` - Core utilities

## License

MIT
