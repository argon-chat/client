import { ExpressionKind } from "@argon/glue";
import type { ExpressionEditorMode } from "@argon/media-editor";

// When a file dropped on a pack can go through the sticker workbench, and what comes back.

const IMAGE_TYPES = new Set(["image/png", "image/webp", "image/jpeg", "image/gif", "image/avif", "image/bmp"]);
const IMAGE_EXTENSIONS = /\.(png|webp|jpe?g|gif|avif|bmp)$/i;

/** A still image the browser decodes: PNG and WEBP, and the photo formats the workbench converts. */
export function isWorkbenchImage(file: Pick<File, "name" | "type">): boolean {
  return IMAGE_TYPES.has(file.type.toLowerCase()) || (!file.type && IMAGE_EXTENSIONS.test(file.name));
}

/** Refusals the workbench fixes: it re-encodes at the preset size, as a static WEBP / PNG. */
const FIXABLE = new Set([
  "expression_settings_upload_error_dims_emoji",
  "expression_settings_upload_error_dims_sticker",
  "expression_settings_upload_error_size",
  "expression_settings_upload_error_type",
  "expression_settings_upload_error_animated_image",
]);

export function isFixableInWorkbench(file: Pick<File, "name" | "type">, rejectionKey: string): boolean {
  return isWorkbenchImage(file) && FIXABLE.has(rejectionKey);
}

export function workbenchModeFor(kind: ExpressionKind): ExpressionEditorMode {
  return kind === ExpressionKind.Emoji ? "emoji" : "sticker";
}

const EXTENSION_OF: Record<string, string> = { "image/webp": "webp", "image/png": "png" };

/** The edited file keeps the original's base name (the item's suggested name comes from it). */
export function editedFileName(original: string, type: string): string {
  const base = original.replace(/\.[^.]+$/, "") || "sticker";
  return `${base}.${EXTENSION_OF[type] ?? "png"}`;
}

let gpuProbe: Promise<boolean> | null = null;

/** The editor draws with WebGPU; without an adapter it cannot open at all. */
export function canUseWorkbench(): Promise<boolean> {
  gpuProbe ??= (async () => {
    const gpu = typeof navigator !== "undefined" ? (navigator as Navigator & { gpu?: GPU }).gpu : undefined;
    if (!gpu) return false;
    try {
      return !!(await gpu.requestAdapter());
    } catch {
      return false;
    }
  })();
  return gpuProbe;
}
