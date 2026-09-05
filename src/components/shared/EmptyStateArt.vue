<!--
  Animated artwork for empty states.

  The SVGs under src/styles/empty-states carry their own <style> block, so they have to be inlined
  (an <img>/background would isolate them from the page and freeze their colours). Inlining means
  two things are handled inside the files themselves, by scripts/theme-empty-states.mjs:

    * every selector is scoped under .es-svg and every @keyframes is prefixed with es-, because a
      <style> inside an inlined SVG applies to the whole document;
    * every colour is an inline style="fill:var(--es-…,#hex)", so the theme drives it. Presentation
      attributes are avoided on purpose — var() in them is not reliable across WebKit — and the hex
      fallback keeps the file viewable on its own.

  The palette below is the only place the artwork meets the theme: the accent follows --primary
  (i.e. the accent colour picked in Appearance settings) and the neutrals follow the usual surface
  tokens, so dark / light / OLED all work without a second set of files.
-->
<template>
  <div
    class="es-art"
    :class="{ 'es-art--still': reduceMotion }"
    :style="{ width: px, height: px }"
    aria-hidden="true"
    v-html="markup"
  />
</template>

<script lang="ts">
export type EmptyStateArtName =
  | "call-failed"
  | "error-generic"
  | "forbidden"
  | "installing"
  | "inventory"
  | "no-bots"
  | "no-channels"
  | "no-friends-online"
  | "no-friends-sad"
  | "no-invites"
  | "no-messages"
  | "no-one-here"
  | "no-text-channel"
  | "invite-invalid"
  | "no-access"
  | "no-boosts"
  | "no-devices"
  | "no-hotkeys"
  | "no-passkeys"
  | "no-screens"
  | "no-sessions"
  | "no-transactions"
  | "not-found"
  | "offline"
  | "permission-needed"
  | "select-role"
  | "unauthorized"
  | "updating";
</script>

<script setup lang="ts">
import { computed } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";

import callFailed from "@/styles/empty-states/call-failed.svg?raw";
import errorGeneric from "@/styles/empty-states/error-generic.svg?raw";
import forbidden from "@/styles/empty-states/forbidden.svg?raw";
import installing from "@/styles/empty-states/installing.svg?raw";
import inventory from "@/styles/empty-states/inventory.svg?raw";
import inviteInvalid from "@/styles/empty-states/invite-invalid.svg?raw";
import noAccess from "@/styles/empty-states/no-access.svg?raw";
import noBoosts from "@/styles/empty-states/no-boosts.svg?raw";
import noDevices from "@/styles/empty-states/no-devices.svg?raw";
import noHotkeys from "@/styles/empty-states/no-hotkeys.svg?raw";
import noPasskeys from "@/styles/empty-states/no-passkeys.svg?raw";
import noScreens from "@/styles/empty-states/no-screens.svg?raw";
import noSessions from "@/styles/empty-states/no-sessions.svg?raw";
import noTransactions from "@/styles/empty-states/no-transactions.svg?raw";
import offline from "@/styles/empty-states/offline.svg?raw";
import permissionNeeded from "@/styles/empty-states/permission-needed.svg?raw";
import unauthorized from "@/styles/empty-states/unauthorized.svg?raw";
import updating from "@/styles/empty-states/updating.svg?raw";
import noBots from "@/styles/empty-states/no-bots.svg?raw";
import noChannels from "@/styles/empty-states/no-channels.svg?raw";
import noFriendsOnline from "@/styles/empty-states/no-friends-online.svg?raw";
import noFriendsSad from "@/styles/empty-states/no-friends-sad.svg?raw";
import noInvites from "@/styles/empty-states/no-invites.svg?raw";
import noMessages from "@/styles/empty-states/no-messages.svg?raw";
import noOneHere from "@/styles/empty-states/no-one-here.svg?raw";
import noTextChannel from "@/styles/empty-states/no-text-channel.svg?raw";
import notFound from "@/styles/empty-states/not-found.svg?raw";
import selectRole from "@/styles/empty-states/select-role.svg?raw";

const ART: Record<EmptyStateArtName, string> = {
  "call-failed": callFailed,
  "error-generic": errorGeneric,
  forbidden,
  installing,
  inventory,
  "invite-invalid": inviteInvalid,
  "no-access": noAccess,
  "no-boosts": noBoosts,
  "no-devices": noDevices,
  "no-hotkeys": noHotkeys,
  "no-passkeys": noPasskeys,
  "no-screens": noScreens,
  "no-sessions": noSessions,
  "no-transactions": noTransactions,
  offline,
  "permission-needed": permissionNeeded,
  unauthorized,
  updating,
  "no-bots": noBots,
  "no-channels": noChannels,
  "no-friends-online": noFriendsOnline,
  "no-friends-sad": noFriendsSad,
  "no-invites": noInvites,
  "no-messages": noMessages,
  "no-one-here": noOneHere,
  "no-text-channel": noTextChannel,
  "not-found": notFound,
  "select-role": selectRole,
};

const props = withDefaults(
  defineProps<{
    name: EmptyStateArtName;
    /** Rendered box in px — the artwork is square. */
    size?: number;
  }>(),
  { size: 140 },
);

const markup = computed(() => ART[props.name]);
const px = computed(() => `${props.size}px`);

// The OS setting is neutralised globally by styles/reduced-motion.css; this is the in-app toggle.
// It has to be the shared ref: a local persistedValue() would not see the switch being flipped.
</script>

<style scoped>
.es-art {
  /* Accent — whatever the user picked in Appearance settings. */
  --es-accent: hsl(var(--primary));
  --es-accent-deep: hsl(var(--primary));

  /* Neutrals — the surface tokens, so light and OLED come for free. */
  --es-surface: hsl(var(--muted));
  --es-surface-2: hsl(var(--foreground) / 0.1);
  --es-line: hsl(var(--muted-foreground) / 0.42);
  --es-line-strong: hsl(var(--muted-foreground) / 0.75);
  --es-paper: hsl(var(--foreground));
  --es-paper-dim: hsl(var(--muted-foreground));

  /* Fixed: a screen and a drop shadow read the same way in every theme, and a glyph sitting on the
     accent stays white whatever the accent is. */
  --es-void: #131316;
  --es-on-accent: #fff;
  --es-shadow: #000;

  /* Semantic confetti — deliberately not the theme's destructive/success, which are UI states.
     Constant across themes: a warning sign that changed colour with the theme would stop reading
     as one. --es-success is the decorative teal; --es-ok is an actual "this worked" green. */
  --es-danger: #f04747;
  --es-danger-soft: #ffb3b3;
  --es-warning: #f0b232;
  --es-warning-deep: #c98f1a;
  --es-success: #2bb3a3;
  --es-ok: #3ba55c;
  --es-info: #5fb3f5;

  flex: none;
  line-height: 0;
  user-select: none;
  pointer-events: none;
}

.es-art :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* The intro pop is a keyframe with `both` fill, so it cannot simply be dropped — the artwork would
   stay at its 0% (invisible) state. Collapsing the duration lands it on its final frame instead. */
.es-art--still :deep(*) {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
}
</style>
