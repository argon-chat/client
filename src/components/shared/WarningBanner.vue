<script setup lang="ts">
// The one warning banner. Text uses the theme tokens, only the accent is amber, so it
// stays readable in light and dark instead of yellow-on-yellow.
import { TriangleAlertIcon } from "lucide-vue-next";
import { Alert } from "@argon/ui/alert";

defineProps<{ title: string; description?: string }>();
</script>

<template>
  <Alert variant="warning" class="flex items-center gap-3 rounded-xl px-5 py-4">
    <span class="shrink-0 text-amber-600 dark:text-amber-400 [&>svg]:h-5 [&>svg]:w-5">
      <slot name="icon"><TriangleAlertIcon /></slot>
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="description || $slots.description" class="mt-0.5 text-xs text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.action" class="shrink-0">
      <slot name="action" />
    </div>
  </Alert>
</template>
