<script setup lang="ts">
import { computed, type Component } from "vue";
import { storeToRefs } from "pinia";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { IconLock } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { BOARD_COLUMNS, type CosmeticKindModule } from "@/cosmetics/types";
import { cosmeticDescription, cosmeticName } from "@/lib/cosmeticText";
import type { CatalogueCosmetic } from "@argon/glue";

/**
 * Choosing a card to put on the board.
 *
 * <b>A window, because choosing is a decision.</b> What was here first was a button that unfolded a
 * row of chips underneath itself — easy to miss, impossible to read, and it said nothing about what
 * you were about to add.
 *
 * Each card is shown at the shape it will actually occupy. That is the thing being chosen: a widget
 * is a frame you fill in later, so its name and its footprint are what there is to know beforehand,
 * and a live preview of an empty one would be a rectangle pretending to be information.
 */
const props = defineProps<{
  open: boolean;
  items: readonly CatalogueCosmetic[];
  kindOf: (kindKey: string) => CosmeticKindModule | undefined;
  atLimit: (item: CatalogueCosmetic) => boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  pick: [item: CatalogueCosmetic];
}>();

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);

interface Offer {
  item: CatalogueCosmetic;
  width: number;
  height: number;
  maxPerBoard: number;
  disabled: boolean;
  reason: string | null;

  /** What the card is, drawn by the kind itself. Null falls back to the bare footprint. */
  preview: Component | null;
}

const offers = computed<Offer[]>(() =>
  props.items.map(item => {
    const kind = props.kindOf(item.kindKey);
    const board = item.board;

    const full = props.atLimit(item);

    return {
      item,
      width: board?.defaultWidth ?? kind?.board?.minWidth ?? 1,
      height: board?.defaultHeight ?? kind?.board?.minHeight ?? 1,
      maxPerBoard: board?.maxPerBoard ?? kind?.maxSlots ?? 1,
      disabled: props.busy || !item.owned || full,
      reason: !item.owned ? "cosmetic_locked_grant" : full ? "cosmetic_board_at_limit" : null,
      preview: kind?.board?.preview ?? null,
    };
  }));

function nameOf(item: CatalogueCosmetic): string {
  return cosmeticName(item, currentLocale.value);
}

function descriptionOf(item: CatalogueCosmetic): string | null {
  return cosmeticDescription(item, currentLocale.value);
}

/** The footprint, drawn to scale against the board rather than to its own pixels. */
function footprint(offer: Offer): Record<string, string> {
  return {
    width: `${(offer.width / BOARD_COLUMNS) * 100}%`,
    aspectRatio: `${offer.width * 3} / ${offer.height}`,
  };
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[560px] max-w-[92vw]" described>
      <DialogHeader>
        <DialogTitle>{{ t("cosmetic_board_add") }}</DialogTitle>
        <DialogDescription>{{ t("cosmetic_board_add_hint") }}</DialogDescription>
      </DialogHeader>

      <div v-if="offers.length === 0" class="text-xs text-muted-foreground">
        {{ t("cosmetic_nothing_here_yet") }}
      </div>

      <div v-else class="widget-offers">
        <button
          v-for="offer in offers"
          :key="offer.item.cosmeticId"
          class="widget-offer"
          :class="{ 'widget-offer--locked': offer.disabled }"
          :disabled="offer.disabled"
          @click="emit('pick', offer.item); emit('update:open', false)"
        >
          <div class="widget-shape-frame">
            <div class="widget-shape" :style="footprint(offer)">
              <component :is="offer.preview" v-if="offer.preview" />
            </div>
          </div>

          <div class="widget-offer-text">
            <div class="widget-offer-name">
              {{ nameOf(offer.item) }}
              <IconLock v-if="offer.reason" class="w-3 h-3 text-muted-foreground" />
            </div>

            <div v-if="descriptionOf(offer.item)" class="widget-offer-desc">
              {{ descriptionOf(offer.item) }}
            </div>

            <div class="widget-offer-meta">
              <span>{{ t("cosmetic_board_size", { width: offer.width, height: offer.height }) }}</span>
              <span>{{ t("cosmetic_board_allowance", { count: offer.maxPerBoard }) }}</span>
            </div>

            <div v-if="offer.reason" class="widget-offer-reason">{{ t(offer.reason) }}</div>
          </div>
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.widget-offers {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 58vh;
  overflow-y: auto;
  scrollbar-width: thin;
}

.widget-offer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--background));
  text-align: left;
}

.widget-offer:not(:disabled):hover {
  border-color: hsl(var(--primary));
  background: hsl(var(--secondary) / 0.35);
}

.widget-offer--locked {
  opacity: 0.55;
}

/* The board, at a glance: the shape sits inside it at the fraction of the width it will take. */
.widget-shape-frame {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  width: 96px;
  min-height: 62px;
  padding: 6px;
  border-radius: 8px;
  border: 1px dashed hsl(var(--border));
}

.widget-shape {
  display: flex;
  border-radius: 5px;
  border: 1px solid hsl(var(--primary) / 0.35);
  background: hsl(var(--primary) / 0.1);
  overflow: hidden;
}

.widget-offer-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.widget-offer-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.85rem;
  font-weight: 500;
}

.widget-offer-desc {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.widget-offer-meta {
  display: flex;
  gap: 10px;
  font-size: 0.68rem;
  color: hsl(var(--muted-foreground));
}

.widget-offer-reason {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: hsl(var(--muted-foreground));
}
</style>
