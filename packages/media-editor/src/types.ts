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
  textRenderingInfo?: TextRenderingInfo;
  stickerSrc?: string;
};

export type TextRenderingInfo = {
  width: number;
  height: number;
  path?: (number | string)[];
  lines: TextRenderingLine[];
};

export type TextRenderingLine = {
  left: number;
  right: number;
  height: number;
  content: string;
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
  mode: 'erase' | 'restore';
  size: number;
  points: Vec2[];
};

export type MaskState = {
  /** A raster from `addMaskSource` (background removal), or null for a fully opaque base. */
  source: number | null;
  /** Edge softening of the source raster, in mask pixels. */
  feather: number;
  strokes: MaskStroke[];
};

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
