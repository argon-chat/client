import type { Component } from "vue";

import type {
  CosmeticKindModule,
  RenderPrimitive,
} from "@/cosmetics/types";
import FrameAssembly from "@/cosmetics/primitives/FrameAssembly.vue";
import ImageLayer from "@/cosmetics/primitives/ImageLayer.vue";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";

export interface PrimitiveRenderer {
  readonly component: Component;

  /** Whether the whole of it is the file in its primary slot, so a row without one draws nothing. */
  readonly needsFile: boolean;

  /** Drawn on a face rather than on a card. */
  readonly onFace: boolean;

  /** Needs a whole card under it to be itself. */
  readonly onCard: boolean;
}

const RENDERERS: Readonly<Record<RenderPrimitive, PrimitiveRenderer>> = {
  imageLayer: { component: ImageLayer, needsFile: true, onFace: true, onCard: false },
  frameAssembly: { component: FrameAssembly, needsFile: false, onFace: false, onCard: true },
  textStyle: { component: TextStyle, needsFile: false, onFace: false, onCard: false },
};

/** Undefined for a primitive this build does not draw, which a kind from a newer server may name. */
export function rendererFor(primitive: RenderPrimitive): PrimitiveRenderer | undefined {
  return RENDERERS[primitive];
}

export function drawsOnFace(primitive: RenderPrimitive): boolean {
  return rendererFor(primitive)?.onFace === true;
}

export function drawsOnCard(primitive: RenderPrimitive): boolean {
  return rendererFor(primitive)?.onCard === true;
}

export function componentForKind(kind: CosmeticKindModule): Component | undefined {
  return rendererFor(kind.primitive)?.component;
}
