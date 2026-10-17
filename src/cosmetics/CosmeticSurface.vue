<script setup lang="ts">
import {
  computed,
  type Component,
} from "vue";
import { logger } from "@argon/core";
import type { ArgonUserProfile } from "@argon/glue";

import type {
  CosmeticSurface,
  RenderPrimitive,
  ResolvedCosmetic,
} from "@/cosmetics/types";
import { componentForKind } from "@/cosmetics/primitives/renderers";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

/**
 * Renders whatever somebody is wearing on one surface.
 *
 * <b>It never fetches.</b> The caller already holds the profile — a card, a preview — or the status
 * row a list fills for its whole window through the profile cache's batch. A component that fetched
 * per person would put a request behind every avatar in a member list, which is the one thing this
 * design has to avoid.
 */
const props = defineProps<{
  surface: CosmeticSurface;

  /** What the person wears. Null or not yet told draws nothing. */
  profile?: Pick<ArgonUserProfile, "cosmetics"> | null;

  /**
   * Narrows to the renderers this spot is for.
   *
   * One surface can carry things that belong in different places on it, and a host that drew all
   * of them would draw each in both. Filtering by primitive rather than by kind key is what keeps
   * this a seam: a new kind lands in the right slot because of what it renders as, without this
   * component learning its name.
   */
  primitives?: readonly RenderPrimitive[];
}>();

const cosmetics = useCosmeticsStore();

const worn = computed(() => {
  const resolved = cosmetics.resolve(props.profile, props.surface);

  if (!props.primitives) {
    return resolved;
  }

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
  <template v-for="item in worn" :key="item.itemId ?? item.kind.key">
    <component
      :is="componentFor(item)"
      v-if="componentFor(item)"
      :item="item"
    >
      <slot />
    </component>
  </template>
</template>
