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

function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (a === b) return true;
  if (!a?.length || !b?.length) return !a?.length && !b?.length;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The same thing drawn the same way, whether or not it is the same object. */
export function sameMedia(a: ExpressionMedia, b: ExpressionMedia): boolean {
  return (
    a === b ||
    (a.fileId === b.fileId &&
      a.format === b.format &&
      a.width === b.width &&
      a.height === b.height &&
      (a.thumbFileId ?? null) === (b.thumbFileId ?? null) &&
      (a.thumbUrl ?? null) === (b.thumbUrl ?? null) &&
      !!a.textColor === !!b.textColor &&
      sameBytes(a.outline, b.outline))
  );
}
