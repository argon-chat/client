<script setup lang="ts">
import { computed } from "vue";
import type { ArgonUserProfile } from "@argon/glue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import type { CosmeticSurface } from "@/cosmetics/types";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";

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

  /** When the caller holds a profile — a card, a settings preview. */
  profile?: ArgonUserProfile | null;

  /**
   * When the caller does not, and cannot afford to fetch one: a message author, a member row.
   * Read synchronously from the store's batch, and empty until that batch lands.
   */
  userId?: string;
  spaceId?: string | null;

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

/**
 * The name a look gives its wearer here, if it gives one.
 *
 * Null falls through to whatever the caller put in the slot, which is the account's name — the same
 * inheritance the look itself is built on, arriving at the last place that draws it.
 */
const overridden = computed(() => {
  if (props.profile) return props.profile.displayNameOverride ?? null;

  return props.userId ? cosmetics.wornIdentity(props.spaceId, props.userId).name : null;
});

const style = computed(() => {
  const worn = props.profile
    ? cosmetics.resolve(props.profile, props.surface)
    : props.userId
      ? cosmetics.wornBy(props.spaceId, props.userId, props.surface)
      : [];

  return worn.find(item => item.kind.primitive === "textStyle") ?? null;
});
</script>

<template>
  <TextStyle v-if="style" :item="style" :fallback-color="fallbackColor">
    <template v-if="overridden">{{ overridden }}</template>
    <slot v-else />
  </TextStyle>
  <span v-else :style="fallbackColor ? { color: fallbackColor } : undefined">
    <template v-if="overridden">{{ overridden }}</template>
    <slot v-else />
  </span>
</template>
