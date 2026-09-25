import type { CSSProperties } from "vue";
import { cn } from "@argon/core";

/**
 * Size and placement rules every dialog in the app obeys.
 *
 * The content sits inside a frame that covers the viewport minus a margin (DIALOG_FRAME_CLASS), as
 * a flex item that is allowed to shrink. The guard style below is inline, so no class can beat it:
 * whatever width a caller asks for, flexbox shrinks it to the frame, and max-height keeps it inside
 * the frame vertically with the content scrolling. Callers may still widen a dialog (`max-w-3xl`),
 * never past the viewport.
 */
// empty:hidden — the portal keeps the frame mounted while the dialog is closed.
export const DIALOG_FRAME_CLASS =
  "fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none empty:hidden";

export const DIALOG_CONTENT_BASE_CLASS =
  "pointer-events-auto grid w-full max-w-lg overflow-y-auto gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none";

/** `maxHeight` is a caller's own cap (e.g. "80vh"); it can only ever lower the frame's. */
export function dialogGuardStyle(maxHeight?: string, withMaxHeight = true): CSSProperties {
  const style: CSSProperties = { position: "relative", minWidth: "0px", minHeight: "0px", flexShrink: 1 };
  if (withMaxHeight) style.maxHeight = maxHeight ? `min(100%, ${maxHeight})` : "100%";
  return style;
}

// Utilities that would stretch a dialog to the screen or pull it out of its frame. Matched on the
// utility itself, so `sm:w-screen` and `!h-full` go too.
const STRETCH_UTILITIES: RegExp[] = [
  /^(w|h|size|min-w|min-h|max-w|max-h)-(screen|svw|lvw|dvw|svh|lvh|dvh)$/,
  /^max-w-(none|full|screen-.+)$/,
  /^(h|size)-full$/,
  /^min-(w|h)-(?!0$).+$/,
  /^max-h-.+$/,
  /^(w|h|size)-\[(100(vw|vh|dvh|svh|lvh|dvw|%)|calc\(100(vw|vh|dvh|%).*)\]$/,
  /^(fixed|absolute|sticky|static)$/,
  /^-?(inset|inset-x|inset-y|top|left|right|bottom|translate-x|translate-y)-.+$/,
];

/** The utility of a class token: variants (`sm:`, `data-[x]:`) and the `!`/`-` markers dropped. */
function utilityOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

export function isStretchUtility(token: string): boolean {
  const utility = utilityOf(token);
  return STRETCH_UTILITIES.some((re) => re.test(utility));
}

/** Merges a caller's classes over the base and drops the ones the rules above forbid. */
export function dialogContentClass(base: string, callerClass: unknown): string {
  const dropped: string[] = [];
  const caller = cn(callerClass as string)
    .split(/\s+/)
    .filter((token) => {
      if (!token || !isStretchUtility(token)) return true;
      dropped.push(token);
      return false;
    })
    .join(" ");

  if (dropped.length > 0 && import.meta.env?.DEV)
    console.warn(`[dialog] ignored classes that would stretch the dialog: ${dropped.join(" ")} (use max-w-* for width, the maxHeight prop for height)`);

  return cn(base, caller);
}
