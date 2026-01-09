# @argon/i18n

Internationalization package for Argon applications with locale merge support. Allows apps to extend core translations with app-specific keys.

## Installation

```bash
bun add @argon/i18n
```

## Features

- **Core translations** - Shared UI strings (en, ru, jp, am, ru_pt)
- **Merge support** - Extend core messages with app-specific translations
- **Type-safe** - Full TypeScript support with locale schema types
- **vue-i18n based** - Standard Vue.js i18n integration

## Supported Locales

| Code | Language |
|------|----------|
| `en` | English |
| `ru` | Russian |
| `jp` | Japanese |
| `am` | Armenian |
| `ru_pt` | Russian (Pirate) |

## Usage

### Basic Setup

```typescript
// main.ts
import { createApp } from 'vue'
import { createArgonI18n } from '@argon/i18n'

const app = createApp(App)

// Use core translations only
const i18n = createArgonI18n()
app.use(i18n)
```

### With App-Specific Messages

```typescript
// main.ts
import { createArgonI18n } from '@argon/i18n'

// Import app-specific translations
import enApp from './locales/en.json'
import ruApp from './locales/ru.json'

const i18n = createArgonI18n({
  messages: {
    en: enApp,
    ru: ruApp,
  },
  locale: 'en',
  fallbackLocale: 'en',
})

app.use(i18n)
```

### In Components

```vue
<script setup lang="ts">
import { useI18n } from '@argon/i18n'

const { t, locale } = useI18n()
</script>

<template>
  <div>
    <!-- Core key -->
    <button>{{ t('close') }}</button>
    
    <!-- App-specific key -->
    <h1>{{ t('admin_dashboard') }}</h1>
    
    <!-- Change locale -->
    <select v-model="locale">
      <option value="en">English</option>
      <option value="ru">Русский</option>
    </select>
  </div>
</template>
```

## Core Messages

The package includes common UI strings:

```json
{
  "close": "Close",
  "ok": "Confirm",
  "cancel": "Cancel",
  "save": "Save",
  "delete": "Delete",
  "edit": "Edit",
  "loading": "Loading...",
  "error": "Error",
  "success": "Success"
}
```

## API Reference

### `createArgonI18n(options?)`

Creates an i18n instance with merged messages.

**Options:**
- `messages` - App-specific messages to merge with core
- `locale` - Default locale (default: `'en'`)
- `fallbackLocale` - Fallback locale (default: `'en'`)
- `options` - Additional vue-i18n options

**Returns:** `I18n` instance

### `coreMessages`

Direct access to core message objects:

```typescript
import { coreMessages } from '@argon/i18n'

console.log(coreMessages.en) // English messages
console.log(coreMessages.ru) // Russian messages
```

### Types

```typescript
import type { 
  SupportedLocale,    // 'en' | 'ru' | 'jp' | 'am' | 'ru_pt'
  CoreLocaleSchema    // Type of core message keys
} from '@argon/i18n'
```

## Private vs Public Keys

This package contains **only public/shared** localization keys. App-specific keys (admin features, etc.) should remain in each app's `locales/` folder:

```
@argon/i18n/core/en.json  (public - shared UI strings)
apps/admin/locales/en.json (private - admin-only strings)
```

## Dependencies

- `vue-i18n` - Vue.js internationalization

## License

MIT
