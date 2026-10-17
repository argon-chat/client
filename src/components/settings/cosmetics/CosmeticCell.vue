<script setup lang="ts">
import { computed } from "vue";
import type {
  CatalogueCosmetic,
  IWornCosmetic,
} from "@argon/glue";

import CosmeticPreview, { type CosmeticPreviewPart } from "@/cosmetics/CosmeticPreview.vue";
import {
  drawsOnCard,
  drawsOnFace,
} from "@/cosmetics/primitives/renderers";
import { toWornItem } from "@/cosmetics/wire";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

/**
 * One catalogue row drawn as itself, small.
 *
 * <b>Through the same preview the stage uses.</b> A tile that drew its own approximation would be
 * a second implementation of every cosmetic, and the two would drift — you would choose one thing
 * and wear another. All this file decides is how much of a look a tile of this size can usefully
 * show: a frame needs a card under it to be a frame at all, and a decoration is the whole of itself.
 */
const props = defineProps<{
  item: CatalogueCosmetic;

  /**
   * The room the picture gets. <c>width</c> is also what a frame is scaled against, so it is the
   * tile's nominal width rather than a measured one — the grid's tiles vary by a few pixels and
   * that is not worth a resize observer behind every tile in a scrolling list.
   */
  width: number;
  height: number;

  /** Real letters, because a face and a name treatment are judged on the name they will set. */
  sample: string;

  avatarUserId?: string | null;
  avatarFileId?: string | null;
}>();

const cosmetics = useCosmeticsStore();

const resolved = computed(() => cosmetics.resolveCatalogueItem(props.item));

const primitive = computed(() => resolved.value?.kind.primitive ?? null);

/** Whatever is arranged against a whole card rather than drawn on a thing sitting on one. */
const onCard = computed(() => primitive.value !== null && drawsOnCard(primitive.value));

/** The catalogue row worn, which is the only shape a preview reads. */
const worn = computed<IWornCosmetic>(() => toWornItem(props.item.cosmeticId));

/**
 * How much furniture a tile of this thing needs around it.
 *
 * <b>The face and the name draw whether or not anything is worn</b>, so they are the only parts
 * worth deciding here — everything else appears because the row itself is one. Almost nothing
 * wants them: a frame wants a card, and the card backdrop draws its own stand-in face and line,
 * because somebody choosing a frame is not choosing their own photograph. Only a decoration needs
 * the real face, for the plain reason that it goes on one.
 */
/** Whether this tile is a face wearing something, which is what decides the rest of it. */
const onFace = computed(() => primitive.value !== null && drawsOnFace(primitive.value));

const parts = computed<Partial<Record<CosmeticPreviewPart, boolean>>>(() => {
  if (onFace.value) {
    return { name: false };
  }

  if (primitive.value === "textStyle") {
    return { avatar: false };
  }

  return { avatar: false, name: false };
});
</script>

<template>
  <CosmeticPreview
    v-if="resolved"
    :cosmetics="[worn]"
    :width="width"
    :height="height"
    :user-id="avatarUserId ?? null"
    :avatar-file-id="avatarFileId ?? null"
    :display-name="sample"
    :parts="parts"
    :backdrop="onCard ? 'card' : 'none'"
    :align="onCard ? 'top' : 'center'"
    :avatar-size="onFace ? Math.round(height * 0.6) : undefined"
  />
</template>
