<script setup lang="ts">
import { computed } from "vue";
import { IconX } from "@tabler/icons-vue";
import type { ArgonUserProfile } from "@argon/glue";

import CosmeticPreview, { type CosmeticPreviewPart } from "@/cosmetics/CosmeticPreview.vue";
import {
  drawsOnCard,
  drawsOnFace,
} from "@/cosmetics/primitives/renderers";
import type { CosmeticKindModule } from "@/cosmetics/types";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useMe } from "@/store/auth/meStore";

/**
 * What a line in the wardrobe shows of itself.
 *
 * <b>Drawn from what is worn, not from the catalogue row.</b> A nickname style is the name plus the
 * face and treatment chosen on its axes and the colours its wearer set, and none of those are on a
 * catalogue row. So this hands the worn entry to the same preview the picker's stage uses and gets
 * the finished thing.
 *
 * At this size the question is only "is something on, and roughly what" — so a frame gets a card
 * and no figure, because a face 12 pixels across is a smudge that makes the frame harder to read
 * rather than easier.
 */
const props = defineProps<{
  kind: CosmeticKindModule;
  profile: Pick<ArgonUserProfile, "cosmetics"> | null;
}>();

const me = useMe();
const cosmetics = useCosmeticsStore();

const worn = computed(() => {
  const entry = cosmetics.wornOfKind(props.profile, props.kind.key);

  return entry === null ? [] : [entry];
});

/** The name and picture of the account, so a decoration is previewed over its own face. */
const sample = computed(() => me.me?.displayName || "Argon");

const face = computed(() => me.me?.avatarFileId ?? null);

/** Whatever is arranged against a whole card rather than drawn on a thing sitting on one. */
const onCard = computed(() => drawsOnCard(props.kind.primitive));

const parts = computed<Partial<Record<CosmeticPreviewPart, boolean>>>(() => {
  if (drawsOnFace(props.kind.primitive)) {
    return { name: false };
  }

  if (props.kind.primitive === "textStyle") {
    return { avatar: false };
  }

  return { avatar: false, name: false };
});

/** How big the face under a decoration is. */
const faceSize = 31;

/**
 * A card in miniature is wider than it is tall; everything else fills the column's square.
 *
 * The box is what the row reserves, not what is seen: a decoration's ring is drawn from the face
 * inside it and is allowed past these edges, so shrinking the box to leave an even gutter round
 * it costs the picture nothing.
 */
const box = computed(() => (onCard.value ? { width: 42, height: 30 } : { width: 42, height: 42 }));
</script>

<template>
  <!-- A column of one width whatever is inside it, so the labels beside it line up. -->
  <span class="row-preview">
    <span v-if="worn.length === 0" class="row-empty">
      <IconX class="w-3.5 h-3.5 text-muted-foreground" />
    </span>

    <CosmeticPreview
      v-else
      :cosmetics="worn"
      :width="box.width"
      :height="box.height"
      :user-id="me.me?.userId ?? null"
      :avatar-file-id="face"
      :display-name="sample"
      :parts="parts"
      :backdrop="onCard ? 'card' : 'none'"
      :avatar-size="faceSize"
    />
  </span>
</template>

<style scoped>
/*
 * One box, the same for every kind of preview.
 *
 * A column merely wide enough for the widest of them was not even: a tile filled 38 pixels, two
 * badges ran to 53, and a name stopped short of both, so three different right edges sat in one
 * column. Giving them all the same square is what makes a list of different things read as a list.
 */
/*
 * A square big enough for a decoration as well as for the face inside it.
 *
 * A decoration is drawn bigger than the avatar it rings, so the face inside is a good deal
 * smaller than the box round it — and nothing here clips, because a ring with a piece taken out
 * of it is worse than one that touches the edge. The box is as tall as the row allows and no
 * taller: growing it past that grew every row in the list, which is not what "bigger picture"
 * means.
 */
.row-preview {
  display: flex;
  align-items: center;
  /* Centred inside the box, not against its left edge: a tile fills the box, a name does not. */
  justify-content: center;
  flex: 0 0 42px;
  height: 42px;
  overflow: visible;
}

/*
 * Nothing on, drawn at the weight of the previews that are.
 *
 * What read as ragged was that two of them are a filled 38px square and the empty one was a small
 * mark floating in the same space.
 */
.row-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 9px;
  background: hsl(var(--secondary) / 0.5);
}
</style>
