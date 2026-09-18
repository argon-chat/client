<script lang="ts">
/**
 * The parts of a look a preview may be asked for.
 *
 * Named after where they sit rather than after the kinds that land in them, because that is what a
 * caller is deciding: a tile the size of a postage stamp wants the picture and not the furniture,
 * and it should be able to say so without naming every kind that might arrive.
 */
export type CosmeticPreviewPart =
  | "background"
  | "overlay"
  | "avatar"
  | "portrait"
  | "name"
  | "badges"
  | "widgets";
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import {
  AUTHORED_CARD_WIDTH,
  hiddenEdges,
  outsetsOf,
  type CosmeticSurface,
  type ResolvedCosmetic,
} from "@/cosmetics/types";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import CardLayer from "@/cosmetics/primitives/CardLayer.vue";
import SceneStage from "@/cosmetics/primitives/SceneStage.vue";
import FrameAssembly from "@/cosmetics/primitives/FrameAssembly.vue";
import IconBadge from "@/cosmetics/primitives/IconBadge.vue";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";
import VideoLayer from "@/cosmetics/primitives/VideoLayer.vue";
import { componentForKind, drawsOnFace } from "@/cosmetics/primitives/renderers";
import type { EquippedCosmetic } from "@argon/glue";

/**
 * A look, drawn at whatever size the caller has room for.
 *
 * <b>One of these, not one per place that shows a cosmetic.</b> The picker's stage, its tiles and
 * the line in the wardrobe were three hand-rolled copies of the same layer stack — background under
 * everything, frame and weather over it, the face with whatever is composited onto it, the name,
 * the badges, the board — and the copies had already drifted. The one that showed an avatar
 * decoration drew nothing but the face, so somebody choosing a decoration was shown it against a
 * blank box while the profile it was going onto had a background, a styled name and three badges.
 *
 * So the layer stack lives here once and everything else says how big and which parts. What is
 * drawn is decided by what is in <c>cosmetics</c> — hand it a different list of badges and a
 * different list of badges appears — and <c>parts</c> only ever takes something away.
 *
 * <b>It never fetches and it never reads what is worn.</b> The caller says what the look is,
 * which is what lets a draft nobody has saved be previewed by the same code that draws the real
 * thing.
 */
const props = withDefaults(
  defineProps<{
    /** The look, as the wire delivers one. A draft has the same shape as a saved loadout. */
    cosmetics: readonly EquippedCosmetic[];

    /**
     * The surface this is a picture of. The face is resolved on <c>avatar</c> alongside it, always,
     * because a decoration belongs to the face and the face belongs to every surface there is.
     */
    surface?: CosmeticSurface;

    /**
     * How much room the preview has, in pixels.
     *
     * The height is taken literally. The width is what a frame is <i>scaled</i> against and what
     * the face and the name are sized from — the box itself fills its host across, so a host that
     * knows its own width gets both exactly, and one laying these out in a stretchy grid gets a
     * picture that fills the tile and a frame a few per cent off. Which is the same compromise the
     * tiles have always made, and cheaper than a resize observer behind every one of them.
     */
    width: number;
    height: number;

    userId?: string | null;
    spaceId?: string | null;
    avatarFileId?: string | null;
    displayName?: string;

    /**
     * Anything set to false is left out. Everything the look carries is drawn otherwise.
     *
     * <c>avatar</c> is the face and everything composited onto it; <c>portrait</c> is only the
     * person's own picture inside it. Turning the portrait off leaves the box and what is worn
     * on it, which is how a list shows what an orbit is without a face in the way of it.
     */
    parts?: Partial<Record<CosmeticPreviewPart, boolean>>;

    /** Ask anything that moves to stand still, for a preview that has to read at a glance. */
    still?: boolean;

    /**
     * What is drawn under the look.
     *
     * <b>A frame goes round a card, so it needs a card under it.</b> On a flat grey box it was
     * four coloured bands round a rectangle of nothing, and the one thing somebody choosing a
     * frame cannot see is the frame. <c>card</c> draws a profile card in miniature — a banner
     * across the top, a body under it, the face on the seam between them — which is the shape
     * every one of these decorates.
     *
     * <c>panel</c> is a plain tinted box, for the small previews that only need somewhere to sit.
     * <c>none</c> is for a thing that is its own backdrop: a background fills the box, and a face
     * with a ring round it wants nothing behind it at all.
     */
    backdrop?: "none" | "panel" | "card";

    /** Where the figure sits: in the middle of the card, or near its top as a real card puts it. */
    align?: "center" | "top";

    /** Overrides for the two things whose natural size does not follow from the room. */
    avatarSize?: number;
    badgeSize?: number;

    /** A background's tint takes the wearer's colour, the same as it does on the real card. */
    tintColor?: number | null;
  }>(),
  {
    surface: "profileCard",
    backdrop: "panel",
    align: "center",
  },
);

const store = useCosmeticsStore();

/** The look as the renderers see it. A plain object rather than a profile: nothing else is read. */
const wearer = computed(() => ({ userId: props.userId ?? undefined, cosmetics: props.cosmetics }));

const onCard = computed(() => store.resolve(wearer.value as never, props.surface));

/**
 * What the look puts on the face.
 *
 * Asked for separately, because a decoration's kind lives on the <c>avatar</c> surface and nothing
 * else does — resolving the card's surface alone is exactly how the decoration picker came to show
 * a face with nothing on it.
 */
const onFace = computed(() =>
  props.surface === "avatar" ? onCard.value : store.resolve(wearer.value as never, "avatar"));

function drawn(primitive: string): ResolvedCosmetic[] {
  return onCard.value.filter(item => item.kind.primitive === primitive);
}

/** Whether a part is wanted. Everything is, unless the caller has said otherwise. */
function on(part: CosmeticPreviewPart): boolean {
  return props.parts?.[part] !== false;
}

const backgrounds = computed(() => (on("background") ? drawn("videoLayer") : []));

const frames = computed(() => (on("overlay") ? drawn("frameAssembly") : []));

const effects = computed(() => (on("overlay") ? drawn("cardLayer") : []));

/**
 * Counted as an overlay because that is where it is drawn from, not because of where it ends up: a
 * scene mounts once beside the frame and puts its own boxes at whichever depths its row named.
 */
const scenes = computed(() => (on("overlay") ? drawn("sceneStage") : []));

const decorations = computed(() =>
  on("avatar") ? onFace.value.filter(item => drawsOnFace(item.kind.primitive)) : []);

const badges = computed(() => (on("badges") ? drawn("iconBadge") : []));

const widgets = computed(() => (on("widgets") ? onCard.value.filter(item => item.kind.component) : []));

const styled = computed(() => (on("name") ? drawn("textStyle").at(0) ?? null : null));

/**
 * How big this is against the card a cosmetic is drawn in pixels for.
 *
 * A frame is authored against a card 384 across — a band 34 thick, a piece 62 tall — so the only
 * way to draw one small is to tell it how small. Taken from the room rather than from the card
 * inside it, because the card's own width depends on the overhang, which depends on this.
 */
const scale = computed(() => props.width / AUTHORED_CARD_WIDTH);

/**
 * Off the height as well as the width.
 *
 * A face sized from the width alone overran a box that was wide and short: on an effect tile the
 * name under it landed on the tile's own name strip, so the two read as one smudge of text.
 */
const faceSize = computed(() =>
  props.avatarSize
  ?? Math.round(Math.min(80, Math.max(22, Math.min(props.width * 0.38, props.height * 0.34)))));

const markSize = computed(() => props.badgeSize ?? Math.round(Math.min(18, Math.max(10, props.width * 0.095))));

const nameSize = computed(() => Math.min(16, Math.max(9, Math.round(props.width * 0.08))));

/**
 * The card inside the room, held off its edges by however far the look reaches past a card.
 *
 * A frame is the one cosmetic allowed to draw outside the thing it decorates, and the room is a box
 * with an edge — so without this the piece sitting on the card's top is cut off at exactly the
 * place somebody is deciding whether they like it.
 */
const card = computed(() => {
  const room = outsetsOf(onCard.value);
  const covered = hiddenEdges(onCard.value);

  const style: Record<string, string> = {
    top: `${room.top * scale.value}px`,
    right: `${room.right * scale.value}px`,
    bottom: `${room.bottom * scale.value}px`,
    left: `${room.left * scale.value}px`,
  };

  // The card's own hairline goes wherever a frame has taken the edge over, for the reason the real
  // card drops it: art has gaps, and a line through them reads as a fault in the frame.
  if (covered.top) style["--preview-edge-top"] = "0px";
  if (covered.right) style["--preview-edge-right"] = "0px";
  if (covered.bottom) style["--preview-edge-bottom"] = "0px";
  if (covered.left) style["--preview-edge-left"] = "0px";

  return style;
});

const figure = computed(() =>
  on("avatar") || on("widgets") || (on("name") && props.displayName) || badges.value.length > 0);
</script>

<template>
  <div class="cosmetic-preview" :style="{ height: `${height}px` }">
    <div
      class="cosmetic-preview-card"
      :class="[`cosmetic-preview-card--${backdrop}`, { 'cosmetic-preview-card--top': align === 'top' }]"
      :style="card"
    >
      <VideoLayer
        v-for="layer in backgrounds"
        :key="layer.itemId"
        :item="layer"
        :tint-color="tintColor ?? null"
      />

      <!-- Over the card, and the weather over the window: the order the real surface draws them in. -->
      <FrameAssembly v-for="layer in frames" :key="layer.itemId" :item="layer" :scale="scale" />
      <CardLayer v-for="layer in effects" :key="layer.itemId" :item="layer" />
      <SceneStage v-for="stage in scenes" :key="stage.itemId" :item="stage" :scale="scale" />

      <div v-if="figure" class="cosmetic-preview-figure">
        <div
          v-if="on('avatar')"
          class="cosmetic-preview-face"
          :style="{ width: `${faceSize}px`, height: `${faceSize}px` }"
        >
          <!--
            `plain`, because whatever goes on this face is drawn right below it. An avatar left to
            resolve its own decoration draws the one already being worn, and the draft then lands on
            top of it — which is two decorations where the person asked to see one.
          -->
          <slot name="avatar">
            <ArgonAvatar
              v-if="on('portrait')"
              plain
              :user-id="userId ?? undefined"
              :file-id="avatarFileId ?? undefined"
              :fallback="displayName"
              :overrided-size="faceSize"
            />
          </slot>

          <!--
            Asked rather than named. This drew an ImageLayer outright, which is every avatar
            ornament that is one picture and none of the ones that are not — an orbit is four boxes
            and a mask, and drawn as an image layer it came out as the first frame of its strip
            pinned over the face.
          -->
          <component
            :is="componentForKind(layer.kind)"
            v-for="layer in decorations"
            :key="layer.itemId"
            :item="layer"
            :still="still"
          />
        </div>

        <!--
          Only when it will hold something.
          <b>An empty line is not free.</b> It was rendered whenever a name had been handed in,
          even where the caller had switched the name off — nothing was drawn, but the figure
          still carried the six pixels of gap above it, so the face came out three pixels high in
          its box and every ring round one had more air under it than over it.
        -->
        <div
          v-if="(on('name') && displayName) || badges.length || $slots.name || $slots.badges"
          class="cosmetic-preview-line"
        >
          <slot name="name">
            <template v-if="on('name') && displayName">
              <TextStyle
                v-if="styled"
                :item="styled"
                class="cosmetic-preview-name"
                :style="{ fontSize: `${nameSize}px` }"
              >{{ displayName }}</TextStyle>
              <span v-else class="cosmetic-preview-name" :style="{ fontSize: `${nameSize}px` }">
                {{ displayName }}
              </span>
            </template>
          </slot>

          <IconBadge v-for="mark in badges" :key="mark.itemId" :item="mark" :size="markSize" />

          <slot name="badges" />
        </div>

        <component
          :is="widget.kind.component"
          v-for="widget in widgets"
          :key="widget.itemId"
          :item="widget"
          :user-id="userId ?? null"
          :space-id="spaceId ?? null"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The room: as wide as the host gives it, and exactly as tall as it was asked for.
 *
 * The card inside is smaller by however far the look hangs past a card's edge, so a host laying
 * these out in a grid gets boxes of one predictable height whatever is worn in them.
 */
.cosmetic-preview {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
}

.cosmetic-preview-card {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;

  /*
   * Not clipped, and held in place by the outsets above. A frame drawn here is being judged, so
   * the one thing this box must not do is cut a piece off it.
   */
  overflow: visible;
}

/* A plain tinted box, for a preview that is not sitting on something that already has one. */
.cosmetic-preview-card--panel {
  background: hsl(var(--secondary) / 0.35);
}

/*
 * A profile card in miniature: a banner band, a body under it, a hairline round the lot.
 *
 * Not the real card — at this size a whole profile is a smudge — but the shape of one, which is
 * what a frame needs to read as a frame and what an effect needs to be falling across.
 */
.cosmetic-preview-card--card {
  background:
    linear-gradient(
      180deg,
      hsl(var(--primary) / 0.32) 0%,
      hsl(var(--primary) / 0.10) 33%,
      hsl(var(--card) / 0) 33%
    ),
    hsl(var(--card));
}

/*
 * A stand-in face and a stand-in line of name, drawn by the backdrop rather than by the look.
 *
 * <b>Nobody choosing a frame is choosing their own photograph.</b> A real avatar and a real
 * nickname in a tile the size of a playing card is the same picture repeated down the list with
 * the one thing that differs squeezed round the edge — and the name, sized for the tile, ended up
 * on top of the tile's own label. Two grey shapes say "a card has a person on it" and then get
 * out of the way of the thing being judged.
 */
.cosmetic-preview-card--card::before {
  content: "";
  position: absolute;
  left: 11%;
  top: 33%;
  width: 21%;
  aspect-ratio: 1;
  transform: translateY(-50%);
  border-radius: 999px;
  border: 2px solid hsl(var(--card));
  background: hsl(var(--muted-foreground) / 0.32);
}

.cosmetic-preview-card--card::after {
  content: "";
  position: absolute;
  left: 37%;
  right: 13%;
  top: 34%;
  height: 6%;
  border-radius: 999px;
  background: hsl(var(--muted-foreground) / 0.28);
}

.cosmetic-preview-card--panel,
.cosmetic-preview-card--card {
  border-style: solid;
  border-color: hsl(var(--border) / 0.5);
  border-width:
    var(--preview-edge-top, 1px)
    var(--preview-edge-right, 1px)
    var(--preview-edge-bottom, 1px)
    var(--preview-edge-left, 1px);
}

/* Where a real card puts a face: on the seam between the banner and the body. */
.cosmetic-preview-card--top {
  align-items: flex-start;
  padding-top: 20%;
}

/* Above the background, which is absolutely positioned and would otherwise cover the name. */
.cosmetic-preview-figure {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  padding: 0 6%;
}

.cosmetic-preview-face {
  position: relative;
  flex: 0 0 auto;
}

.cosmetic-preview-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
}

.cosmetic-preview-name {
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
