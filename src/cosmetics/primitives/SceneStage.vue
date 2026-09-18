<script setup lang="ts">
import { computed, onMounted } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { cdnUrl } from "@/store/system/fileStorage";
import {
  DEPTHS,
  drawBand,
  drawEmitter,
  drawSprite,
  drawWrap,
  drawWash,
  hangOf,
  installSceneKeyframes,
  nextReplay,
  replayUrl,
  spillBoxOf,
  stageOf,
  veilOf,
  type DrawnActor,
} from "@/cosmetics/primitives/sceneGeometry";
import type {
  ProfileScenePayload,
  ProfileSceneTuning,
  SceneActor,
  SceneReach,
} from "@/cosmetics/kinds/profile-scene";
import { AUTHORED_CARD_WIDTH, type ResolvedCosmetic } from "@/cosmetics/types";

/**
 * Things moving across a whole profile card, drawn as the actors its row lists.
 *
 * <b>It renders a box per band of depth, not one box.</b> An actor says where in the card's own
 * stacking it belongs — behind the glass, over the card's words, in front of a worn frame — and one
 * wrapper could only hold one answer. Three boxes is what lets a snowman roll over the card while
 * the flakes fall behind its glass, which is one scene and two depths.
 *
 * <b>And a box more for anything that spills.</b> An actor allowed past the card's edge cannot share
 * a box with one that is not: the box clips at the card or it does not. So a spilling actor gets a
 * stage of its own in the same band, one that does not clip, with a box inside it that clips at
 * the margin instead.
 *
 * <b>Nothing about a scene's appearance is in this file.</b> Where each actor goes, how big it is,
 * what path it walks, what shape its fade has and which band it is drawn in are numbers in the row;
 * this mounts them. That is the whole point of the arrangement — a new scene is a row somebody
 * creates in the console, and this file does not grow when one is added.
 */
const props = withDefaults(defineProps<{
  item: ResolvedCosmetic;

  /**
   * How big the card under this scene is, against the card it was authored for.
   *
   * A scene is authored in per cent of the card's width, so it needs no scaling to draw smaller —
   * but the row may say it is not worth drawing below a certain size, and this is what that is
   * measured against. One is the real thing, which is what every surface drawing a whole profile
   * passes.
   */
  scale?: number;
}>(), { scale: 1 });

// The rules every scene animates with, put on the page once. Here rather than in this component's
// stylesheet because the rules that name them are inline styles, and an inline style cannot see a
// scoped one.
onMounted(installSceneKeyframes);

// One number for the life of this mounting: every file this stage replays is asked for under it,
// so this showing of the card gets its own picture and its own clock, and re-rendering does not
// start the picture over.
const replay = nextReplay();

const payload = computed(() => props.item.payload as ProfileScenePayload);

/**
 * How much of the card this scene plays on.
 *
 * The row decides unless it says the wearer may, and a wearer who has not decided defers to the row
 * rather than being pinned to whatever its default was the day they looked at it.
 */
const reach = computed<SceneReach>(() => {
  const scene = payload.value;

  if (scene.reach !== "choice") return scene.reach;

  const worn = props.item.content as ProfileSceneTuning | null;

  return worn?.reach ?? scene.defaultReach;
});

/** Whether the card is big enough for this to be a scene rather than a smear. */
const worthDrawing = computed(() => AUTHORED_CARD_WIDTH * props.scale >= payload.value.minWidthPx);

/**
 * The file an actor draws, or null when there is nothing to draw it with.
 *
 * Null is the ordinary case of an operator midway through authoring: the row names a slot and the
 * upload into it has not happened yet.
 */
function urlFor(actor: SceneActor): string | null {
  const fileId = props.item.assets[actor.slot];

  if (!fileId) return null;

  const url = cdnUrl(fileId);

  return actor.replay ? replayUrl(url, replay) : url;
}

/**
 * The still that stands in for a self-animating file when movement is off.
 *
 * An APNG cannot be paused — there is no frame to hold it on and no way to ask it for one — so the
 * only way to hold one still is to draw something else. A strip needs none of this: it has a `still`
 * frame of its own.
 */
function stillFor(actor: SceneActor): string | null {
  if (actor.source !== "file") return urlFor(actor);

  const poster = props.item.assets.Poster;

  return poster ? cdnUrl(poster) : null;
}

interface Piece extends DrawnActor {
  readonly veil: Record<string, string>;
}

/** A wrapper that hides nothing, so one shape of markup serves both cases. */
const OPEN: Record<string, string> = { position: "absolute", inset: "0" };

/** A box that is no box, so the clipped stage's pieces sit directly in the stage as they always did. */
const NO_BOX: Record<string, string> = { display: "contents" };

function draw(actor: SceneActor, index: number, reduced: boolean): Piece[] {
  const url = reduced ? stillFor(actor) : urlFor(actor);

  if (url === null) return [];

  const sheet = payload.value.sheet;
  const hang = hangOf(actor, reach.value);
  const veil = veilOf(actor, hang, reduced) ?? OPEN;

  const drawn = actor.type === "emitter"
    ? drawEmitter(actor, sheet, url, reduced)
    : [
        actor.type === "wash" ? drawWash(actor, sheet, url, reduced)
          : actor.type === "sprite" ? drawSprite(actor, sheet, url, reduced, hang)
            : actor.type === "wrap" ? drawWrap(actor, url, reduced)
              : drawBand(actor, url, reduced),
      ];

  return drawn.map((piece, copy) => ({ ...piece, key: `${index}-${copy}`, veil }));
}

interface Stage {
  readonly key: string;
  readonly style: Record<string, string>;

  /** The spill box for a stage that spills, or no box at all for the one that clips at the card. */
  readonly box: Record<string, string>;

  readonly pieces: readonly Piece[];
}

/**
 * Every band that has anything in it, already turned into the styles that draw it.
 *
 * Built once per change rather than called from the template: a profile card is re-rendered
 * constantly and none of this arithmetic depends on anything that changes between those renders.
 *
 * Within a band, the clipped stage comes first and a spilling one after it, so what hangs past the
 * card is also drawn over what does not — the thing bursting out is the thing in front.
 */
const stages = computed<Stage[]>(() => {
  if (!worthDrawing.value) return [];

  const reduced = reduceMotion.value;
  const where = reach.value;
  const built: Stage[] = [];

  for (const depth of DEPTHS) {
    const bySpill = new Map<number, Piece[]>();

    payload.value.actors.forEach((actor, index) => {
      if (actor.depth !== depth) return;

      const spill = hangOf(actor, where).x;
      const pieces = bySpill.get(spill) ?? [];

      pieces.push(...draw(actor, index, reduced));
      bySpill.set(spill, pieces);
    });

    for (const spill of [...bySpill.keys()].sort((a, b) => a - b)) {
      const pieces = bySpill.get(spill)!;

      if (pieces.length === 0) continue;

      built.push(spill === 0
        ? { key: depth, style: stageOf(depth, where), box: NO_BOX, pieces }
        : { key: `${depth}-${spill}`, style: stageOf(depth, where, true), box: spillBoxOf(spill, where), pieces });
    }
  }

  return built;
});
</script>

<template>
  <div
    v-for="stage in stages"
    :key="stage.key"
    class="cs-stage"
    :style="stage.style"
    aria-hidden="true"
  >
    <div class="cs-spill" :style="stage.box">
      <div v-for="piece in stage.pieces" :key="piece.key" class="cs-veil" :style="piece.veil">
        <div class="cs-actor" :style="piece.box">
          <img v-if="piece.img" class="cs-art" :src="piece.img" :style="piece.art" alt="" />
          <div v-else class="cs-art" :style="piece.art" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * No z-index anywhere in here, and that is deliberate.
 *
 * Which band of the card a stage is drawn in comes off the row, as an inline style — it is the whole
 * flexibility this kind exists for. A number in this stylesheet would quietly win over it on
 * whichever of the three it happened to name.
 *
 * `contain: paint` is the clip a stage keeps to; a stage that spills turns it off inline, and puts
 * its clip on the box inside instead.
 */
.cs-stage {
  contain: paint;
}

.cs-spill,
.cs-veil,
.cs-actor {
  pointer-events: none;
  user-select: none;
}

.cs-art {
  display: block;
  pointer-events: none;

  /* The base stylesheet clamps pictures to their container's width, and an actor drawn deliberately
     larger than the box it travels in is exactly what that rule is aimed at — and exactly what has
     to survive it. */
  max-width: none;
  max-height: none;
}
</style>
