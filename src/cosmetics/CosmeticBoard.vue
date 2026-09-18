<script setup lang="ts">
import { computed } from "vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { BOARD_COLUMNS, type CosmeticSurface } from "@/cosmetics/types";
import { BOARD_ROW_HEIGHT } from "@/cosmetics/boardLayout";
import type { ArgonUserProfile } from "@argon/glue";

/**
 * Somebody's board as everybody else sees it: the same cells they dragged their cards into.
 *
 * <b>Placed by CSS grid rather than by the layout engine the editor uses.</b> A profile card is
 * read-only, and a grid that can be dragged brings pointer handlers and measurement to a surface
 * that may be on screen thousands of times in a member list. The coordinates are the same either
 * way, so the two agree without sharing an implementation.
 */
const props = defineProps<{
  profile: ArgonUserProfile | null | undefined;
  surface?: CosmeticSurface;

  /** Height of one grid row, matching what the editor was laid out against. */
  rowHeight?: number;
}>();

const cosmetics = useCosmeticsStore();

const cards = computed(() =>
  cosmetics.resolve(props.profile, props.surface ?? "profileCard").filter(item => item.kind.board));

function cellStyle(card: (typeof cards.value)[number]): Record<string, string> {
  return {
    gridColumn: `${card.cell.x + 1} / span ${Math.min(BOARD_COLUMNS, card.cell.w)}`,
    // Explicit row, not flow: with nothing compacted, a gap somebody left is part of the layout.
    gridRow: `${card.cell.y + 1} / span ${card.cell.h}`,
  };
}
</script>

<template>
  <div
    v-if="cards.length > 0"
    class="cosmetic-board"
    :style="{
      gridTemplateColumns: `repeat(${BOARD_COLUMNS}, minmax(0, 1fr))`,
      gridAutoRows: `${rowHeight ?? BOARD_ROW_HEIGHT}px`,
    }"
  >
    <div v-for="card in cards" :key="card.itemId" class="cosmetic-board-card" :style="cellStyle(card)">
      <component :is="card.kind.board!.card" :item="card" />
    </div>
  </div>
</template>

<style scoped>
/*
 * Mirrored by BOARD_GAP in `boardLayout.ts`, which is what a whole-card cosmetic measures its own
 * stage against. The two are a pair — CSS cannot read the constant and the constant cannot read this
 * — so changing one means changing the other, or a scene told to stop where the board starts stops a
 * few pixels away from it on every profile that has one.
 */
.cosmetic-board {
  display: grid;
  gap: 8px;
}

/*
 * A card, not a hole.
 *
 * A flat grey fill on a dark card read as a slab of missing content — a card is mostly empty by
 * design, so what fills the space has to be the surface itself. An edge and a lift say "this is a
 * thing" where a block of foreground at six percent says "something failed to load".
 */
.cosmetic-board-card {
  display: flex;
  flex-direction: column;
  padding: 9px 11px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.55);
  background: hsl(var(--card) / 0.5);
  box-shadow: 0 1px 2px hsl(0 0% 0% / 0.18);
  overflow: hidden;
}
</style>
