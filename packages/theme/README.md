# @argon/theme

Theme management for Argon applications. Supports dark, light, and OLED themes with accent color customization.

## Installation

```bash
bun add @argon/theme
```

## Features

- **Multiple themes** - Dark, Light, and OLED (pure black)
- **Accent colors** - 12 customizable accent colors
- **CSS variables** - Works with Tailwind CSS
- **Persistence** - Theme choice saved to localStorage
- **Native integration** - Optional callback for native app theme sync

## Usage

### Basic Setup

```typescript
import { useTheme } from '@argon/theme'

const theme = useTheme()

// Apply saved theme on app start
theme.applyTheme()
```

### With Native App Integration

```typescript
import { useTheme } from '@argon/theme'
import { native } from '@argon/glue'

const theme = useTheme({
  onThemeChange: async (themeId, nativeTheme) => {
    // Sync with native window chrome
    await native.setNativeTheme(nativeTheme)
  }
})

theme.applyTheme()
```

### In Components

```vue
<script setup lang="ts">
import { useTheme, accentColors } from '@argon/theme'

const { currentTheme, setTheme, setAccentColor } = useTheme()
</script>

<template>
  <div>
    <!-- Theme switcher -->
    <select :value="currentTheme" @change="setTheme($event.target.value)">
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="oled">OLED</option>
    </select>
    
    <!-- Accent color picker -->
    <div class="flex gap-2">
      <button 
        v-for="(hex, name) in accentColors"
        :key="name"
        :style="{ backgroundColor: hex }"
        @click="setAccentColor(name)"
      />
    </div>
  </div>
</template>
```

## Available Themes

| Theme | Description |
|-------|-------------|
| `dark` | Dark theme with gray backgrounds |
| `light` | Light theme with white backgrounds |
| `oled` | Pure black theme for OLED displays |

## Accent Colors

```typescript
import { accentColors } from '@argon/theme'

// Available colors:
// blue, purple, pink, red, orange, yellow,
// green, teal, cyan, indigo, violet, rose
```

## API Reference

### `useTheme(config?)`

Creates a theme manager instance.

**Config:**
```typescript
interface ThemeConfig {
  onThemeChange?: (theme: ThemeId, nativeTheme: string) => void | Promise<void>
}
```

**Returns:**
```typescript
{
  currentTheme: Ref<string>
  applyTheme(themeId?: ThemeId): void
  setTheme(themeId: ThemeId): void
  setAccentColor(color: string): void
}
```

### `accentColors`

Record of accent color names to hex values:

```typescript
const accentColors: Record<string, string> = {
  blue: "#3b82f6",
  purple: "#a855f7",
  // ... etc
}
```

## CSS Variables

The theme system sets these CSS variables on `<html>`:

- `--background` / `--foreground`
- `--card` / `--card-foreground`
- `--popover` / `--popover-foreground`
- `--primary` / `--primary-foreground`
- `--secondary` / `--secondary-foreground`
- `--muted` / `--muted-foreground`
- `--accent` / `--accent-foreground`
- `--destructive` / `--destructive-foreground`
- `--border` / `--input` / `--ring`

## Dependencies

- `vue` - Vue.js reactivity
- `@argon/core` - Logger
- `@argon/storage` - Persistence

## License

MIT
