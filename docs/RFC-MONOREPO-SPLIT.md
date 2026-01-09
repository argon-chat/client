# RFC: Splitting Argon Client into Monorepo with Packages

## Problem

The current project structure is monolithic. We need to reuse:
- `unifiedCallStore` and other stores for apps like Mitts
- UI components (`src/components/ui`) as a shared library
- Avatar, inventory components, etc.
- Localization (with separation of public/private keys)

## Solution: Bun Workspaces

Bun natively supports workspaces via `package.json`. This enables:
- Splitting code into logical packages
- Reusing packages in other repositories
- Maintaining a single dependency installation

---

## Proposed Structure

```
argon/
├── package.json              # Root with workspaces
├── bun.lock
├── tsconfig.base.json        # Base TypeScript config
├── biome.json
│
├── packages/
│   │
│   ├── @argon/ui/                    # UI library (shadcn-vue based)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts            # Library mode
│   │   └── src/
│   │       ├── index.ts              # Re-exports all components
│   │       ├── accordion/
│   │       ├── avatar/
│   │       ├── button/
│   │       ├── ...everything from current ui/
│   │       └── styles/
│   │           └── base.css          # Tailwind base styles
│   │
│   ├── @argon/core/                  # Core utilities and types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── logger.ts
│   │       ├── disposables/
│   │       ├── utils.ts
│   │       └── types/
│   │
│   ├── @argon/glue/                  # API client (generated code)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── argonChat.ts          # Generated types
│   │       └── argon.ipc.ts
│   │
│   ├── @argon/stores/                # Reusable Pinia stores
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── unifiedCallStore.ts
│   │       ├── apiStore.ts
│   │       ├── poolStore.ts
│   │       ├── toneStore.ts
│   │       ├── userStore.ts
│   │       └── ...
│   │
│   ├── @argon/audio/                 # Audio management
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── AudioManager.ts
│   │       └── sounds/               # Sound assets
│   │
│   ├── @argon/components/            # Shared Vue components
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ArgonAvatar.vue
│   │       ├── SmartArgonAvatar.vue
│   │       ├── calls/                # Call components
│   │       └── shared/
│   │
│   ├── @argon/inventory/             # Inventory (for admin panel)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── InventoryView.vue
│   │       ├── InventoryShell.vue
│   │       ├── ItemGrantEffect.vue
│   │       ├── items.json
│   │       └── assets/               # Item icons
│   │
│   └── @argon/i18n/                  # Localization (SPECIAL CASE)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts              # Export setupI18n()
│           ├── core/                 # Public base keys
│           │   ├── en.json
│           │   ├── ru.json
│           │   └── ...
│           └── types.ts              # Types for locale merge
│
└── apps/
    │
    ├── client/                       # Main application (current UI)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── index.html
    │   └── src/
    │       ├── main.ts
    │       ├── App.vue
    │       ├── locales/              # PRIVATE localization keys
    │       │   ├── en.json           # Extends @argon/i18n/core/en
    │       │   └── ru.json
    │       ├── components/           # App-specific components
    │       ├── views/
    │       └── router/
    │
    ├── mitts/                        # Calling application
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   └── src/
    │       ├── main.ts
    │       └── ...
    │
    └── admin/                        # Admin panel (PRIVATE REPO)
        ├── package.json              # Imports @argon/inventory
        └── src/
            ├── locales/              # Private admin keys
            └── ...
```

---

## Localization Problem Solution

### Approach: Runtime Locale Merge

```typescript
// packages/@argon/i18n/src/index.ts
import { createI18n, type I18n } from 'vue-i18n'

// Base public keys
import enCore from './core/en.json'
import ruCore from './core/ru.json'

export const coreMessages = {
  en: enCore,
  ru: ruCore,
}

export type CoreLocaleSchema = typeof enCore

// Function to create i18n with private key merge
export function createArgonI18n<T extends Record<string, unknown>>(
  privateMessages: Record<string, T>
): I18n {
  const messages = Object.keys(coreMessages).reduce((acc, locale) => {
    acc[locale] = {
      ...coreMessages[locale as keyof typeof coreMessages],
      ...privateMessages[locale],
    }
    return acc
  }, {} as Record<string, unknown>)

  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages,
  })
}
```

### Usage in Private Repo (Admin Panel):

```typescript
// apps/admin/src/main.ts
import { createArgonI18n } from '@argon/i18n'

// Private keys that are not exposed in the public repo
import enPrivate from './locales/en.json'
import ruPrivate from './locales/ru.json'

const i18n = createArgonI18n({
  en: enPrivate,
  ru: ruPrivate,
})

app.use(i18n)
```

### Key Structure:

```
@argon/i18n/core/en.json (public):
{
  "close": "Close",
  "ok": "Confirm",
  "cancel": "Cancel",
  "inventory_empty": "Your inventory is empty",
  ...common UI strings
}

apps/admin/src/locales/en.json (private):
{
  "admin_dashboard": "Admin Dashboard",
  "admin_user_ban": "Ban User",
  "admin_secret_feature": "...",
  ...private admin strings
}
```

---

## Root package.json

```json
{
  "name": "argon",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "bun run --filter @argon/client dev",
    "dev:mitts": "bun run --filter @argon/mitts dev",
    "build": "bun run --filter './packages/*' build && bun run --filter './apps/*' build",
    "build:packages": "bun run --filter './packages/*' build",
    "lint": "biome check .",
    "typecheck": "bun run --filter '*' typecheck"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.7.2"
  }
}
```

---

## Package.json for @argon/ui (Example)

```json
{
  "name": "@argon/ui",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./styles": "./dist/styles/base.css"
  },
  "files": ["dist"],
  "scripts": {
    "build": "vite build",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "radix-vue": "1.9.17",
    "tailwind-merge": "^2.6.0"
  },
  "peerDependencies": {
    "vue": "^3.5.0"
  }
}
```

---

## Vite Config for Library (@argon/ui)

```typescript
// packages/@argon/ui/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    vue(),
    dts({ rollupTypes: true }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ArgonUI',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', 'radix-vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
```

---

## Package Dependency Graph

```
                    @argon/core
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    @argon/glue    @argon/audio    @argon/i18n
         │               │               │
         └───────┬───────┴───────────────┤
                 │                       │
            @argon/stores          @argon/ui
                 │                       │
         ┌───────┴───────────────────────┤
         │                               │
   @argon/components             @argon/inventory
         │                               │
         └───────────────┬───────────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
          client      mitts      admin
```

---

## Migration Plan (Step-by-Step)

### Phase 1: Structure Preparation
1. Create `packages/` and `apps/` directories
2. Set up root `package.json` with workspaces
3. Create `tsconfig.base.json`

### Phase 2: Extract @argon/core
1. Move `src/lib/logger.ts`, `src/lib/utils.ts`, `src/lib/disposables/`
2. Configure build and exports
3. Update imports in the main application

### Phase 3: Extract @argon/glue
1. Move `src/lib/glue/*`
2. Update Ion code generator for the new path

### Phase 4: Extract @argon/ui
1. Move all of `src/components/ui/`
2. Create barrel exports (`index.ts`)
3. Configure Vite library mode
4. Update imports in all components

### Phase 5: Extract @argon/stores
1. Move stores needed in other apps
2. Make them independent of UI components

### Phase 6: Extract @argon/i18n
1. Split localization into core (public) and app-specific (private)
2. Implement merge mechanism

### Phase 7: Extract @argon/components and @argon/inventory
1. Move shared components
2. Move inventory with assets

### Phase 8: Create apps/client
1. Move main application to `apps/client`
2. Update all imports to workspace packages

---

## Usage in Private Repositories

For private repos (admin panel, other applications) there are several options:

### Option 1: Git Submodule
```bash
# In the private admin repo
git submodule add git@github.com:argon-chat/client.git packages/argon
```

### Option 2: npm/bun link for Development
```bash
# In the public repo
cd packages/@argon/ui
bun link

# In the private repo
bun link @argon/ui
```

### Option 3: Private npm Registry / GitHub Packages
Publish packages to a private registry and install as regular dependencies.

### Option 4: Workspace References via Path (Recommended)
```json
// In the private admin repo package.json
{
  "dependencies": {
    "@argon/ui": "workspace:*",
    "@argon/inventory": "workspace:*",
    "@argon/stores": "workspace:*"
  }
}
```
The private repo must be in the same monorepo structure or use npm/bun workspaces with symbolic links.

---

## Advantages of This Approach

1. **Clear separation of concerns** - each package does one thing
2. **Independent versioning** - packages can be updated independently
3. **Reusability** - mitts, admin can use the same components
4. **Private data protection** - localization and specific logic remain in private repos
5. **Fast builds** - Bun caches packages, only changed ones are rebuilt
6. **Tree shaking** - applications import only what they need

---

## Getting Started Commands

```bash
# Initialization
mkdir -p packages apps
mv src apps/client/src

# Creating a package
mkdir -p packages/@argon/ui/src
# ... move files

# Install dependencies (hoisting)
bun install

# Run specific workspace
bun run --filter @argon/client dev

# Build all packages
bun run build:packages

# Type check everywhere
bun run --filter '*' typecheck
```

---

## Open Questions

1. **Tailwind config** - how to share config between packages? Probably via `@argon/tailwind-preset`
2. **Icons** - extract to separate package `@argon/icons` or keep in components?
3. **Assets** - how to handle static files (sounds, images) in library mode?
4. **Hot reload** - ensure Vite properly watches changes in workspace packages

---

## Next Steps

1. [ ] Discuss and approve structure
2. [ ] Create basic directory structure
3. [ ] Start with @argon/core (minimal dependencies)
4. [ ] Gradually extract remaining packages
5. [ ] Write migration scripts for automatic import updates
