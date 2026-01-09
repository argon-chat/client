# @argon/assets

Static assets for Argon applications including fonts, icons, sounds, and base styles.

## Installation

```bash
bun add @argon/assets
```

## Contents

```
@argon/assets/
├── fonts/          # Custom fonts
├── icons/          # SVG icons collection
├── sounds/         # Audio files (notifications, calls, etc.)
├── styles/         # Base CSS styles
├── icon.png        # App icon (PNG)
└── icon.svg        # App icon (SVG)
```

## Usage

### Styles

Import the base styles in your app's entry point:

```typescript
// main.ts
import '@argon/assets/styles/index.css'
```

Or in your CSS:

```css
/* app.css */
@import '@argon/assets/styles/index.css';
```

### Icons

Import icons using Vite's glob import:

```typescript
// Load all icons as URL strings
const icons = import.meta.glob('/node_modules/@argon/assets/icons/*.svg', {
  eager: true,
  as: 'url'
})

// Or import specific icons
import iconUser from '@argon/assets/icons/user.svg'
```

In Vue components:

```vue
<template>
  <img :src="iconUrl" alt="icon" />
</template>
```

### Fonts

Fonts are automatically available when importing the styles. To use them manually:

```css
@font-face {
  font-family: 'ArgonSans';
  src: url('@argon/assets/fonts/ArgonSans.woff2') format('woff2');
}
```

### Sounds

```typescript
// Import sound files
import notificationSound from '@argon/assets/sounds/notification.mp3'
import ringSound from '@argon/assets/sounds/ring.mp3'

// Play sound
const audio = new Audio(notificationSound)
audio.play()
```

Or use with Audio API:

```typescript
const ctx = new AudioContext()
const response = await fetch(notificationSound)
const buffer = await ctx.decodeAudioData(await response.arrayBuffer())

const source = ctx.createBufferSource()
source.buffer = buffer
source.connect(ctx.destination)
source.start()
```

## Available Assets

### Icons

- User/profile icons
- Navigation icons  
- Action icons (edit, delete, etc.)
- Status indicators
- Media controls

### Sounds

| File | Description |
|------|-------------|
| `notification.mp3` | General notification |
| `message.mp3` | New message |
| `ring.mp3` | Incoming call |
| `dial.mp3` | Dialing tone |
| `connect.mp3` | Call connected |
| `disconnect.mp3` | Call ended |
| `join.mp3` | User joined channel |
| `leave.mp3` | User left channel |

### Styles

The base stylesheet includes:

- CSS reset
- Font definitions
- CSS variables for theming
- Base utility classes

## Vite Configuration

To resolve assets correctly, add to your Vite config:

```typescript
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@argon/assets': 'node_modules/@argon/assets'
    }
  }
})
```

## Dependencies

None - this is a static assets package.

## License

MIT
