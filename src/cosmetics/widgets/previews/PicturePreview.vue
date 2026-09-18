<template>
  <!--
    A picture filling its frame with a caption across the foot — the one card here that is not
    writing, drawn so that reads at a glance.
  -->
  <svg viewBox="0 0 48 32" class="widget-preview" aria-hidden="true">
    <rect x="4" y="4" width="40" height="24" rx="3" fill="currentColor" opacity="0.28" />
    <circle cx="16" cy="13" r="3.4" fill="currentColor" opacity="0.75" />
    <path d="M8 24 L19 14.5 L27 21 L33 17 L40 24 Z" fill="currentColor" opacity="0.7" />
    <rect x="4" y="22" width="40" height="6" fill="currentColor" opacity="0.5" />
    <rect x="8" y="24.4" width="16" height="2.2" rx="1.1" fill="hsl(var(--background))" opacity="0.85" />
  </svg>
</template>

<style scoped>
.widget-preview {
  width: 100%;
  height: 100%;
  color: hsl(var(--primary));
}
</style>
