import type { Component } from "vue";
import type { CosmeticKindModule, RenderPrimitive } from "@/cosmetics/types";
import CardLayer from "@/cosmetics/primitives/CardLayer.vue";
import FrameAssembly from "@/cosmetics/primitives/FrameAssembly.vue";
import IconBadge from "@/cosmetics/primitives/IconBadge.vue";
import ImageLayer from "@/cosmetics/primitives/ImageLayer.vue";
import OrbitStage from "@/cosmetics/primitives/OrbitStage.vue";
import SceneStage from "@/cosmetics/primitives/SceneStage.vue";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";
import VideoLayer from "@/cosmetics/primitives/VideoLayer.vue";

/**
 * The closed set of renderers: which component draws each primitive, and which of them is a file.
 *
 * <b>One list, because two readers ask different questions of it.</b> A surface asks what to mount;
 * the admin console's preview asks whether this build can draw a kind at all, and whether a row of
 * it with an empty slot will come out as nothing. Kept apart, the second reader's copy would be the
 * one nobody updates — and the warning it exists to produce would quietly stop being produced for
 * whatever was added.
 *
 * A kind naming a primitive that is not here renders nothing rather than breaking the surface, which
 * is what happens when the server ships a kind whose primitive this build predates.
 */
export interface PrimitiveRenderer {
  readonly component: Component;

  /**
   * Whether the whole of it is the file in its `Primary` slot.
   *
   * True of everything that is a picture. False for a name, which is drawn from its payload and the
   * options composed onto it, and would look the same with every slot empty.
   */
  readonly needsFile: boolean;

  /**
   * Whether it is drawn on a face rather than on a card.
   *
   * <b>Here so that the hosts drawing a face do not each keep a list of kinds.</b> Three of them do
   * — the look preview, the picker tile and the row beside a kind's name — and each was naming
   * `imageLayer` outright, so the first kind on the avatar surface that was not one drew nowhere
   * and nothing said why. What a thing is drawn on is a property of the primitive; asking it here
   * is what keeps a new face kind from being a change in four files.
   */
  readonly onFace: boolean;

  /**
   * Whether it needs a whole card under it to be itself.
   *
   * <b>The mirror of `onFace`, and added for the same reason twice over.</b> Three previews kept
   * their own copy of "cardLayer or frameAssembly" — the picker tile, the row beside a kind's name
   * and the picker's own choice of tile shape — and the first card kind that was neither drew onto
   * nothing at all: a scene arranged against a card's edges, previewed with no card, is an empty
   * box with a name under it. Nothing reported it, because drawing nothing is what every one of
   * those lists asked for.
   *
   * False for a badge or a name, which are the whole of themselves and want no furniture.
   */
  readonly onCard: boolean;
}

const RENDERERS: Partial<Record<RenderPrimitive, PrimitiveRenderer>> = {
  imageLayer: { component: ImageLayer, needsFile: true, onFace: true, onCard: false },
  cardLayer: { component: CardLayer, needsFile: true, onFace: false, onCard: true },
  frameAssembly: { component: FrameAssembly, needsFile: false, onFace: false, onCard: true },

  // A background is a card kind that needs no card drawn under it: it *is* the picture, and a
  // preview of one wants it as large as the box allows rather than shrunk to card shape.
  videoLayer: { component: VideoLayer, needsFile: true, onFace: false, onCard: false },

  iconBadge: { component: IconBadge, needsFile: true, onFace: false, onCard: false },

  // Every figure in an orbit is a picture — there is nothing in the payload that can be painted from
  // numbers the way a frame's ring is — so a row of one with an empty Primary comes out as nothing,
  // and the console is told to say so.
  orbitStage: { component: OrbitStage, needsFile: true, onFace: true, onCard: false },

  // The sheet in Primary is the whole of it — every figure in a scene is a rectangle of one picture
  // — so a row with an empty Primary comes out as nothing and the console is told to say so. It is
  // arranged against a card's own edges, so a preview of it without a card is an empty box; and it
  // takes its own z-index from the row rather than from this table, which is the flexibility the
  // kind exists for.
  sceneStage: { component: SceneStage, needsFile: true, onFace: false, onCard: true },

  textStyle: { component: TextStyle, needsFile: false, onFace: false, onCard: false },

  // widgetSlot has no shared renderer on purpose: a board card is code, so its kind brings its own
  // and `rendererForKind` reaches for that first. The name still says where it belongs.
};

export function rendererFor(primitive: RenderPrimitive): PrimitiveRenderer | undefined {
  return RENDERERS[primitive];
}

/** Whether a thing of this primitive belongs on a face rather than on a card. */
export function drawsOnFace(primitive: RenderPrimitive): boolean {
  return RENDERERS[primitive]?.onFace === true;
}

/** Whether a thing of this primitive needs a whole card drawn under it to be itself. */
export function drawsOnCard(primitive: RenderPrimitive): boolean {
  return RENDERERS[primitive]?.onCard === true;
}

/**
 * What draws one of this kind, whatever it draws with: its own card, its own component, or the
 * primitive it names. Undefined when this build has nothing that can draw it.
 */
export function componentForKind(kind: CosmeticKindModule): Component | undefined {
  if (kind.board) return kind.board.card;
  if (kind.component) return kind.component;

  return rendererFor(kind.primitive)?.component;
}
