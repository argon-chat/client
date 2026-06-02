<!--
  SmoothResize — crossfades/slides between a single keyed child AND animates the
  container height to match, so swapping content of different heights doesn't jank.
  The leaving child is taken out of flow (absolute) so the entering child defines
  the target height immediately. Use for same-width content (e.g. wizard steps).

  overflow is clipped ONLY while a transition is running — when idle it's visible,
  so absolutely-positioned children (e.g. error badges that poke outside the box)
  are not cut off. Motion is auto-neutralized under prefers-reduced-motion.
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";

const inner = ref<HTMLElement | null>(null);
const height = ref<string>("auto");
const clipping = ref(false);
let active = 0;
let ro: ResizeObserver | null = null;

const update = () => {
  if (inner.value) height.value = `${inner.value.offsetHeight}px`;
};

const onStart = () => {
  active++;
  clipping.value = true;
};
const onEnd = () => {
  active = Math.max(0, active - 1);
  if (active === 0) clipping.value = false;
};

onMounted(() => {
  update();
  ro = new ResizeObserver(update);
  if (inner.value) ro.observe(inner.value);
});

onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div class="smooth-resize" :class="{ 'is-clipping': clipping }" :style="{ height }">
    <div ref="inner" class="smooth-resize-inner">
      <Transition
        name="sr"
        @before-enter="onStart"
        @before-leave="onStart"
        @after-enter="onEnd"
        @after-leave="onEnd"
        @enter-cancelled="onEnd"
        @leave-cancelled="onEnd"
      >
        <slot />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.smooth-resize {
  overflow: visible;
  transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Clip only mid-transition so sliding/absolute leaving content stays contained. */
.smooth-resize.is-clipping {
  overflow: hidden;
}

.smooth-resize-inner {
  position: relative;
}

.sr-enter-active,
.sr-leave-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.sr-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.sr-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.sr-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}
</style>
