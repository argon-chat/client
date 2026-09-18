<script setup lang="ts">
import { computed } from "vue";
import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import type { CosmeticOptionChipProps } from "@/cosmetics/chips/types";

/**
 * A face, shown as its own name written in it.
 *
 * <b>Three letters of somebody's nickname could not tell these apart.</b> The faces on offer are
 * mostly humanist sans — they differ in ways that need more than "Пик" at thirteen pixels to see,
 * and half of them differ most in letters a short Cyrillic sample does not contain. A font picker
 * that shows the same word in every option is showing the same thing in every option.
 *
 * So the sample is the face's own name, which differs per chip by construction and is the one string
 * guaranteed to be in the face's own alphabet.
 */
const props = defineProps<CosmeticOptionChipProps>();

const family = computed(() => (props.payload as FontOptionPayload | null)?.cssFamily ?? "inherit");

/** The family name as written, minus the fallbacks the payload carries for CSS. */
const label = computed(() => {
  const first = family.value.split(",")[0]?.trim() ?? "";

  return first.replace(/^['"]|['"]$/g, "") || props.sample;
});
</script>

<template>
  <span class="font-chip" :style="{ fontFamily: family }">{{ label }}</span>
</template>

<style scoped>
.font-chip {
  display: block;
  max-width: 108px;
  font-size: 0.95rem;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
