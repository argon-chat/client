<template>
    <div class="inline-flex items-center">
        <kbd v-for="(i, x) in keys" :key="x" class="hotkey-kbd">
            {{ i }}
        </kbd>
    </div>
</template>

<script setup lang="ts">
defineProps<{
  keys: string[];
}>();
</script>
<style scoped>
.hotkey-kbd {
    @apply px-1.5 py-0.5 rounded border text-xs shadow;
    position: relative;
    margin-right: 0.55rem;
}

.hotkey-kbd:not(:last-child)::after {
    content: "+";
    position: absolute;
    right: -0.65rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.85rem;
    color: theme("colors.muted.foreground");
    margin-left: 0.25rem;
}
</style>