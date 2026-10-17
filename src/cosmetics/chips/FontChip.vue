<script setup lang="ts">
import { computed } from "vue";

import type { CosmeticOptionChipProps } from "@/cosmetics/chips/types";
import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import { useFontOption } from "@/cosmetics/primitives/textComposition";

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

// The face has to be on the page before its own name can be written in it.
useFontOption(computed(() => props.option));

const family = computed(() => (props.option.payload as FontOptionPayload | null)?.cssFamily ?? "inherit");

/** The family name as written, minus the fallbacks the payload carries for CSS. */
const label = computed(() => {
  const first = family.value.split(",")[0]?.trim() ?? "";

  return first.replace(/^['"]|['"]$/g, "") || props.sample;
});

/** The payload is a bare family now, so the fallback the renderer draws with is added here. */
const face = computed(() => (family.value === "inherit" ? family.value : `"${label.value}", sans-serif`));
</script>

<template>
  <span class="font-chip" :style="{ fontFamily: face }">{{ label }}</span>
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
