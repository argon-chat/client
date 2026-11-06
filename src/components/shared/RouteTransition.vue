<template>
  <Transition mode="out-in" :css="false" @leave="leave" @enter="enter">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
// The outgoing view leaves at once; only the incoming one moves, briefly.
//
// This used to be a 200 ms out-in cross-fade. `out-in` means the incoming view
// cannot even start mounting (or loading its data) until the outgoing one has
// finished fading, so every Master / Home / Space switch spent ~225 ms on motion
// before any work began — half of the time it took a space to show its messages.
//
// Now the old view is removed and the new one mounted in the same task, before
// the next frame, so there is never a frame with both (no double content, no
// layout jump) and never an empty one. `:css="false"` keeps Vue from adding
// transition classes and forcing a reflow on every switch. The entrance is a
// short CSS animation, front-loaded so most of it is done before the new view's
// content arrives.
function leave(_el: Element, done: () => void) {
  // On a microtask, not inline: an out-in leave that finishes inside the patch
  // that started it re-renders <Transition> re-entrantly, and the incoming view
  // is lost (it never mounts).
  queueMicrotask(done);
}

function enter(el: Element, done: () => void) {
  el.classList.add("argon-route-in");
  const onEnd = (e: Event) => {
    if (e.target !== el) return; // a child's animation bubbling up
    el.classList.remove("argon-route-in");
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
  done();
}
</script>

<!--
  Shared shell <RouterView> transition. Wrap the keyed <component>/<div> so
  Master / Home / Space all switch views with the same motion.
  Style is intentionally NOT scoped: the class goes on the slotted child (which
  lives in the parent's scope), so scoped rules wouldn't reach it.
  The `argon-route-*` prefix keeps it from colliding with anything global.
  The global reduced-motion rule (styles/reduced-motion.css) collapses it.
-->
<style>
/* `backwards`, not `both`: nothing of the animation outlives it. A transform
   held by a forwards fill would make the view the containing block of every
   `position: fixed` element inside it. */
.argon-route-in {
  animation: argon-route-in 0.14s cubic-bezier(0.2, 0.8, 0.3, 1) backwards;
}

@keyframes argon-route-in {
  from {
    opacity: 0;
    transform: translateX(6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
