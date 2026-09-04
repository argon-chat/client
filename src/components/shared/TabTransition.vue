<template>
  <Transition :name="`argon-tab-${variant}`" :mode="mode" :appear="appear">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /**
     * `slide` — sideways swap, for tabs and settings categories.
     * `rise` — subtler lift, for a detail pane reacting to a list selection.
     */
    variant?: "slide" | "rise";
    /** `out-in` keeps the outgoing and incoming panel from overlapping. */
    mode?: "out-in" | "in-out" | "default";
    /** Required when the parent unmounts the wrapper itself (reka-ui `TabsContent` does). */
    appear?: boolean;
  }>(),
  { variant: "slide", mode: "out-in", appear: false },
);
</script>

<!--
  Shared transition for switching panels in place: settings categories, tab strips,
  and detail panes driven by a list selection. Wrap the keyed element so every such
  switch in the app moves the same way, instead of each screen inventing its own.

  Companion to RouteTransition.vue, which does the same job for <RouterView>.
  Style is intentionally NOT scoped: Vue applies transition classes to the slotted
  child, which lives in the parent's scope, so scoped rules would never reach it.
  The `argon-tab-*` prefix keeps it from colliding with anything global.

  Motion durations are deliberately short — these panels are switched constantly,
  and anything slower reads as lag. The global reduced-motion rule in
  styles/reduced-motion.css collapses them to near-zero when the OS asks.
-->
<style>
.argon-tab-slide-enter-active {
  transition: opacity 0.22s ease-out, transform 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.argon-tab-slide-leave-active {
  transition: opacity 0.16s ease-in, transform 0.16s ease-in;
}

.argon-tab-slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.argon-tab-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.argon-tab-rise-enter-active {
  transition: opacity 0.2s ease-out, transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.argon-tab-rise-leave-active {
  transition: opacity 0.12s ease-in;
}

.argon-tab-rise-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.argon-tab-rise-leave-to {
  opacity: 0;
}
</style>
