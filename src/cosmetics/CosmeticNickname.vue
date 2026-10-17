<script setup lang="ts">
import { computed } from "vue";
import type { ArgonUserProfile } from "@argon/glue";

import TextStyle from "@/cosmetics/primitives/TextStyle.vue";
import type { CosmeticSurface } from "@/cosmetics/types";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

/**
 * A display name, styled if the person is wearing something that styles names.
 *
 * <b>With nothing worn this renders a bare span</b>, so a name in a message list or a member row
 * comes out exactly as it did before — same element, same classes, same inline colour. That is not
 * an accident of the implementation, it is the requirement: this sits on the busiest text in the
 * product, and "cosmetics are off" has to cost nothing and change nothing.
 */
const props = defineProps<{
  surface: CosmeticSurface;

  /**
   * What the person wears. A card or a settings preview holds the whole profile; a message author
   * or a member row hands over the status row the profile cache already batched for it.
   */
  profile?: Pick<ArgonUserProfile, "cosmetics"> | null;

  /**
   * The colour this spot would paint the name if nothing were worn — a role colour in a message
   * list, a profile's accent on a card.
   *
   * <b>Offered, not imposed.</b> A surface that set the colour itself painted over whatever the
   * wearer chose, so the same name came out one colour in a chat and another everywhere else. It
   * arrives here instead, and what is worn decides whether to take it.
   */
  fallbackColor?: string;
}>();

const cosmetics = useCosmeticsStore();

const style = computed(() => {
  const worn = cosmetics.resolve(props.profile, props.surface);

  return worn.find(item => item.kind.primitive === "textStyle") ?? null;
});
</script>

<template>
  <TextStyle v-if="style" :item="style" :fallback-color="fallbackColor">
    <slot />
  </TextStyle>
  <span v-else :style="fallbackColor ? { color: fallbackColor } : undefined">
    <slot />
  </span>
</template>
