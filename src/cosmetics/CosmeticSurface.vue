<script setup lang="ts">
import { computed, type Component } from "vue";
import { logger } from "@argon/core";
import type { ArgonUserProfile } from "@argon/glue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import type { CosmeticSurface, RenderPrimitive, ResolvedCosmetic } from "@/cosmetics/types";
import { componentForKind } from "@/cosmetics/primitives/renderers";

/**
 * Renders whatever somebody is wearing on one surface.
 *
 * <b>It never fetches.</b> Either the caller already holds the profile — a card, a preview — or it
 * names a person and the answer comes from the store's batch, which a list fills for its whole
 * window in one call. A component that fetched per person would put a request behind every avatar
 * in a member list, which is the one thing this design has to avoid.
 */
const props = defineProps<{
  surface: CosmeticSurface;

  /** When the caller holds a profile. Wins over `userId`. */
  profile?: ArgonUserProfile | null;

  /** When it does not: read from the batch, empty until that batch lands. */
  userId?: string;
  spaceId?: string | null;

  size?: number;
  tintColor?: number | null;

  /**
   * Narrows to the renderers this spot is for.
   *
   * One surface can carry things that belong in different places on it — a profile card has a
   * background behind everything and badges beside the name — and a host that drew all of them
   * would draw each in both. Filtering by primitive rather than by kind key is what keeps this a
   * seam: a new background-ish kind lands in the background slot because of what it renders as,
   * without this component learning its name.
   */
  primitives?: readonly RenderPrimitive[];
}>();

const cosmetics = useCosmeticsStore();

/** Whose profile this is. A widget needs it; the layer renderers ignore it. */
const subjectId = computed(() => props.profile?.userId ?? props.userId);

const worn = computed(() => {
  const resolved = props.profile
    ? cosmetics.resolve(props.profile, props.surface)
    : props.userId
      ? cosmetics.wornBy(props.spaceId, props.userId, props.surface)
      : [];

  if (!props.primitives) return resolved;

  return resolved.filter(item => props.primitives!.includes(item.kind.primitive));
});

function componentFor(item: ResolvedCosmetic): Component | null {
  const component = componentForKind(item.kind);

  if (!component) {
    logger.debug("No renderer in this build for cosmetic primitive", item.kind.primitive);
    return null;
  }

  return component;
}
</script>

<template>
  <template v-for="item in worn" :key="item.itemId">
    <component
      :is="componentFor(item)"
      v-if="componentFor(item)"
      :item="item"
      :size="size"
      :tint-color="tintColor"
      :user-id="subjectId"
      :space-id="spaceId ?? null"
    >
      <slot />
    </component>
  </template>
</template>
