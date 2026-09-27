// Local shapes for the render stack. The Ion glue types are generated separately; these are the
// fields the renderer needs and nothing more.

export const ExpressionFormat = {
  Static: 0,
  Lottie: 1,
  Video: 2,
} as const;

export type ExpressionFormat = (typeof ExpressionFormat)[keyof typeof ExpressionFormat];

export interface ExpressionMedia {
  fileId: string;
  format: ExpressionFormat;
  width: number;
  height: number;
  /** Vector outline bytes (see outline.ts), drawn until a frame is there. */
  outline?: Uint8Array | null;
  thumbFileId?: string | null;
  downloadUrl?: string | null;
  thumbUrl?: string | null;
  /** Monochrome: recolour with the surrounding text colour. */
  textColor?: boolean;
}
