<!--
  Skeleton — shimmer placeholder block. Pass sizing via class, e.g.
  <Skeleton class="h-10 w-10 rounded-full" />. The shimmer is auto-disabled
  under prefers-reduced-motion by the global stylesheet.
-->
<template>
  <div class="argon-skeleton"></div>
</template>

<style scoped>
.argon-skeleton {
  position: relative;
  overflow: hidden;
  background: hsl(var(--muted) / 0.5);
  border-radius: 8px;
}

.argon-skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    hsl(var(--foreground) / 0.06),
    transparent
  );
  animation: argon-skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes argon-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}
</style>
