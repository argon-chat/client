/**
 * Four sides, named rather than ordered.
 *
 * A payload states its sides as a tuple, because that is how CSS writes a box and how an operator
 * types one. Everything that *reads* them names them instead: `edges.left` cannot be confused with
 * `edges[3]`, and the code that reserves room around a cosmetic is the code where a swapped pair
 * shows up as a hole on the wrong side of somebody's card.
 */
export interface CosmeticEdges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The same four, as yes or no. */
export interface CosmeticSides {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export const NO_EDGES: CosmeticEdges = { top: 0, right: 0, bottom: 0, left: 0 };
