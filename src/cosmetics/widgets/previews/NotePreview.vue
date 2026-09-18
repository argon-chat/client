<template>
  <!--
    What the card is, drawn rather than described: a heading and lines of writing under it. Bars
    instead of words because a word would have to be a language, and the name beside this already
    says what it is in the reader's.
  -->
  <svg viewBox="0 0 48 32" class="widget-preview" aria-hidden="true">
    <rect x="6" y="6" width="19" height="4" rx="2" fill="currentColor" opacity="0.85" />
    <rect x="6" y="14" width="36" height="2.6" rx="1.3" fill="currentColor" opacity="0.4" />
    <rect x="6" y="19.5" width="36" height="2.6" rx="1.3" fill="currentColor" opacity="0.4" />
    <rect x="6" y="25" width="22" height="2.6" rx="1.3" fill="currentColor" opacity="0.4" />
  </svg>
</template>

<style scoped>
.widget-preview {
  width: 100%;
  height: 100%;
  color: hsl(var(--primary));
}
</style>
