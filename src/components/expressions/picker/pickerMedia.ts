import type { ExpressionItem } from "@argon/glue";
import type { ExpressionMedia } from "@/lib/expressions/types";
import { toMedia } from "@/store/data/expressionsStore";

const cache = new WeakMap<ExpressionItem, ExpressionMedia>();

/**
 * One media object per item: StickerView restarts its player whenever `media` is a new object, and
 * two restarts in one tick land on the same canvas.
 */
export function pickerMedia(item: ExpressionItem): ExpressionMedia {
  let media = cache.get(item);
  if (!media) cache.set(item, (media = toMedia(item)));
  return media;
}
