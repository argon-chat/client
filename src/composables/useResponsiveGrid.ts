import { computed, toValue, type MaybeRefOrGetter } from "vue";

export interface GridResult {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export interface GridSolveOpts {
  /** Hard cap on tile width (px) — stops a single/few tiles ballooning on ultrawide. */
  maxTileWidth?: number;
  /** Floor on tile width (px) — below this the area overflows and should scroll. */
  minTileWidth?: number;
  /** Force a single row (thumbnail / activity strips). */
  singleRow?: boolean;
}

export interface ResponsiveGridOpts extends GridSolveOpts {
  width: MaybeRefOrGetter<number>;
  height: MaybeRefOrGetter<number>;
  count: MaybeRefOrGetter<number>;
  /** Tile aspect ratio (w/h). Default 16/9. */
  ratio?: MaybeRefOrGetter<number>;
  /** Gap between tiles (px). Default 16. */
  gap?: MaybeRefOrGetter<number>;
}

/**
 * Pick the column count that maximizes tile area while keeping every tile at
 * `ratio` and fitting BOTH axes of the container (Meet/Zoom-style tiling).
 *
 * For each candidate column count we derive rows, size a tile by width and by
 * height, take the smaller (so it fits both), and keep the largest-area result.
 * Returns zeroed tiles for non-positive / non-finite inputs (SSR / pre-measure)
 * so callers can omit sizing until the real size lands one ResizeObserver tick later.
 */
export function solveGrid(
  width: number,
  height: number,
  count: number,
  ratio = 16 / 9,
  gap = 16,
  opts: GridSolveOpts = {},
): GridResult {
  if (
    !count || count < 1 ||
    width <= 0 || height <= 0 ||
    !isFinite(width) || !isFinite(height)
  ) {
    return { cols: Math.max(1, count || 1), rows: 1, tileWidth: 0, tileHeight: 0 };
  }

  let best: GridResult = { cols: 1, rows: count, tileWidth: 0, tileHeight: 0 };
  let bestArea = -1;

  for (let cols = 1; cols <= count; cols++) {
    const rows = opts.singleRow ? 1 : Math.ceil(count / cols);
    const wByWidth = (width - gap * (cols - 1)) / cols;
    const rowHeight = (height - gap * (rows - 1)) / rows;
    const tileWidth = Math.min(wByWidth, rowHeight * ratio);
    if (tileWidth <= 0) continue;
    const tileHeight = tileWidth / ratio;
    const area = tileWidth * tileHeight * count;
    if (area > bestArea) {
      bestArea = area;
      best = { cols, rows, tileWidth, tileHeight };
    }
  }

  if (opts.maxTileWidth && best.tileWidth > opts.maxTileWidth) {
    best.tileWidth = opts.maxTileWidth;
    best.tileHeight = opts.maxTileWidth / ratio;
  }
  if (opts.minTileWidth && best.tileWidth > 0 && best.tileWidth < opts.minTileWidth) {
    best.tileWidth = opts.minTileWidth;
    best.tileHeight = opts.minTileWidth / ratio;
  }

  return best;
}

/** Reactive wrapper around {@link solveGrid}. Feed it a measured size (e.g. useElementSize). */
export function useResponsiveGrid(o: ResponsiveGridOpts) {
  return computed<GridResult>(() =>
    solveGrid(
      toValue(o.width),
      toValue(o.height),
      toValue(o.count),
      o.ratio != null ? toValue(o.ratio) : 16 / 9,
      o.gap != null ? toValue(o.gap) : 16,
      {
        maxTileWidth: o.maxTileWidth,
        minTileWidth: o.minTileWidth,
        singleRow: o.singleRow,
      },
    ),
  );
}
