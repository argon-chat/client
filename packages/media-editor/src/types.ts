/** Two-element numeric vector for coordinates, dimensions, or 2D transforms. */
export type Vec2 = [number, number];

export type MediaType = 'image' | 'video';

export type EditorLayer = {
  id: number;
  type: 'text';
  position: Vec2;
  rotation: number;
  scale: number;
  textInfo?: TextStyle;
  textRenderingInfo?: TextRenderingInfo;
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
export type BrushType = ColoredBrushType | 'blur' | 'eraser';
