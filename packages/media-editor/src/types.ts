/** Two-element numeric vector for coordinates, dimensions, or 2D transforms. */
export type Vec2 = [number, number];

export type MediaType = 'image' | 'video';

export type EditorLayer = {
  id: number;
  type: 'text' | 'sticker';
  position: Vec2;
  rotation: number;
  scale: number;
  textInfo?: TextStyle;
  stickerSrc?: string;
};

export type FontKey = 'roboto' | 'suez' | 'bubbles' | 'playwrite' | 'chewy' | 'courier' | 'fugaz' | 'sedan';

export type TextStyle = {
  color: string;
  alignment: string;
  style: string;
  size: number;
  font: FontKey;
  content?: string;
};

export type FontInfo = {
  fontFamily: string;
  fontWeight: number;
  baseline: number;
};

export type RenderTransform = {
  flip: Vec2;
  rotation: number;
  scale: number;
  translation: Vec2;
};

export type ColoredBrushType = 'pen' | 'brush' | 'neon' | 'arrow';
/** Paint on the image's own alpha (the mask), not on the drawing layer. */
export type MaskBrushType = 'maskErase' | 'maskRestore';
export type BrushType = ColoredBrushType | 'blur' | 'eraser' | MaskBrushType;

export const isMaskBrush = (brush: string): brush is MaskBrushType =>
  brush === 'maskErase' || brush === 'maskRestore';

/** `sticker` and `emoji` edit with transparency and export at the expression presets. */
export type EditorMode = 'full' | 'avatar' | 'sticker' | 'emoji';
export type ExpressionEditorMode = 'sticker' | 'emoji';

export const isExpressionMode = (mode: string): mode is ExpressionEditorMode =>
  mode === 'sticker' || mode === 'emoji';

export type OutlineState = {
  enabled: boolean;
  /** Output pixels, 0–24. */
  radius: number;
  color: string;
};

/** A stroke on the mask, in source-image pixels. */
export type MaskStroke = {
  kind?: 'brush';
  mode: 'erase' | 'restore';
  size: number;
  points: Vec2[];
};

/** A closed selection (lasso, magnetic lasso) erased inside or outside, in source-image pixels. */
export type MaskPolygonOp = {
  kind: 'polygon';
  region: 'inside' | 'outside';
  points: Vec2[];
  /** Source pixels. */
  feather: number;
};

/**
 * A computed erase (magic eraser, background eraser): a raster from `addMaskSource` saying how much
 * each of its pixels loses, stretched over a box of the source image.
 */
export type MaskRasterOp = {
  kind: 'raster';
  mode: 'erase';
  raster: number;
  /** The box's top-left and bottom-right corners, source pixels. */
  points: Vec2[];
};

/** One edit of the mask; they apply in order on top of the base. */
export type MaskOp = MaskStroke | MaskPolygonOp | MaskRasterOp;

export type MaskState = {
  /** A raster from `addMaskSource` (background removal), or null for a fully opaque base. */
  source: number | null;
  /** Edge softening of the source raster, in mask pixels. */
  feather: number;
  /** Every edit on top of the base, in order (brush strokes, selections, eraser results). */
  strokes: MaskOp[];
};

/** The cut-out tab's selection and smart-eraser tools. */
export type CutoutTool = 'lasso' | 'magneticLasso' | 'magicEraser' | 'backgroundEraser';

/** One channel, `width × height`, 0 = transparent. */
export type MaskRaster = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type BackgroundRemovalInput = {
  image: ImageBitmap;
  /** Size of the mask wanted back. */
  width: number;
  height: number;
};

export type BackgroundRemovalOptions = {
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
};

/** Injected by the host: the editor only knows it gets a mask back for the source image. */
export type BackgroundRemover = (input: BackgroundRemovalInput, options?: BackgroundRemovalOptions) => Promise<MaskRaster>;

export type ExpressionExportFormat = 'auto' | 'png' | 'webp';
