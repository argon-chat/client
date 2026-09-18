<script setup lang="ts">
import { computed } from "vue";
import type { SwatchOptionPayload } from "@/cosmetics/kinds/option-swatch";
import type { CosmeticOptionChipProps } from "@/cosmetics/chips/types";

const props = defineProps<CosmeticOptionChipProps>();

const hex = computed(() => (props.payload as SwatchOptionPayload | null)?.hex ?? "transparent");
</script>

<template>
  <span class="swatch-chip" :style="{ background: hex }" />
</template>

<style scoped>
.swatch-chip {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.18);
}
</style>
