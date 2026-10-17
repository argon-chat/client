<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { IconLock } from "@tabler/icons-vue";
import type { CatalogueCosmetic } from "@argon/glue";

import {
  focusRadioAt,
  radioStepTarget,
} from "@/components/settings/cosmetics/rovingRadio";
import type {
  CosmeticFacet,
  CosmeticKindModule,
  ResolvedOption,
} from "@/cosmetics/types";
import type { NicknameAxes } from "@/cosmetics/wire";
import type { NicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";
import { argbToHex } from "@/lib/profileCustomization";
import { chipForOptionKind } from "@/cosmetics/chips/optionChips";
import { cosmeticIdKey } from "@/cosmetics/resolver";
import { cosmeticName } from "@/lib/cosmeticText";
import { leadingGraphemes } from "@/cosmetics/preview/leadingGraphemes";
import { lockedAccessibleName } from "@/components/settings/cosmetics/cosmeticLock";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useLocale } from "@/store/system/localeStore";

/**
 * The axes of whatever is on. They belong to the thing being chosen, so they live beside the list
 * and not under the whole dialog, and they read from the draft like everything else there.
 */
const props = defineProps<{
  kind: CosmeticKindModule;
  axes: NicknameAxes;
  tuning: NicknameStyleTuning;
  wearable: (item: CatalogueCosmetic) => boolean;
  sample: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:axes": [value: NicknameAxes];
}>();

interface AxisOption {
  readonly item: CatalogueCosmetic;
  readonly resolved: ResolvedOption;
}

interface Axis {
  readonly facet: CosmeticFacet;
  readonly options: readonly AxisOption[];
}

/**
 * A readable stand-in before a colour is chosen.
 *
 * Every treatment composes a colour, so with none chosen each of them drew nothing and the whole
 * row of them looked identical.
 */
const TINT = "#a1a1aa";

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const cosmetics = useCosmeticsStore();

const nameOf = (item: CatalogueCosmetic) => cosmeticName(item, currentLocale.value);

function optionOf(facet: CosmeticFacet, item: CatalogueCosmetic): AxisOption | null {
  const resolved = cosmetics.resolveCatalogueItem(item);

  if (resolved === null) {
    return null;
  }

  return {
    item,
    resolved: {
      facetId: facet.id,
      kindKey: item.kindKey,
      itemId: item.cosmeticId,
      slug: item.slug,
      payload: resolved.payload,
      assets: resolved.assets,
    },
  };
}

const shown = computed<Axis[]>(() => {
  const axes: Axis[] = [];

  for (const facet of props.kind.facets ?? []) {
    if (!cosmetics.isKindEnabled(facet.optionKindKey)) {
      continue;
    }

    const options: AxisOption[] = [];

    for (const item of cosmetics.optionsFor(facet.optionKindKey)) {
      const option = optionOf(facet, item);

      if (option !== null) {
        options.push(option);
      }
    }

    axes.push({ facet, options });
  }

  return axes;
});

/**
 * The colours the wearer has picked for themselves, for the chips to be drawn in.
 *
 * Without it every treatment previews over one swatch while the name is painted in three colours of
 * their own — samples of something that is not going to happen, and for the treatments that only
 * compose several colours, a row that all looks the same.
 */
const ownStops = computed<readonly string[]>(() => (props.tuning.colors ?? []).map(argbToHex));

/** Three letters, counted as a reader counts them, so a sample never ends in half an emoji. */
const chipSample = computed(() => leadingGraphemes(props.sample, 3));

function chosenOn(facet: CosmeticFacet): string | null {
  return props.axes[facet.id];
}

function isChosen(facet: CosmeticFacet, itemId: string): boolean {
  const chosen = chosenOn(facet);

  return chosen !== null && cosmeticIdKey(chosen) === cosmeticIdKey(itemId);
}

function chooseOn(facet: CosmeticFacet, itemId: string | null): void {
  emit("update:axes", { ...props.axes, [facet.id]: itemId });
}

function lockedName(item: CatalogueCosmetic): string {
  return lockedAccessibleName(nameOf(item), props.wearable(item), t("cosmetic_locked"));
}

function isOffered(option: AxisOption): boolean {
  return !props.disabled && props.wearable(option.item);
}

/** The one option of an axis that Tab reaches: the chosen one, or the first that can be chosen. */
function tabStopOf(axis: Axis): string | null {
  const offered = axis.options.filter(isOffered);
  const chosen = offered.find(option => isChosen(axis.facet, option.item.cosmeticId));

  return (chosen ?? offered[0])?.item.cosmeticId ?? null;
}

/** Arrows, Home and End move along what can be chosen and choose it, as in any radio group. */
function step(event: KeyboardEvent, axis: Axis, itemId: string): void {
  const offered = axis.options.filter(isOffered);
  const from = offered.findIndex(option => option.item.cosmeticId === itemId);
  const target = radioStepTarget(event, Math.max(from, 0), offered.length);

  if (target === null) {
    return;
  }

  event.preventDefault();

  const next = offered[target].item.cosmeticId;

  chooseOn(axis.facet, next);

  if (event.currentTarget instanceof Element) {
    focusRadioAt(event.currentTarget, axis.options.findIndex(option => option.item.cosmeticId === next));
  }
}
</script>

<template>
  <div v-for="axis in shown" :key="axis.facet.id" class="picker-axis">
    <div class="picker-axis-head">
      <span :id="`nickname-axis-${axis.facet.id}`">{{ t(axis.facet.labelKey) }}</span>
      <button
        v-if="chosenOn(axis.facet) !== null"
        class="picker-axis-clear"
        :disabled="disabled"
        @click="chooseOn(axis.facet, null)"
      >{{ t("reset") }}</button>
    </div>

    <div v-if="axis.options.length === 0" class="text-xs text-muted-foreground">
      {{ t("cosmetic_nothing_here_yet") }}
    </div>

    <div
      v-else
      class="picker-axis-options"
      role="radiogroup"
      :aria-labelledby="`nickname-axis-${axis.facet.id}`"
    >
      <button
        v-for="option in axis.options"
        :key="option.item.cosmeticId"
        class="picker-axis-option"
        :class="{
          'picker-axis-option--active': isChosen(axis.facet, option.item.cosmeticId),
          'picker-axis-option--locked': !wearable(option.item),
        }"
        role="radio"
        :aria-checked="isChosen(axis.facet, option.item.cosmeticId)"
        :aria-label="lockedName(option.item)"
        :tabindex="tabStopOf(axis) === option.item.cosmeticId ? 0 : -1"
        :title="nameOf(option.item)"
        :disabled="disabled || !wearable(option.item)"
        @click="chooseOn(axis.facet, isChosen(axis.facet, option.item.cosmeticId) ? null : option.item.cosmeticId)"
        @keydown="step($event, axis, option.item.cosmeticId)"
      >
        <component
          :is="chipForOptionKind(axis.facet.optionKindKey)"
          v-if="chipForOptionKind(axis.facet.optionKindKey)"
          :option="option.resolved"
          :sample="chipSample"
          :tint="TINT"
          :stops="ownStops"
        />
        <span v-else>{{ nameOf(option.item) }}</span>

        <IconLock v-if="!wearable(option.item)" class="picker-lock w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker-axis-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: hsl(var(--muted-foreground));
}

.picker-axis-clear {
  font-size: 0.68rem;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.picker-axis-clear:hover {
  color: hsl(var(--foreground));
}

/*
 * Onto the next line rather than off the side.
 *
 * A row that scrolls hides how many faces there are behind a bar somebody has to notice and then
 * drag, and the axis is a list of maybe ten things — wrapping shows all of them and costs one
 * more line of the dialog.
 */
.picker-axis-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}

.picker-axis-option {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 34px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--background));
}

.picker-axis-option--active {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary));
}

.picker-axis-option--locked {
  opacity: 0.5;
}

/* An axis option is a chip with no strip to put anything on, so its padlock sits over the corner. */
.picker-lock {
  position: absolute;
  top: 2px;
  right: 2px;
  color: hsl(var(--muted-foreground));
}
</style>
