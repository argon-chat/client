<template>
  <Transition name="argon-route" mode="out-in">
    <slot />
  </Transition>
</template>

<!--
  Shared shell <RouterView> transition. Wrap the keyed <component>/<div> so
  Master / Home / Space all switch views with the same motion.
  Style is intentionally NOT scoped: Vue transition classes are applied to the
  slotted child (which lives in the parent's scope), so scoped rules wouldn't reach it.
  The `argon-route-*` prefix keeps it from colliding with anything global.
-->
<style>
.argon-route-enter-active,
.argon-route-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.argon-route-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.argon-route-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
