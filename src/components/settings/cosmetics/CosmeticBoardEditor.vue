<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { GridItem, GridLayout } from "grid-layout-plus";
import { Button } from "@argon/ui/button";
import { IconGridDots, IconPlus, IconTrash } from "@tabler/icons-vue";
import { persistedValue } from "@argon/storage";
import { useLocale } from "@/store/system/localeStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { cosmeticKinds, resolveKind } from "@/cosmetics/registry";
import CosmeticWidgetPicker from "@/components/settings/cosmetics/CosmeticWidgetPicker.vue";
import { BOARD_COLUMNS, BOARD_ROWS, type CosmeticKindModule } from "@/cosmetics/types";
import type { CatalogueCosmetic, CosmeticLoadout, WidgetCard } from "@argon/glue";

/**
 * The profile board: the cards a person puts on their profile, where they put them.
 *
 * <b>Widgets are the one kind of cosmetic whose content belongs to its wearer.</b> Everything else
 * here is authored by an operator and worn as it was made, so a picker is enough. A card is a frame
 * somebody writes into, moves and resizes — which is why it gets a grid of its own rather than a row
 * in the list above.
 *
 * The grid is <c>grid-layout-plus</c>, the same one the home dashboard already lays its widgets out
 * with: dragged by the card, resized from its corner, and packed upwards on its own so a gap left
 * above a card closes without anybody tidying up.
 *
 * <b>This file knows no widget.</b> Which cards exist, what each holds, how big it may be and how it
 * draws all come from the kind's own declaration, so a widget invented later appears here with
 * nothing changed.
 */
const props = defineProps<{ loadout: CosmeticLoadout; busy: boolean }>();

const emit = defineEmits<{ apply: [cards: WidgetCard[]] }>();

const { t } = useLocale();
const cosmetics = useCosmeticsStore();

/** How many cards a board holds. Mirrors the server's own limit. */
const BOARD_LIMIT = 12;

const ROW_HEIGHT = 28;

const GRID_MARGIN = 8;

/**
 * Whether the cells are drawn under the cards.
 *
 * Remembered per person because it is a working preference rather than part of the look: somebody
 * lining cards up wants it on, and wants it on again tomorrow.
 */
const showGrid = persistedValue<boolean>("cosmetics.board.showGrid", false);

const boardHeight = BOARD_ROWS * ROW_HEIGHT + (BOARD_ROWS + 1) * GRID_MARGIN;

interface BoardItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  cosmeticId: string;
  kindKey: string;
  content: unknown;
}

const layout = ref<BoardItem[]>([]);

const widgetKinds = computed(() =>
  cosmeticKinds.filter(kind => kind.board && cosmetics.isKindEnabled(kind.key)));

/** What may be added: the catalogue rows of every widget kind, owned ones first. */
const available = computed(() => {
  const rows: CatalogueCosmetic[] = [];

  for (const kind of widgetKinds.value) {
    rows.push(...(cosmetics.catalogue?.items ?? []).filter(item => item.kindKey === kind.key));
  }

  return rows.sort((left, right) => Number(right.owned) - Number(left.owned));
});

function kindOf(kindKey: string): CosmeticKindModule | undefined {
  return resolveKind(kindKey);
}

function boardOf(loadout: CosmeticLoadout): BoardItem[] {
  const drafted: BoardItem[] = [];

  for (const worn of loadout.equipped) {
    const kind = resolveKind(worn.kindKey);

    if (!kind?.board) continue;

    let content = kind.board.empty();

    if (worn.contentJson) {
      try {
        content = kind.board.parse(JSON.parse(worn.contentJson)) ?? content;
      } catch {
        // Content this build cannot read starts empty rather than blocking the editor.
      }
    }

    drafted.push(place(kind, `${worn.kindKey}:${worn.slotIndex}`, worn.itemId, worn.kindKey, content, {
      x: worn.boardX ?? 0,
      y: worn.boardY ?? 0,
      w: worn.boardW ?? 1,
      h: worn.boardH ?? kind.board.minHeight,
    }));
  }

  return drafted;
}

/**
 * A card in the shape the grid wants.
 *
 * <b>The key has to be stable and unique.</b> The same catalogue row can be on a board more than
 * once — two tag cards is an ordinary thing to want — and a key made from its id and position
 * collided the moment both sat at the origin, which the grid resolves by drawing them on top of one
 * another instead of pushing them apart.
 */
function place(
  kind: CosmeticKindModule,
  key: string,
  cosmeticId: string,
  kindKey: string,
  content: unknown,
  at: { x: number; y: number; w: number; h: number },
): BoardItem {
  // The row's own limits where the catalogue has them, the kind's where it does not — an operator
  // decides what is offered of a card, within what its code can draw.
  const offered = offerFor(cosmeticId);
  const board = kind.board!;

  const minW = offered?.minWidth ?? board.minWidth;
  const maxW = Math.min(BOARD_COLUMNS, offered?.maxWidth ?? board.maxWidth);
  const minH = offered?.minHeight ?? board.minHeight;
  const maxH = offered?.maxHeight ?? board.maxHeight;

  return {
    i: key,
    x: at.x,
    y: Math.min(at.y, Math.max(0, BOARD_ROWS - Math.min(Math.max(at.h, minH), maxH))),
    w: Math.min(Math.max(at.w, minW), maxW),
    h: Math.min(Math.max(at.h, minH), maxH),
    minW,
    maxW,
    minH,
    maxH,
    cosmeticId,
    kindKey,
    content,
  };
}

function offerFor(cosmeticId: string) {
  return (cosmetics.catalogue?.items ?? []).find(item => item.cosmeticId === cosmeticId)?.board ?? null;
}

watch(() => props.loadout, loadout => { layout.value = boardOf(loadout); }, { immediate: true, deep: true });

/** Compared without the grid's own key, which changes with a position and says nothing about it. */
function shape(items: readonly BoardItem[]): string {
  return JSON.stringify(items.map(({ cosmeticId, x, y, w, h, content }) => ({ cosmeticId, x, y, w, h, content })));
}

const dirty = computed(() => shape(layout.value) !== shape(boardOf(props.loadout)));

const adding = ref(false);

/** Keeps a freshly added card's key from colliding with one added and removed a moment earlier. */
let added = 0;

function add(item: CatalogueCosmetic): void {
  const kind = kindOf(item.kindKey);

  if (!kind?.board || layout.value.length >= BOARD_LIMIT) return;

  if (atLimit(item)) return;

  const offered = item.board;

  const held = layout.value.filter(card => card.kindKey === item.kindKey).length;

  if (held >= (kind.maxSlots ?? 1)) return;

  // Under whatever is already there, and never past the bottom of the board.
  const height = offered?.defaultHeight ?? kind.board.minHeight;
  const below = Math.min(
    layout.value.reduce((lowest, card) => Math.max(lowest, card.y + card.h), 0),
    Math.max(0, BOARD_ROWS - height),
  );
  const key = `${item.kindKey}:${held}:new-${added++}`;

  layout.value = [...layout.value, place(kind, key, item.cosmeticId, item.kindKey, kind.board.empty(), {
    x: 0,
    y: below,
    w: offered?.defaultWidth ?? kind.board.minWidth,
    h: height,
  })];

  adding.value = false;
}

/** Whether this row is already on the board as many times as its operator allows. */
function atLimit(item: CatalogueCosmetic): boolean {
  const held = layout.value.filter(card => card.cosmeticId === item.cosmeticId).length;

  return held >= (item.board?.maxPerBoard ?? kindOf(item.kindKey)?.maxSlots ?? 1);
}

function remove(key: string): void {
  layout.value = layout.value.filter(card => card.i !== key);
}

function write(key: string, content: unknown): void {
  layout.value = layout.value.map(card => (card.i === key ? { ...card, content } : card));
}

function apply(): void {
  emit("apply", layout.value.map(card => ({
    cosmeticId: card.cosmeticId,
    contentJson: JSON.stringify(card.content),
    x: card.x,
    y: card.y,
    w: card.w,
    h: card.h,
  })) as WidgetCard[]);
}
</script>

<template>
  <div v-if="widgetKinds.length > 0" class="board-block">
    <div class="board-head">
      <div class="text-sm font-medium">{{ t("cosmetic_board") }}</div>

      <div class="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          :class="{ 'text-primary': showGrid }"
          :title="t('cosmetic_board_show_grid')"
          @click="showGrid = !showGrid"
        >
          <IconGridDots class="w-3.5 h-3.5 mr-1" />{{ t("cosmetic_board_show_grid") }}
        </Button>

        <Button
          size="sm"
          variant="outline"
          :disabled="busy || layout.length >= BOARD_LIMIT"
          @click="adding = true"
        >
          <IconPlus class="w-3.5 h-3.5 mr-1" />{{ t("cosmetic_board_add") }}
        </Button>
      </div>
    </div>

    <p class="text-xs text-muted-foreground">{{ t("cosmetic_board_hint") }}</p>

    <CosmeticWidgetPicker
      v-model:open="adding"
      :items="available"
      :kind-of="kindOf"
      :at-limit="atLimit"
      :busy="busy"
      @pick="add"
    />

    <div v-if="layout.length === 0" class="text-xs text-muted-foreground board-empty">
      {{ t("cosmetic_board_empty") }}
    </div>

    <!--
      Nothing is packed for anybody. Compacting pulled every card to the top, so a gap left on
      purpose closed itself and a board could only ever be flush — you could not put a card in the
      middle, or leave one side lighter than the other, which is most of what arranging is.
    -->
    <!--
      With the guide on, the stage is the whole board rather than the height of what is on it: the
      cells below the last card are where there is still room, and the bottom edge is the limit a
      profile may grow to.
    -->
    <div v-else class="board-stage" :style="showGrid ? { minHeight: `${boardHeight}px` } : undefined">
      <!--
        The cells, drawn with the same padding, gap and row height the layout positions items by, so
        a card lands on a cell rather than near one. Sized from the constants rather than measured:
        two copies of the same arithmetic is how a guide ends up half a pixel out.
      -->
      <div
        v-if="showGrid"
        class="board-cells"
        :style="{
          padding: `${GRID_MARGIN}px`,
          gap: `${GRID_MARGIN}px`,
          gridTemplateColumns: `repeat(${BOARD_COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_HEIGHT}px`,
        }"
      >
        <span v-for="cell in BOARD_COLUMNS * BOARD_ROWS" :key="cell" class="board-cell" />
      </div>

    <GridLayout
      v-model:layout="layout"
      :col-num="BOARD_COLUMNS"
      :max-rows="BOARD_ROWS"
      :row-height="ROW_HEIGHT"
      :margin="[8, 8]"
      :is-draggable="!busy"
      :is-resizable="!busy"
      :responsive="false"
      :vertical-compact="false"
      :use-css-transforms="true"
      drag-allow-from=".board-card-grip"
      class="board-grid"
    >
      <GridItem
        v-for="card in layout"
        :key="card.i"
        :i="card.i"
        :x="card.x"
        :y="card.y"
        :w="card.w"
        :h="card.h"
        :min-w="card.minW"
        :max-w="card.maxW"
        :min-h="card.minH"
        :max-h="card.maxH"
      >
        <div class="board-card">
          <div class="board-card-grip">
            <span class="board-card-name">{{ t(kindOf(card.kindKey)?.labelKey ?? card.kindKey) }}</span>

            <button class="board-card-drop" :disabled="busy" :title="t('delete')" @click="remove(card.i)">
              <IconTrash class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- The form belongs to the widget, because only it knows what it holds. -->
          <div class="board-card-body">
            <component
              :is="kindOf(card.kindKey)!.board!.editor"
              :content="card.content"
              @update:content="write(card.i, $event)"
            />
          </div>
        </div>
      </GridItem>
      </GridLayout>
    </div>

    <div v-if="dirty" class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" :disabled="busy" @click="layout = boardOf(loadout)">
        {{ t("cancel") }}
      </Button>
      <Button size="sm" :disabled="busy" @click="apply">{{ t("apply") }}</Button>
    </div>
  </div>
</template>

<style scoped>
.board-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid hsl(var(--border) / 0.4);
}

.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.board-empty {
  padding: 14px;
  border-radius: 12px;
  border: 1px dashed hsl(var(--border));
  text-align: center;
}

.board-stage {
  position: relative;
  margin: 0 -8px;
}

/* Behind the cards and out of the way of the pointer: this is a guide, not a surface. */
.board-cells {
  position: absolute;
  inset: 0;
  display: grid;
  pointer-events: none;
}

/*
 * Drawn in the accent colour rather than in the border colour: a guide the same shade as every other
 * edge on the page is a guide nobody can see. It follows whatever accent the person picked, so it
 * stays theirs rather than becoming a second blue.
 */
.board-cell {
  border-radius: 4px;
  border: 1px dashed hsl(var(--primary) / 0.45);
  background: hsl(var(--primary) / 0.06);
}

.board-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--background));
  overflow: hidden;
}

/* The whole strip is the handle, so a card is picked up where it reads as one. */
.board-card-grip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px 6px 10px;
  background: hsl(var(--secondary) / 0.45);
  cursor: grab;
}

.board-card-grip:active {
  cursor: grabbing;
}

.board-card-name {
  font-size: 0.72rem;
  color: hsl(var(--muted-foreground));
}

.board-card-drop {
  color: hsl(var(--muted-foreground));
}

.board-card-drop:hover {
  color: hsl(var(--destructive));
}

.board-card-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 8px 10px 10px;
  overflow: hidden;
}

.board-card-body > * {
  flex: 1;
  min-height: 0;
}

:deep(.vgl-item--placeholder) {
  border-radius: 12px;
  background: hsl(var(--primary) / 0.18);
}

:deep(.vgl-item__resizer) {
  opacity: 0.45;
}

:deep(.vgl-item:hover .vgl-item__resizer) {
  opacity: 1;
}
</style>
