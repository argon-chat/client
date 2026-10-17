import type { Component } from "vue";
import type { ICosmeticPayload } from "@argon/glue";

import type {
  CosmeticEdges,
  CosmeticSides,
} from "@/cosmetics/edges";
import type { CosmeticAssets } from "@/cosmetics/wire";

/** Where a worn cosmetic may be drawn. A kind names every surface it belongs on. */
export type CosmeticSurface =
  | "profileCard"
  | "ownProfile"
  | "avatar"
  | "nicknameInMessages"
  | "memberListRow";

/** The closed set of renderers. A kind picks one rather than shipping a component. */
export type RenderPrimitive = "imageLayer" | "frameAssembly" | "textStyle";

/** One axis a wearer composes: its options are the catalogue rows of `optionKindKey`. */
export interface CosmeticFacet {
  readonly id: "font" | "effect";
  readonly labelKey: string;
  readonly optionKindKey: string;
}

export interface CosmeticKindModule<TPayload = unknown> {
  /** The server's kind key, exactly as it arrives on the wire. */
  readonly key: string;

  /** Empty for a compositional kind, whose rows are only ever options on another kind's axis. */
  readonly surfaces: readonly CosmeticSurface[];

  readonly primitive: RenderPrimitive;

  /** Compositing order within a surface, low to high. Mirrors the server's declaration. */
  readonly layer: number;

  readonly labelKey: string;

  /** A kind with no catalogue rows of its own, configured through its axes and its wearer's tuning. */
  readonly bare?: boolean;

  readonly facets?: readonly CosmeticFacet[];

  /** Never throws: a row authored against a newer build degrades to "not drawn". */
  parsePayload(payload: ICosmeticPayload): TPayload | null;

  /** Whether this build can draw a row with this slug. Absent means every slug. */
  implementsSlug?(slug: string): boolean;

  insetsOf?(item: ResolvedCosmetic<TPayload>): CosmeticEdges;
  outsetsOf?(item: ResolvedCosmetic<TPayload>): CosmeticEdges;
  hidesEdges?(item: ResolvedCosmetic<TPayload>): CosmeticSides;

  /** How one of this kind's rows draws itself in an axis picker. */
  readonly chip?: Component;
}

export interface ResolvedOption<TPayload = unknown> {
  readonly facetId: CosmeticFacet["id"];
  readonly kindKey: string;
  readonly itemId: string;
  readonly slug: string;
  readonly payload: TPayload;
  readonly assets: CosmeticAssets;
}

/** One worn cosmetic, ready to draw: kind resolved, payload parsed, files by slot, axes composed. */
export interface ResolvedCosmetic<TPayload = unknown> {
  /** The catalogue row, or null for a look composed by its wearer (a nickname). */
  readonly itemId: string | null;
  readonly slug: string | null;
  readonly kind: CosmeticKindModule<TPayload>;
  readonly layer: number;
  readonly payload: TPayload;
  readonly assets: CosmeticAssets;
  readonly options: readonly ResolvedOption[];
}
