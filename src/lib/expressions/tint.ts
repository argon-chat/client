type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Recolours whatever is already drawn in the rect, keeping its alpha (source-atop). */
export function applyColorOnContext(ctx: Context2D, color: string, x: number, y: number, width: number, height: number) {
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = "source-over";
}

/** Draws a frame at the origin, scaled to the canvas, tinted when a colour is given. */
export function paintFrameTinted(ctx: Context2D, frame: CanvasImageSource, color: string | null | undefined) {
  const { width, height } = ctx.canvas;
  ctx.drawImage(frame, 0, 0, width, height);
  if (color) applyColorOnContext(ctx, color, 0, 0, width, height);
}
