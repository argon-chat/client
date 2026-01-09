# @argon/ui

Vue 3 UI component library based on [shadcn-vue](https://www.shadcn-vue.com/). Provides 43+ accessible, customizable components for building Argon applications.

## Installation

```bash
bun add @argon/ui
```

## Features

- 43+ headless UI components built on [Radix Vue](https://www.radix-vue.com/)
- Fully accessible (WAI-ARIA compliant)
- Dark mode support
- Tailwind CSS styling with CSS variables
- Tree-shakeable exports

## Components

### Layout
- `Card` - Container with header, content, footer
- `Separator` - Visual divider
- `AspectRatio` - Maintain aspect ratios
- `Resizable` - Resizable panels
- `ScrollArea` - Custom scrollbar container

### Forms
- `Button` - Interactive button with variants
- `Input` - Text input field
- `Textarea` - Multi-line text input
- `Checkbox` - Boolean toggle
- `Switch` - Toggle switch
- `RadioGroup` - Single selection
- `Select` - Dropdown selection
- `Slider` - Range input
- `NumberField` - Numeric input
- `PinInput` - PIN/OTP code input
- `TagsInput` - Tag/chip input
- `Form` - Form validation with vee-validate

### Feedback
- `Alert` - Alert messages
- `Badge` - Status indicators
- `Progress` - Progress bar
- `Skeleton` - Loading placeholder
- `Toast` / `SonnerToaster` - Notifications

### Overlay
- `Dialog` - Modal dialog
- `Drawer` - Slide-out panel
- `Popover` - Floating content
- `Tooltip` - Hover information
- `HoverCard` - Rich hover preview
- `ContextMenu` - Right-click menu
- `DropdownMenu` - Dropdown menu
- `Menubar` - Application menubar
- `Command` - Command palette (cmdk)

### Data Display
- `Avatar` - User avatar
- `Table` - Data table
- `Accordion` - Collapsible sections
- `Tabs` - Tabbed content

### Misc
- `Label` - Form label
- `Toggle` - Toggle button
- `ToggleGroup` - Toggle button group
- `Stepper` - Multi-step wizard
- `VisuallyHidden` - Screen reader only

## Usage

```vue
<script setup lang="ts">
import { 
  Button, 
  Card, 
  CardHeader, 
  CardContent,
  Input,
  Dialog,
  DialogContent,
  DialogTrigger 
} from '@argon/ui'
</script>

<template>
  <Card>
    <CardHeader>
      <h2>Welcome</h2>
    </CardHeader>
    <CardContent>
      <Input placeholder="Enter your name" />
      
      <Dialog>
        <DialogTrigger as-child>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <p>Dialog content here</p>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>
</template>
```

## Toast Notifications

```vue
<script setup lang="ts">
import { SonnerToaster } from '@argon/ui'
import { toast } from 'sonner'
</script>

<template>
  <SonnerToaster position="top-right" />
  <button @click="toast.success('Saved!')">Save</button>
</template>
```

## Tailwind Configuration

The components expect Tailwind CSS with the Argon theme variables. Add the package to your Tailwind content:

```js
// tailwind.config.js
export default {
  content: [
    './src/**/*.{vue,ts}',
    './node_modules/@argon/ui/src/**/*.{vue,ts}',
  ],
}
```

## Dependencies

- `vue` ^3.5.0 (peer)
- `radix-vue` - Headless component primitives
- `class-variance-authority` - Variant management
- `tailwind-merge` - Class merging
- `@argon/core` - Core utilities

## License

MIT
